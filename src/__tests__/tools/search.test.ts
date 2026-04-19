import { describe, test, expect } from "vitest";
import { registerSearchTools } from "../../tools/search.js";
import { mockJson, mockError } from "../test-utils.js";
import {
  callAndParse,
  callRaw,
  connectMcp,
  createTestToolContext,
  setupToolHarness,
} from "../tool-test-utils.js";

describe("Search tools", () => {
  const h = setupToolHarness({
    register: registerSearchTools,
    defaultProject: "DEFAULT",
  });

  describe("search", () => {
    test("should search with a plain query", async () => {
      const mockResponse = {
        code: {
          values: [{ file: "src/index.ts", hitCount: 3 }],
          isLastPage: true,
          count: 1,
        },
      };

      mockJson(h.mockClients.search.post, mockResponse);

      const parsed = await callAndParse<{
        values: Array<{ file: string }>;
      }>(h.client, "search", { query: "createClient" });

      expect(parsed.values).toHaveLength(1);
      expect(parsed.values[0].file).toBe("src/index.ts");

      expect(h.mockClients.search.post).toHaveBeenCalledWith("search", {
        json: {
          query: "createClient",
          entities: { code: { start: 0, limit: 25 } },
        },
      });
    });

    test("should prepend project filter when project is provided", async () => {
      mockJson(h.mockClients.search.post, {
        code: { values: [], isLastPage: true },
      });

      await h.client.callTool({
        name: "search",
        arguments: { query: "TODO", project: "MYPROJ" },
      });

      expect(h.mockClients.search.post).toHaveBeenCalledWith("search", {
        json: {
          query: "project:MYPROJ TODO",
          entities: { code: { start: 0, limit: 25 } },
        },
      });
    });

    test("should prepend repo filter when repository is provided", async () => {
      mockJson(h.mockClients.search.post, {
        code: { values: [], isLastPage: true },
      });

      await h.client.callTool({
        name: "search",
        arguments: { query: "TODO", project: "MYPROJ", repository: "my-repo" },
      });

      expect(h.mockClients.search.post).toHaveBeenCalledWith("search", {
        json: {
          query: "repo:MYPROJ/my-repo TODO",
          entities: { code: { start: 0, limit: 25 } },
        },
      });
    });

    test("should use default project for repo filter when project is not provided", async () => {
      mockJson(h.mockClients.search.post, {
        code: { values: [], isLastPage: true },
      });

      await h.client.callTool({
        name: "search",
        arguments: { query: "TODO", repository: "my-repo" },
      });

      expect(h.mockClients.search.post).toHaveBeenCalledWith("search", {
        json: {
          query: "repo:DEFAULT/my-repo TODO",
          entities: { code: { start: 0, limit: 25 } },
        },
      });
    });

    test("should wrap query in quotes when type is file", async () => {
      mockJson(h.mockClients.search.post, {
        code: { values: [], isLastPage: true },
      });

      await h.client.callTool({
        name: "search",
        arguments: { query: "index.ts", type: "file" },
      });

      expect(h.mockClients.search.post).toHaveBeenCalledWith("search", {
        json: {
          query: '"index.ts"',
          entities: { code: { start: 0, limit: 25 } },
        },
      });
    });

    test("should apply both repo filter and file type together", async () => {
      mockJson(h.mockClients.search.post, {
        code: { values: [], isLastPage: true },
      });

      await h.client.callTool({
        name: "search",
        arguments: {
          query: "config.yaml",
          project: "PROJ",
          repository: "svc",
          type: "file",
        },
      });

      expect(h.mockClients.search.post).toHaveBeenCalledWith("search", {
        json: {
          query: '"repo:PROJ/svc config.yaml"',
          entities: { code: { start: 0, limit: 25 } },
        },
      });
    });

    test("should pass custom limit and start", async () => {
      mockJson(h.mockClients.search.post, {
        code: { values: [], isLastPage: true },
      });

      await h.client.callTool({
        name: "search",
        arguments: { query: "test", limit: 50, start: 10 },
      });

      expect(h.mockClients.search.post).toHaveBeenCalledWith("search", {
        json: { query: "test", entities: { code: { start: 10, limit: 50 } } },
      });
    });

    test("should curate response fields by default", async () => {
      mockJson(h.mockClients.search.post, {
        code: {
          values: [
            {
              file: "src/index.ts",
              hitCount: 2,
              hitContexts: [[{ line: 1, text: "const x = 1;" }]],
              pathMatches: [{ text: "src/index.ts", match: false }],
              repository: {
                slug: "my-repo",
                name: "My Repo",
                scmId: "git",
                hierarchyId: "h2",
                project: { key: "PROJ", id: 1 },
              },
            },
          ],
          isLastPage: true,
        },
      });

      const parsed = await callAndParse<{
        values: Array<{
          file: string;
          hitContexts: unknown;
          repository: {
            slug: string;
            scmId?: string;
            hierarchyId?: string;
            project: { key: string; id?: number };
          };
        }>;
      }>(h.client, "search", { query: "const" });
      const item = parsed.values[0];

      expect(item.file).toBe("src/index.ts");
      expect(item.hitContexts).toEqual([[{ line: 1, text: "const x = 1;" }]]);
      expect(item.repository.slug).toBe("my-repo");
      expect(item.repository.scmId).toBeUndefined();
      expect(item.repository.hierarchyId).toBeUndefined();
      expect(item.repository.project.key).toBe("PROJ");
      expect(item.repository.project.id).toBeUndefined();
    });

    test("should return all fields when fields='*all'", async () => {
      mockJson(h.mockClients.search.post, {
        code: {
          values: [
            {
              file: "src/index.ts",
              hitCount: 1,
              hitContexts: [],
              pathMatches: [],
              repository: { slug: "my-repo", hierarchyId: "h2", scmId: "git" },
            },
          ],
          isLastPage: true,
        },
      });

      const parsed = await callAndParse<{
        values: Array<{
          repository: { hierarchyId: string; scmId: string };
        }>;
      }>(h.client, "search", { query: "const", fields: "*all" });
      const item = parsed.values[0];

      expect(item.repository.hierarchyId).toBe("h2");
      expect(item.repository.scmId).toBe("git");
    });

    test("should handle errors", async () => {
      mockError(h.mockClients.search.post, new Error("Network error"));

      const result = await callRaw(h.client, "search", { query: "test" });

      expect(result.isError).toBe(true);
    });

    test.each([
      { limit: 0, start: 0 },
      { limit: 1, start: 0 },
      { limit: 100, start: 1000 },
    ])(
      "forwards pagination params limit=$limit start=$start",
      async ({ limit, start }) => {
        mockJson(h.mockClients.search.post, {
          code: { values: [], isLastPage: true },
        });

        await h.client.callTool({
          name: "search",
          arguments: { query: "q", limit, start },
        });

        expect(h.mockClients.search.post).toHaveBeenCalledWith("search", {
          json: {
            query: "q",
            entities: { code: { start, limit } },
          },
        });
      },
    );

    test("should throw when repository provided but no project and no default", async () => {
      const ctx = createTestToolContext({ defaultProject: undefined });
      registerSearchTools(ctx);

      await using conn = await connectMcp(ctx.server);

      const result = await conn.client.callTool({
        name: "search",
        arguments: { query: "q", repository: "r" },
      });

      expect(result.isError).toBe(true);
    });
  });
});
