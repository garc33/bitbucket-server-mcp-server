import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerCommentTools } from "../../tools/comments.js";
import { createMockClients, mockJson, mockVoid } from "../test-utils.js";
import type { ApiClients } from "../../client.js";
import { ApiCache } from "../../utils/cache.js";

describe("Comment tools", () => {
  let server: McpServer;
  let client: Client;
  let mockClients: ApiClients;
  let cache: ApiCache;
  let serverTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[1];

  beforeEach(async () => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    mockClients = createMockClients();
    cache = new ApiCache({ defaultTtlMs: 100 });

    registerCommentTools(server, mockClients, cache, "DEFAULT");

    const [clientTransport, sTransport] = InMemoryTransport.createLinkedPair();
    serverTransport = sTransport;

    client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await Promise.all([
      server.connect(sTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    await client.close();
    await serverTransport.close();
  });

  describe("manage_comment", () => {
    test("should create a general comment", async () => {
      const mockResponse = { id: 1, text: "Looks good!", version: 0 };

      mockJson(mockClients.api.post, mockResponse);

      const result = await client.callTool({
        name: "manage_comment",
        arguments: {
          action: "create",
          repository: "my-repo",
          prId: "42",
          text: "Looks good!",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.id).toBe(1);
      expect(parsed.text).toBe("Looks good!");
      expect(mockClients.api.post).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/comments",
        expect.objectContaining({
          json: expect.objectContaining({ text: "Looks good!" }),
        }),
      );
    });

    test("should create a draft comment with state PENDING", async () => {
      const mockResponse = {
        id: 2,
        text: "Draft note",
        state: "PENDING",
        version: 0,
      };

      mockJson(mockClients.api.post, mockResponse);

      const result = await client.callTool({
        name: "manage_comment",
        arguments: {
          action: "create",
          repository: "my-repo",
          prId: 42,
          text: "Draft note",
          state: "PENDING",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.state).toBe("PENDING");
      expect(mockClients.api.post).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/comments",
        expect.objectContaining({
          json: expect.objectContaining({
            text: "Draft note",
            state: "PENDING",
          }),
        }),
      );
    });

    test("should create an inline comment with filePath, line, and lineType", async () => {
      const mockResponse = {
        id: 3,
        text: "Inline note",
        version: 0,
        anchor: { path: "src/main.ts", line: 10, lineType: "ADDED" },
      };

      mockJson(mockClients.api.post, mockResponse);

      const result = await client.callTool({
        name: "manage_comment",
        arguments: {
          action: "create",
          repository: "my-repo",
          prId: 42,
          text: "Inline note",
          filePath: "src/main.ts",
          line: 10,
          lineType: "ADDED",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.anchor.path).toBe("src/main.ts");
      expect(mockClients.api.post).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/comments",
        expect.objectContaining({
          json: expect.objectContaining({
            text: "Inline note",
            anchor: {
              path: "src/main.ts",
              lineType: "ADDED",
              line: 10,
              diffType: "EFFECTIVE",
              fileType: "TO",
            },
          }),
        }),
      );
    });

    test("should create a task comment with severity BLOCKER", async () => {
      const mockResponse = {
        id: 4,
        text: "Fix this",
        severity: "BLOCKER",
        version: 0,
      };

      mockJson(mockClients.api.post, mockResponse);

      const result = await client.callTool({
        name: "manage_comment",
        arguments: {
          action: "create",
          repository: "my-repo",
          prId: 42,
          text: "Fix this",
          severity: "BLOCKER",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.severity).toBe("BLOCKER");
      expect(mockClients.api.post).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/comments",
        expect.objectContaining({
          json: expect.objectContaining({
            text: "Fix this",
            severity: "BLOCKER",
          }),
        }),
      );
    });

    test("should edit a comment", async () => {
      const mockResponse = { id: 1, text: "Updated text", version: 1 };

      mockJson(mockClients.api.put, mockResponse);

      const result = await client.callTool({
        name: "manage_comment",
        arguments: {
          action: "edit",
          repository: "my-repo",
          prId: 42,
          commentId: 1,
          text: "Updated text",
          version: 0,
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.text).toBe("Updated text");
      expect(parsed.version).toBe(1);
      expect(mockClients.api.put).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/comments/1",
        expect.objectContaining({
          json: expect.objectContaining({ text: "Updated text", version: 0 }),
        }),
      );
    });

    test("should resolve a comment", async () => {
      const mockResponse = {
        id: 1,
        text: "Fix this",
        state: "RESOLVED",
        version: 1,
      };

      mockJson(mockClients.api.put, mockResponse);

      const result = await client.callTool({
        name: "manage_comment",
        arguments: {
          action: "edit",
          repository: "my-repo",
          prId: 42,
          commentId: 1,
          version: 0,
          state: "RESOLVED",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.state).toBe("RESOLVED");
      expect(mockClients.api.put).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/comments/1",
        expect.objectContaining({
          json: expect.objectContaining({ state: "RESOLVED", version: 0 }),
        }),
      );
    });

    test("should delete a comment", async () => {
      mockVoid(mockClients.api.delete);

      const result = await client.callTool({
        name: "manage_comment",
        arguments: {
          action: "delete",
          repository: "my-repo",
          prId: 42,
          commentId: 1,
          version: 0,
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.deleted).toBe(true);
      expect(parsed.commentId).toBe(1);
      expect(mockClients.api.delete).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/comments/1",
        expect.objectContaining({
          searchParams: { version: 0 },
        }),
      );
    });
  });

  describe("submit_review", () => {
    test("should approve a pull request", async () => {
      const mockResponse = {
        approved: true,
        user: { name: "admin" },
        role: "REVIEWER",
        status: "APPROVED",
      };

      mockJson(mockClients.api.post, mockResponse);

      const result = await client.callTool({
        name: "submit_review",
        arguments: {
          action: "approve",
          repository: "my-repo",
          prId: "42",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.approved).toBe(true);
      expect(mockClients.api.post).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/approve",
      );
    });

    test("should unapprove a pull request", async () => {
      mockVoid(mockClients.api.delete);

      const result = await client.callTool({
        name: "submit_review",
        arguments: {
          action: "unapprove",
          repository: "my-repo",
          prId: 42,
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.unapproved).toBe(true);
      expect(parsed.prId).toBe(42);
      expect(mockClients.api.delete).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/approve",
      );
    });

    test("should publish a review with participantStatus APPROVED", async () => {
      const mockResponse = {
        user: { name: "admin" },
        role: "REVIEWER",
        status: "APPROVED",
      };

      mockJson(mockClients.api.put, mockResponse);

      const result = await client.callTool({
        name: "submit_review",
        arguments: {
          action: "publish",
          repository: "my-repo",
          prId: 42,
          commentText: "LGTM",
          participantStatus: "APPROVED",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.status).toBe("APPROVED");
      expect(mockClients.api.put).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/review",
        expect.objectContaining({
          json: expect.objectContaining({
            commentText: "LGTM",
            participantStatus: "APPROVED",
          }),
        }),
      );
    });
  });
});
