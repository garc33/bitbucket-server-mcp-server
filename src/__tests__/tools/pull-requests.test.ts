import { describe, test, expect } from "vitest";
import { registerPullRequestTools } from "../../tools/pull-requests.js";
import { mockJson, mockText, mockError } from "../test-utils.js";
import {
  callAndParse,
  expectCalledWithJson,
  expectCalledWithSearchParams,
  setupToolHarness,
} from "../tool-test-utils.js";

describe("Pull request tools", () => {
  const h = setupToolHarness({
    register: registerPullRequestTools,
    defaultProject: "DEFAULT",
  });

  // ── create_pull_request ────────────────────────────────────────────

  describe("create_pull_request", () => {
    test("should create a basic pull request", async () => {
      const mockPr = { id: 1, title: "My PR", state: "OPEN" };

      // Mock repo lookup for default reviewers (source repo)
      mockJson(h.mockClients.api.get, { id: 10 });
      // Mock default reviewers fetch
      mockJson(h.mockClients.defaultReviewers.get, []);
      // Mock PR creation
      mockJson(h.mockClients.api.post, mockPr);

      const parsed = await callAndParse<{ id: number; title: string }>(
        h.client,
        "create_pull_request",
        {
          project: "PROJ",
          repository: "my-repo",
          title: "My PR",
          sourceBranch: "feature/x",
          targetBranch: "main",
          reviewers: ["alice"],
        },
      );
      expect(parsed.id).toBe(1);
      expect(parsed.title).toBe("My PR");

      // Verify the POST body
      expectCalledWithJson(
        h.mockClients.api.post,
        "projects/PROJ/repos/my-repo/pull-requests",
        {
          title: "My PR",
          fromRef: expect.objectContaining({
            id: "refs/heads/feature/x",
            repository: { slug: "my-repo", project: { key: "PROJ" } },
          }),
          toRef: expect.objectContaining({
            id: "refs/heads/main",
            repository: { slug: "my-repo", project: { key: "PROJ" } },
          }),
          reviewers: [{ user: { name: "alice" } }],
        },
      );
    });

    test("should create a cross-repo pull request with sourceProject/sourceRepository", async () => {
      const mockPr = { id: 2, title: "Cross-repo PR", state: "OPEN" };

      // Mock source repo lookup
      mockJson(h.mockClients.api.get, { id: 20 });
      // Mock target repo lookup (different repo, so both are fetched)
      mockJson(h.mockClients.api.get, { id: 30 });
      // Mock default reviewers fetch
      mockJson(h.mockClients.defaultReviewers.get, [{ name: "bob" }]);
      // Mock PR creation
      mockJson(h.mockClients.api.post, mockPr);

      const parsed = await callAndParse<{ id: number }>(
        h.client,
        "create_pull_request",
        {
          project: "TARGET",
          repository: "target-repo",
          title: "Cross-repo PR",
          sourceBranch: "feature/y",
          targetBranch: "develop",
          sourceProject: "SOURCE",
          sourceRepository: "source-repo",
          reviewers: ["alice"],
        },
      );
      expect(parsed.id).toBe(2);

      // Verify fromRef uses source project/repo
      expectCalledWithJson(
        h.mockClients.api.post,
        "projects/TARGET/repos/target-repo/pull-requests",
        {
          fromRef: expect.objectContaining({
            repository: { slug: "source-repo", project: { key: "SOURCE" } },
          }),
          toRef: expect.objectContaining({
            repository: { slug: "target-repo", project: { key: "TARGET" } },
          }),
          // alice + default reviewer bob
          reviewers: [{ user: { name: "alice" } }, { user: { name: "bob" } }],
        },
      );
    });

    test("should deduplicate default reviewers with explicit reviewers", async () => {
      const mockPr = { id: 3, title: "Dedup PR", state: "OPEN" };

      mockJson(h.mockClients.api.get, { id: 10 });
      mockJson(h.mockClients.defaultReviewers.get, [
        { name: "alice" },
        { name: "carol" },
      ]);
      mockJson(h.mockClients.api.post, mockPr);

      await callAndParse(h.client, "create_pull_request", {
        project: "PROJ",
        repository: "my-repo",
        title: "Dedup PR",
        sourceBranch: "feature/z",
        targetBranch: "main",
        reviewers: ["alice"],
      });

      // alice should appear once, carol added from defaults
      expectCalledWithJson(h.mockClients.api.post, expect.any(String), {
        reviewers: [{ user: { name: "alice" } }, { user: { name: "carol" } }],
      });
    });

    test("should skip default reviewers when includeDefaultReviewers is false", async () => {
      const mockPr = { id: 4, title: "No defaults", state: "OPEN" };

      mockJson(h.mockClients.api.post, mockPr);

      await callAndParse(h.client, "create_pull_request", {
        project: "PROJ",
        repository: "my-repo",
        title: "No defaults",
        sourceBranch: "feature/a",
        targetBranch: "main",
        includeDefaultReviewers: false,
      });

      // Should not have called get for repo IDs or default reviewers
      expect(h.mockClients.api.get).not.toHaveBeenCalled();
      expect(h.mockClients.defaultReviewers.get).not.toHaveBeenCalled();
    });
  });

  // ── get_pull_request ───────────────────────────────────────────────

  describe("get_pull_request", () => {
    test("should get pull request details", async () => {
      const mockPr = { id: 42, title: "Test PR", state: "OPEN", version: 3 };

      mockJson(h.mockClients.api.get, mockPr);

      const parsed = await callAndParse<{ id: number; title: string }>(
        h.client,
        "get_pull_request",
        { project: "PROJ", repository: "my-repo", prId: "42" },
      );
      expect(parsed.id).toBe(42);
      expect(parsed.title).toBe("Test PR");

      expect(h.mockClients.api.get).toHaveBeenCalledWith(
        "projects/PROJ/repos/my-repo/pull-requests/42",
      );
    });

    test("should use default project", async () => {
      mockJson(h.mockClients.api.get, { id: 1 });

      await callAndParse(h.client, "get_pull_request", {
        repository: "my-repo",
        prId: 1,
      });

      expect(h.mockClients.api.get).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/1",
      );
    });
  });

  // ── update_pull_request ────────────────────────────────────────────

  describe("update_pull_request", () => {
    test("should preserve reviewers when not provided", async () => {
      const existingPr = {
        id: 10,
        version: 5,
        title: "Old title",
        description: "Old desc",
        toRef: { id: "refs/heads/main", displayId: "main" },
        reviewers: [{ user: { name: "bob" }, status: "APPROVED" }],
      };
      const updatedPr = { ...existingPr, title: "New title" };

      // GET current PR
      mockJson(h.mockClients.api.get, existingPr);
      // PUT updated PR
      mockJson(h.mockClients.api.put, updatedPr);

      const parsed = await callAndParse<{ title: string }>(
        h.client,
        "update_pull_request",
        {
          project: "PROJ",
          repository: "my-repo",
          prId: 10,
          title: "New title",
        },
      );
      expect(parsed.title).toBe("New title");

      // Verify reviewers were preserved
      expectCalledWithJson(
        h.mockClients.api.put,
        "projects/PROJ/repos/my-repo/pull-requests/10",
        {
          title: "New title",
          reviewers: [{ user: { name: "bob" }, status: "APPROVED" }],
        },
      );
    });

    test("should replace reviewers when provided", async () => {
      const existingPr = {
        id: 10,
        version: 5,
        title: "Title",
        description: "Desc",
        toRef: { id: "refs/heads/main", displayId: "main" },
        reviewers: [{ user: { name: "bob" } }],
      };

      mockJson(h.mockClients.api.get, existingPr);
      mockJson(h.mockClients.api.put, {
        ...existingPr,
        reviewers: [{ user: { name: "carol" } }],
      });

      await callAndParse(h.client, "update_pull_request", {
        project: "PROJ",
        repository: "my-repo",
        prId: 10,
        reviewers: ["carol"],
      });

      expectCalledWithJson(h.mockClients.api.put, expect.any(String), {
        reviewers: [{ user: { name: "carol" } }],
      });
    });

    test("should update target branch preserving repository info for cross-repo PRs", async () => {
      const existingPr = {
        id: 10,
        version: 5,
        title: "Title",
        description: "Desc",
        toRef: {
          id: "refs/heads/main",
          displayId: "main",
          repository: { slug: "upstream-repo", project: { key: "UPSTREAM" } },
        },
        reviewers: [],
      };

      mockJson(h.mockClients.api.get, existingPr);
      mockJson(h.mockClients.api.put, {
        ...existingPr,
        toRef: { ...existingPr.toRef, id: "refs/heads/develop" },
      });

      await callAndParse(h.client, "update_pull_request", {
        project: "PROJ",
        repository: "my-repo",
        prId: 10,
        targetBranch: "develop",
      });

      expectCalledWithJson(h.mockClients.api.put, expect.any(String), {
        toRef: {
          id: "refs/heads/develop",
          displayId: "main",
          repository: {
            slug: "upstream-repo",
            project: { key: "UPSTREAM" },
          },
        },
      });
    });
  });

  // ── merge_pull_request ─────────────────────────────────────────────

  describe("merge_pull_request", () => {
    test("should fetch version and merge", async () => {
      const mockPr = { id: 5, version: 12, state: "OPEN" };
      const mergedPr = { id: 5, version: 13, state: "MERGED" };

      // GET for version
      mockJson(h.mockClients.api.get, mockPr);
      // POST merge
      mockJson(h.mockClients.api.post, mergedPr);

      const parsed = await callAndParse<{ state: string }>(
        h.client,
        "merge_pull_request",
        {
          project: "PROJ",
          repository: "my-repo",
          prId: 5,
          message: "Merging feature",
          strategy: "squash",
        },
      );
      expect(parsed.state).toBe("MERGED");

      expect(h.mockClients.api.post).toHaveBeenCalledWith(
        "projects/PROJ/repos/my-repo/pull-requests/5/merge",
        expect.objectContaining({
          json: { version: 12, message: "Merging feature" },
          searchParams: { strategyId: "squash" },
        }),
      );
    });

    test("should merge with no-ff strategy", async () => {
      const mockPr = { id: 5, version: 12, state: "OPEN" };
      const mergedPr = { id: 5, version: 13, state: "MERGED" };

      mockJson(h.mockClients.api.get, mockPr);
      mockJson(h.mockClients.api.post, mergedPr);

      await callAndParse(h.client, "merge_pull_request", {
        project: "PROJ",
        repository: "my-repo",
        prId: 5,
        strategy: "no-ff",
      });

      expect(h.mockClients.api.post).toHaveBeenCalledWith(
        "projects/PROJ/repos/my-repo/pull-requests/5/merge",
        expect.objectContaining({
          json: { version: 12 },
          searchParams: { strategyId: "no-ff" },
        }),
      );
    });

    test("should merge without strategy (server default)", async () => {
      const mockPr = { id: 5, version: 12, state: "OPEN" };
      const mergedPr = { id: 5, version: 13, state: "MERGED" };

      mockJson(h.mockClients.api.get, mockPr);
      mockJson(h.mockClients.api.post, mergedPr);

      await callAndParse(h.client, "merge_pull_request", {
        project: "PROJ",
        repository: "my-repo",
        prId: 5,
      });

      expectCalledWithJson(
        h.mockClients.api.post,
        "projects/PROJ/repos/my-repo/pull-requests/5/merge",
        { version: 12 },
      );
    });
  });

  // ── decline_pull_request ───────────────────────────────────────────

  describe("decline_pull_request", () => {
    test("should fetch version and decline", async () => {
      const mockPr = { id: 7, version: 4, state: "OPEN" };
      const declinedPr = { id: 7, version: 5, state: "DECLINED" };

      mockJson(h.mockClients.api.get, mockPr);
      mockJson(h.mockClients.api.post, declinedPr);

      const parsed = await callAndParse<{ state: string }>(
        h.client,
        "decline_pull_request",
        {
          project: "PROJ",
          repository: "my-repo",
          prId: 7,
          message: "Not needed",
        },
      );
      expect(parsed.state).toBe("DECLINED");

      expectCalledWithJson(
        h.mockClients.api.post,
        "projects/PROJ/repos/my-repo/pull-requests/7/decline",
        { version: 4, comment: "Not needed" },
      );
    });
  });

  // ── list_pull_requests ─────────────────────────────────────────────

  describe("list_pull_requests", () => {
    test("should list pull requests with filters", async () => {
      const mockResponse = {
        values: [
          {
            id: 1,
            title: "PR 1",
            author: {
              user: { name: "alice", slug: "alice", displayName: "Alice" },
            },
          },
          {
            id: 2,
            title: "PR 2",
            author: { user: { name: "bob", slug: "bob", displayName: "Bob" } },
          },
        ],
        size: 2,
        isLastPage: true,
      };

      mockJson(h.mockClients.api.get, mockResponse);

      const parsed = await callAndParse<{
        total: number;
        pullRequests: unknown[];
      }>(h.client, "list_pull_requests", {
        project: "PROJ",
        repository: "my-repo",
        state: "OPEN",
      });
      expect(parsed.total).toBe(2);
      expect(parsed.pullRequests).toHaveLength(2);
    });

    test("should filter by author client-side", async () => {
      const mockResponse = {
        values: [
          {
            id: 1,
            title: "PR 1",
            author: {
              user: { name: "alice", slug: "alice", displayName: "Alice" },
            },
          },
          {
            id: 2,
            title: "PR 2",
            author: { user: { name: "bob", slug: "bob", displayName: "Bob" } },
          },
        ],
        size: 2,
        isLastPage: true,
      };

      mockJson(h.mockClients.api.get, mockResponse);

      const parsed = await callAndParse<{
        total: number;
        pullRequests: Array<{ id: number }>;
      }>(h.client, "list_pull_requests", {
        project: "PROJ",
        repository: "my-repo",
        author: "alice",
      });
      expect(parsed.total).toBe(1);
      expect(parsed.pullRequests).toHaveLength(1);
      expect(parsed.pullRequests[0].id).toBe(1);
    });
  });

  // ── get_dashboard_pull_requests ────────────────────────────────────

  describe("get_dashboard_pull_requests", () => {
    test("should fetch dashboard PRs with params", async () => {
      const mockResponse = {
        values: [{ id: 100, title: "Dashboard PR" }],
        size: 1,
        isLastPage: true,
      };

      mockJson(h.mockClients.api.get, mockResponse);

      const parsed = await callAndParse<{
        values: Array<{ title: string }>;
      }>(h.client, "get_dashboard_pull_requests", {
        state: "OPEN",
        role: "REVIEWER",
        limit: 10,
      });
      expect(parsed.values).toHaveLength(1);
      expect(parsed.values[0].title).toBe("Dashboard PR");

      expectCalledWithSearchParams(
        h.mockClients.api.get,
        "dashboard/pull-requests",
        { state: "OPEN", role: "REVIEWER", limit: 10 },
      );
    });
  });

  // ── get_pr_activity ────────────────────────────────────────────────

  describe("get_pr_activity", () => {
    test("should return all activities with pagination info", async () => {
      const mockActivities = {
        values: [
          { action: "APPROVED", user: { name: "alice" } },
          { action: "COMMENTED", comment: { text: "Looks good" } },
          { action: "RESCOPED" },
        ],
        size: 3,
        isLastPage: true,
      };

      mockJson(h.mockClients.api.get, mockActivities);

      const parsed = await callAndParse<{
        activities: unknown[];
        isLastPage: boolean;
      }>(h.client, "get_pr_activity", {
        project: "PROJ",
        repository: "my-repo",
        prId: 1,
      });
      expect(parsed.activities).toHaveLength(3);
      expect(parsed.isLastPage).toBe(true);
    });

    test("should filter to reviews only", async () => {
      const mockActivities = {
        values: [
          { action: "APPROVED", user: { name: "alice" } },
          { action: "COMMENTED", comment: { text: "Looks good" } },
          { action: "REVIEWED", user: { name: "bob" } },
        ],
        size: 3,
        isLastPage: true,
      };

      mockJson(h.mockClients.api.get, mockActivities);

      const parsed = await callAndParse<{
        activities: Array<{ action: string }>;
      }>(h.client, "get_pr_activity", {
        project: "PROJ",
        repository: "my-repo",
        prId: 1,
        filter: "reviews",
      });
      expect(parsed.activities).toHaveLength(2);
      expect(
        parsed.activities.every(
          (a: { action: string }) =>
            a.action === "APPROVED" || a.action === "REVIEWED",
        ),
      ).toBe(true);
    });

    test("should filter to comments only", async () => {
      const mockActivities = {
        values: [
          { action: "APPROVED", user: { name: "alice" } },
          { action: "COMMENTED", comment: { text: "Looks good" } },
          { action: "COMMENTED", comment: { text: "One more thing" } },
        ],
        size: 3,
        isLastPage: true,
      };

      mockJson(h.mockClients.api.get, mockActivities);

      const parsed = await callAndParse<{
        activities: Array<{ action: string }>;
      }>(h.client, "get_pr_activity", {
        project: "PROJ",
        repository: "my-repo",
        prId: 1,
        filter: "comments",
      });
      expect(parsed.activities).toHaveLength(2);
      expect(
        parsed.activities.every(
          (a: { action: string }) => a.action === "COMMENTED",
        ),
      ).toBe(true);
    });

    test("should exclude activities from specified users", async () => {
      mockJson(h.mockClients.api.get, {
        values: [
          {
            action: "COMMENTED",
            user: { name: "sa_sec_appsec_auto" },
            comment: { author: { name: "sa_sec_appsec_auto" } },
          },
          {
            action: "COMMENTED",
            user: { name: "alice" },
            comment: { author: { name: "alice" } },
          },
          { action: "APPROVED", user: { name: "jenkins-bot" } },
          { action: "APPROVED", user: { name: "bob" } },
        ],
        size: 4,
        isLastPage: true,
      });

      const parsed = await callAndParse<{
        activities: Array<{ user: { name: string } }>;
      }>(h.client, "get_pr_activity", {
        project: "PROJ",
        repository: "my-repo",
        prId: 1,
        excludeUsers: ["sa_sec_appsec_auto", "jenkins-bot"],
      });
      expect(parsed.activities).toHaveLength(2);
      expect(parsed.activities[0].user.name).toBe("alice");
      expect(parsed.activities[1].user.name).toBe("bob");
    });
  });

  // ── get_diff ───────────────────────────────────────────────────────

  describe("get_diff", () => {
    test("should fetch and truncate diff", async () => {
      const rawDiff = [
        "diff --git a/file.ts b/file.ts",
        "index abc..def 100644",
        "--- a/file.ts",
        "+++ b/file.ts",
        "@@ -1,3 +1,3 @@",
        " line1",
        "-old",
        "+new",
        " line3",
      ].join("\n");

      mockText(h.mockClients.api.get, rawDiff);

      const result = await h.client.callTool({
        name: "get_diff",
        arguments: { project: "PROJ", repository: "my-repo", prId: 1 },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].type).toBe("text");
      // With only 5 content lines, the default maxLinesPerFile of 500 won't truncate
      expect(content[0].text).toContain("diff --git");
      expect(content[0].text).toContain("+new");
    });

    test("should pass contextLines and withComments to searchParams", async () => {
      mockText(h.mockClients.api.get, "diff content");

      await h.client.callTool({
        name: "get_diff",
        arguments: {
          project: "PROJ",
          repository: "my-repo",
          prId: 1,
          contextLines: 5,
        },
      });

      expect(h.mockClients.api.get).toHaveBeenCalledWith(
        "projects/PROJ/repos/my-repo/pull-requests/1/diff",
        expect.objectContaining({
          searchParams: { contextLines: 5, withComments: false },
          headers: { Accept: "text/plain" },
        }),
      );
    });

    test("should not truncate when maxLinesPerFile is 0", async () => {
      const rawDiff =
        "diff --git a/big.ts b/big.ts\n" +
        Array.from({ length: 1000 }, (_, i) => `+line${i}`).join("\n");

      mockText(h.mockClients.api.get, rawDiff);

      const result = await h.client.callTool({
        name: "get_diff",
        arguments: {
          project: "PROJ",
          repository: "my-repo",
          prId: 1,
          maxLinesPerFile: 0,
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      // With maxLinesPerFile=0, no truncation should happen
      expect(content[0].text).not.toContain("TRUNCATED");
      expect(content[0].text).toContain("+line999");
    });

    test("should return file list with stat=true", async () => {
      mockJson(h.mockClients.api.get, {
        values: [
          {
            path: { toString: "src/server.ts" },
            type: "MODIFY",
            nodeType: "FILE",
          },
          { path: { toString: "src/new.ts" }, type: "ADD", nodeType: "FILE" },
        ],
      });

      // diff-stats-summary returns 404 on older versions
      mockError(h.mockClients.api.get, new Error("Not Found"));

      const parsed = await callAndParse<{
        totalFiles: number;
        files: Array<{ path: string; type: string }>;
        summary?: unknown;
      }>(h.client, "get_diff", {
        project: "PROJ",
        repository: "my-repo",
        prId: 1,
        stat: true,
      });

      expect(parsed.totalFiles).toBe(2);
      expect(parsed.files[0]).toEqual({
        path: "src/server.ts",
        type: "MODIFY",
      });
      expect(parsed.files[1]).toEqual({ path: "src/new.ts", type: "ADD" });
      expect(parsed.summary).toBeUndefined();
    });

    test("should include summary when diff-stats-summary is available", async () => {
      mockJson(h.mockClients.api.get, {
        values: [
          {
            path: { toString: "src/index.ts" },
            type: "MODIFY",
            nodeType: "FILE",
          },
        ],
      });

      mockJson(h.mockClients.api.get, { linesAdded: 50, linesRemoved: 10 });

      const parsed = await callAndParse<{
        totalFiles: number;
        summary: { linesAdded: number; linesRemoved: number };
      }>(h.client, "get_diff", {
        project: "PROJ",
        repository: "my-repo",
        prId: 1,
        stat: true,
      });

      expect(parsed.totalFiles).toBe(1);
      expect(parsed.summary).toEqual({ linesAdded: 50, linesRemoved: 10 });
    });

    test("appends filePath to URL when provided", async () => {
      mockText(h.mockClients.api.get, "diff content");

      await h.client.callTool({
        name: "get_diff",
        arguments: {
          project: "PROJ",
          repository: "my-repo",
          prId: 1,
          filePath: "src/index.ts",
        },
      });

      expect(h.mockClients.api.get).toHaveBeenCalledWith(
        "projects/PROJ/repos/my-repo/pull-requests/1/diff/src/index.ts",
        expect.anything(),
      );
    });
  });

  describe("merge_pull_request (decision table: mergeStrategy)", () => {
    test.each([
      "no-ff",
      "ff",
      "ff-only",
      "squash",
      "squash-ff-only",
      "rebase-no-ff",
      "rebase-ff-only",
    ])("sends strategyId=%s as search param", async (strategy) => {
      mockJson(h.mockClients.api.get, { version: 5 });
      mockJson(h.mockClients.api.post, { state: "MERGED" });

      await h.client.callTool({
        name: "merge_pull_request",
        arguments: {
          project: "PROJ",
          repository: "my-repo",
          prId: 10,
          strategy: strategy,
        },
      });

      expectCalledWithSearchParams(
        h.mockClients.api.post,
        "projects/PROJ/repos/my-repo/pull-requests/10/merge",
        { strategyId: strategy },
      );
    });

    test("omits strategyId when strategy not provided", async () => {
      mockJson(h.mockClients.api.get, { version: 1 });
      mockJson(h.mockClients.api.post, { state: "MERGED" });

      await h.client.callTool({
        name: "merge_pull_request",
        arguments: { project: "PROJ", repository: "my-repo", prId: 10 },
      });

      const [, opts] = h.mockClients.api.post.mock.calls[0] as [
        string,
        { searchParams?: Record<string, unknown> },
      ];
      expect(opts?.searchParams?.strategyId).toBeUndefined();
    });
  });

  describe("list_pull_requests (decision table: state x direction x order)", () => {
    test.each([
      { state: "OPEN", direction: "INCOMING", order: "NEWEST" },
      { state: "MERGED", direction: "OUTGOING", order: "OLDEST" },
      { state: "DECLINED", direction: "INCOMING", order: "NEWEST" },
      { state: "ALL", direction: "OUTGOING", order: "OLDEST" },
    ])("combines $state/$direction/$order", async (args) => {
      mockJson(h.mockClients.api.get, {
        values: [],
        size: 0,
        isLastPage: true,
      });

      await h.client.callTool({
        name: "list_pull_requests",
        arguments: { repository: "r", ...args },
      });

      expectCalledWithSearchParams(
        h.mockClients.api.get,
        expect.stringContaining("/pull-requests"),
        { state: args.state, direction: args.direction, order: args.order },
      );
    });
  });

  describe("pagination boundary (limit/start)", () => {
    test.each([
      { limit: 0, start: 0 },
      { limit: 1, start: 0 },
      { limit: 100, start: 1000 },
      { limit: 1000, start: 99999 },
    ])("list_pull_requests passes limit=$limit start=$start", async (args) => {
      mockJson(h.mockClients.api.get, {
        values: [],
        size: 0,
        isLastPage: true,
      });

      await h.client.callTool({
        name: "list_pull_requests",
        arguments: { repository: "r", ...args },
      });

      expectCalledWithSearchParams(
        h.mockClients.api.get,
        expect.any(String),
        args,
      );
    });
  });
});
