import { describe, test, expect } from "vitest";
import { registerReviewTools } from "../../tools/reviews.js";
import { mockJson, mockVoid } from "../test-utils.js";
import {
  callAndParse,
  expectCalledWithJson,
  setupToolHarness,
} from "../tool-test-utils.js";

describe("Review tools", () => {
  const h = setupToolHarness({
    register: registerReviewTools,
    defaultProject: "DEFAULT",
  });

  describe("submit_review", () => {
    test("should approve a pull request", async () => {
      const mockResponse = {
        approved: true,
        user: { name: "admin" },
        role: "REVIEWER",
        status: "APPROVED",
      };

      mockJson(h.mockClients.api.post, mockResponse);

      const parsed = await callAndParse<{ approved: boolean }>(
        h.client,
        "submit_review",
        {
          action: "approve",
          repository: "my-repo",
          prId: "42",
        },
      );

      expect(parsed.approved).toBe(true);
      expect(h.mockClients.api.post).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/approve",
        { json: {} },
      );
    });

    test("should unapprove a pull request", async () => {
      mockVoid(h.mockClients.api.delete);

      const parsed = await callAndParse<{
        unapproved: boolean;
        prId: number;
      }>(h.client, "submit_review", {
        action: "unapprove",
        repository: "my-repo",
        prId: 42,
      });

      expect(parsed.unapproved).toBe(true);
      expect(parsed.prId).toBe(42);
      expect(h.mockClients.api.delete).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/approve",
      );
    });

    test("should publish a review with participantStatus APPROVED", async () => {
      const mockResponse = {
        user: { name: "admin" },
        role: "REVIEWER",
        status: "APPROVED",
      };

      mockJson(h.mockClients.api.put, mockResponse);

      const parsed = await callAndParse<{ status: string }>(
        h.client,
        "submit_review",
        {
          action: "publish",
          repository: "my-repo",
          prId: 42,
          commentText: "LGTM",
          participantStatus: "APPROVED",
        },
      );

      expect(parsed.status).toBe("APPROVED");
      expectCalledWithJson(
        h.mockClients.api.put,
        "projects/DEFAULT/repos/my-repo/pull-requests/42/review",
        {
          commentText: "LGTM",
          participantStatus: "APPROVED",
        },
      );
    });
  });

  describe("submit_review publish (decision table: commentText x participantStatus)", () => {
    test.each<{
      name: string;
      args: Record<string, unknown>;
      expectedBody: Record<string, unknown>;
    }>([
      {
        name: "comment only, no status",
        args: { commentText: "note" },
        expectedBody: { commentText: "note" },
      },
      {
        name: "status only, no comment",
        args: { participantStatus: "APPROVED" },
        expectedBody: { commentText: null, participantStatus: "APPROVED" },
      },
      {
        name: "status NEEDS_WORK only",
        args: { participantStatus: "NEEDS_WORK" },
        expectedBody: { commentText: null, participantStatus: "NEEDS_WORK" },
      },
      {
        name: "both provided",
        args: { commentText: "looks good", participantStatus: "APPROVED" },
        expectedBody: {
          commentText: "looks good",
          participantStatus: "APPROVED",
        },
      },
      {
        name: "neither provided",
        args: {},
        expectedBody: { commentText: null },
      },
    ])("$name", async ({ args, expectedBody }) => {
      mockJson(h.mockClients.api.put, { status: "APPROVED" });
      await h.client.callTool({
        name: "submit_review",
        arguments: {
          action: "publish",
          repository: "r",
          prId: 1,
          ...args,
        },
      });

      expect(h.mockClients.api.put).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/r/pull-requests/1/review",
        { json: expectedBody },
      );
    });
  });

  describe("submit_review state transitions", () => {
    test("approve -> unapprove calls POST then DELETE on /approve", async () => {
      mockJson(h.mockClients.api.post, { approved: true, status: "APPROVED" });
      mockVoid(h.mockClients.api.delete);

      await h.client.callTool({
        name: "submit_review",
        arguments: { action: "approve", repository: "r", prId: 1 },
      });
      await h.client.callTool({
        name: "submit_review",
        arguments: { action: "unapprove", repository: "r", prId: 1 },
      });

      expect(h.mockClients.api.post).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/r/pull-requests/1/approve",
        { json: {} },
      );
      expect(h.mockClients.api.delete).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/r/pull-requests/1/approve",
      );
    });

    test("unapprove -> approve -> unapprove sequence uses correct verbs", async () => {
      mockVoid(h.mockClients.api.delete);
      mockJson(h.mockClients.api.post, { approved: true });

      await h.client.callTool({
        name: "submit_review",
        arguments: { action: "unapprove", repository: "r", prId: 1 },
      });
      await h.client.callTool({
        name: "submit_review",
        arguments: { action: "approve", repository: "r", prId: 1 },
      });
      await h.client.callTool({
        name: "submit_review",
        arguments: { action: "unapprove", repository: "r", prId: 1 },
      });

      expect(h.mockClients.api.delete).toHaveBeenCalledTimes(2);
      expect(h.mockClients.api.post).toHaveBeenCalledTimes(1);
    });
  });

  describe("submit_review URL construction (grey box)", () => {
    test.each([
      { project: "TEST", repository: "r1", prId: 1 },
      { project: "OTHER", repository: "another-repo", prId: 999 },
    ])("approve on $project/$repository/$prId", async (args) => {
      mockJson(h.mockClients.api.post, { approved: true });
      await h.client.callTool({
        name: "submit_review",
        arguments: { action: "approve", ...args },
      });
      expect(h.mockClients.api.post).toHaveBeenCalledWith(
        `projects/${args.project}/repos/${args.repository}/pull-requests/${args.prId}/approve`,
        { json: {} },
      );
    });

    test("uses default project when project omitted", async () => {
      mockJson(h.mockClients.api.post, { approved: true });
      await h.client.callTool({
        name: "submit_review",
        arguments: { action: "approve", repository: "r", prId: 1 },
      });
      expect(h.mockClients.api.post).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/r/pull-requests/1/approve",
        { json: {} },
      );
    });
  });
});
