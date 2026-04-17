import { describe, test, expect } from "vitest";
import { registerCommentTools } from "../../tools/comments.js";
import { mockJson, mockVoid } from "../test-utils.js";
import { setupToolHarness } from "../tool-test-utils.js";

describe("Comment tools", () => {
  const h = setupToolHarness({
    register: registerCommentTools,
    defaultProject: "DEFAULT",
  });

  describe("manage_comment", () => {
    test("should create a general comment", async () => {
      const mockResponse = { id: 1, text: "Looks good!", version: 0 };

      mockJson(h.mockClients.api.post, mockResponse);

      const result = await h.client.callTool({
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
      expect(h.mockClients.api.post).toHaveBeenCalledWith(
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

      mockJson(h.mockClients.api.post, mockResponse);

      const result = await h.client.callTool({
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
      expect(h.mockClients.api.post).toHaveBeenCalledWith(
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

      mockJson(h.mockClients.api.post, mockResponse);

      const result = await h.client.callTool({
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
      expect(h.mockClients.api.post).toHaveBeenCalledWith(
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

    test("should create inline comment with custom diffType, fileType, and lineType", async () => {
      const mockResponse = {
        id: 6,
        text: "Old version issue",
        anchor: {
          path: "old.ts",
          diffType: "COMMIT",
          fileType: "FROM",
          lineType: "CONTEXT",
        },
        version: 0,
      };

      mockJson(h.mockClients.api.post, mockResponse);

      const result = await h.client.callTool({
        name: "manage_comment",
        arguments: {
          action: "create",
          repository: "my-repo",
          prId: 42,
          text: "Old version issue",
          filePath: "old.ts",
          line: 5,
          lineType: "CONTEXT",
          diffType: "COMMIT",
          fileType: "FROM",
        },
      });

      expect(result.isError).toBeFalsy();

      expect(h.mockClients.api.post).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/comments",
        expect.objectContaining({
          json: expect.objectContaining({
            anchor: {
              path: "old.ts",
              lineType: "CONTEXT",
              line: 5,
              diffType: "COMMIT",
              fileType: "FROM",
            },
          }),
        }),
      );
    });

    test("should default diffType and fileType when not provided", async () => {
      const mockResponse = {
        id: 7,
        text: "Default anchor",
        anchor: {},
        version: 0,
      };

      mockJson(h.mockClients.api.post, mockResponse);

      await h.client.callTool({
        name: "manage_comment",
        arguments: {
          action: "create",
          repository: "my-repo",
          prId: 42,
          text: "Default anchor",
          filePath: "src/index.ts",
          line: 1,
          lineType: "ADDED",
        },
      });

      expect(h.mockClients.api.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          json: expect.objectContaining({
            anchor: expect.objectContaining({
              diffType: "EFFECTIVE",
              fileType: "TO",
            }),
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

      mockJson(h.mockClients.api.post, mockResponse);

      const result = await h.client.callTool({
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
      expect(h.mockClients.api.post).toHaveBeenCalledWith(
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

      mockJson(h.mockClients.api.put, mockResponse);

      const result = await h.client.callTool({
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
      expect(h.mockClients.api.put).toHaveBeenCalledWith(
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

      mockJson(h.mockClients.api.put, mockResponse);

      const result = await h.client.callTool({
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
      expect(h.mockClients.api.put).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/comments/1",
        expect.objectContaining({
          json: expect.objectContaining({ state: "RESOLVED", version: 0 }),
        }),
      );
    });

    test("should delete a comment", async () => {
      mockVoid(h.mockClients.api.delete);

      const result = await h.client.callTool({
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
      expect(h.mockClients.api.delete).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/42/comments/1",
        expect.objectContaining({
          searchParams: { version: 0 },
        }),
      );
    });
  });

  describe("manage_comment state transitions", () => {
    test("PENDING -> OPEN via edit with state update", async () => {
      mockJson(h.mockClients.api.put, {
        id: 1,
        text: "now visible",
        state: "OPEN",
      });

      await h.client.callTool({
        name: "manage_comment",
        arguments: {
          action: "edit",
          repository: "r",
          prId: 1,
          commentId: 1,
          version: 0,
          text: "now visible",
          state: "OPEN",
        },
      });

      expect(h.mockClients.api.put).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/r/pull-requests/1/comments/1",
        expect.objectContaining({
          json: expect.objectContaining({ state: "OPEN" }),
        }),
      );
    });

    test("OPEN -> RESOLVED -> OPEN cycle uses PUT with correct state", async () => {
      mockJson(h.mockClients.api.put, { id: 1, state: "RESOLVED" });
      await h.client.callTool({
        name: "manage_comment",
        arguments: {
          action: "edit",
          repository: "r",
          prId: 1,
          commentId: 1,
          version: 0,
          state: "RESOLVED",
        },
      });
      await h.client.callTool({
        name: "manage_comment",
        arguments: {
          action: "edit",
          repository: "r",
          prId: 1,
          commentId: 1,
          version: 1,
          state: "OPEN",
        },
      });

      expect(h.mockClients.api.put).toHaveBeenCalledTimes(2);
      const firstCall = h.mockClients.api.put.mock.calls[0][1] as {
        json: Record<string, unknown>;
      };
      const secondCall = h.mockClients.api.put.mock.calls[1][1] as {
        json: Record<string, unknown>;
      };
      expect(firstCall.json.state).toBe("RESOLVED");
      expect(firstCall.json.version).toBe(0);
      expect(secondCall.json.state).toBe("OPEN");
      expect(secondCall.json.version).toBe(1);
    });

    test("create-as-PENDING then edit to OPEN", async () => {
      mockJson(h.mockClients.api.post, { id: 99, state: "PENDING" });
      mockJson(h.mockClients.api.put, { id: 99, state: "OPEN" });

      await h.client.callTool({
        name: "manage_comment",
        arguments: {
          action: "create",
          repository: "r",
          prId: 1,
          text: "draft",
          state: "PENDING",
        },
      });
      await h.client.callTool({
        name: "manage_comment",
        arguments: {
          action: "edit",
          repository: "r",
          prId: 1,
          commentId: 99,
          version: 0,
          state: "OPEN",
        },
      });

      expect(h.mockClients.api.post).toHaveBeenCalledTimes(1);
      expect(h.mockClients.api.put).toHaveBeenCalledTimes(1);
    });
  });

  describe("manage_comment react/unreact", () => {
    test("react sends PUT to comment-likes /reactions/{emoticon}", async () => {
      mockVoid(h.mockClients.commentLikes.put);

      await h.client.callTool({
        name: "manage_comment",
        arguments: {
          action: "react",
          repository: "r",
          prId: 1,
          commentId: 5,
          emoticon: "thumbsup",
        },
      });

      expect(h.mockClients.commentLikes.put).toHaveBeenCalledWith(
        expect.stringContaining("/comments/5/reactions/thumbsup"),
      );
    });

    test("unreact sends DELETE to the same URL", async () => {
      mockVoid(h.mockClients.commentLikes.delete);

      await h.client.callTool({
        name: "manage_comment",
        arguments: {
          action: "unreact",
          repository: "r",
          prId: 1,
          commentId: 5,
          emoticon: "thumbsup",
        },
      });

      expect(h.mockClients.commentLikes.delete).toHaveBeenCalledWith(
        expect.stringContaining("/comments/5/reactions/thumbsup"),
      );
    });

    test("react -> unreact -> react sequence alternates PUT/DELETE", async () => {
      mockVoid(h.mockClients.commentLikes.put);
      mockVoid(h.mockClients.commentLikes.delete);

      const args = {
        repository: "r",
        prId: 1,
        commentId: 5,
        emoticon: "heart",
      };
      await h.client.callTool({
        name: "manage_comment",
        arguments: { action: "react", ...args },
      });
      await h.client.callTool({
        name: "manage_comment",
        arguments: { action: "unreact", ...args },
      });
      await h.client.callTool({
        name: "manage_comment",
        arguments: { action: "react", ...args },
      });

      expect(h.mockClients.commentLikes.put).toHaveBeenCalledTimes(2);
      expect(h.mockClients.commentLikes.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe("search_emoticons", () => {
    test("returns list of matching emoticon shortcuts", async () => {
      mockJson(h.mockClients.emoticons.get, {
        values: [
          { shortcut: "thumbsup", displayName: "Thumbs up" },
          { shortcut: "thumbsdown", displayName: "Thumbs down" },
        ],
      });

      const result = await h.client.callTool({
        name: "search_emoticons",
        arguments: { query: "thumbs" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed).toEqual(["thumbsup", "thumbsdown"]);
    });

    test("passes query as search param", async () => {
      mockJson(h.mockClients.emoticons.get, { values: [] });

      await h.client.callTool({
        name: "search_emoticons",
        arguments: { query: "heart" },
      });

      expect(h.mockClients.emoticons.get).toHaveBeenCalledWith(
        "search",
        expect.objectContaining({
          searchParams: expect.objectContaining({ query: "heart" }),
        }),
      );
    });

    test("returns empty list when no matches", async () => {
      mockJson(h.mockClients.emoticons.get, { values: [] });

      const result = await h.client.callTool({
        name: "search_emoticons",
        arguments: { query: "xyz" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed).toEqual([]);
    });
  });
});
