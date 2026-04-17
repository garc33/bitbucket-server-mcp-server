import { describe, test, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerSearchTools } from "../../tools/search.js";
import { createMockClients, fakeResponse, mockJson } from "../test-utils.js";
import { ToolContext } from "../../tools/shared.js";
import { ApiCache } from "../../http/cache.js";
import { setupToolHarness } from "../tool-test-utils.js";

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

      const result = await h.client.callTool({
        name: "search",
        arguments: { query: "createClient" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

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

      const result = await h.client.callTool({
        name: "search",
        arguments: { query: "const" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      const item = parsed.values[0];

      expect(item.file).toBe("src/index.ts");
      expect(item.hitContexts).toBeDefined();
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

      const result = await h.client.callTool({
        name: "search",
        arguments: { query: "const", fields: "*all" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      const item = parsed.values[0];

      expect(item.repository.hierarchyId).toBe("h2");
      expect(item.repository.scmId).toBe("git");
    });

    test("should handle errors", async () => {
      // mockJson can't be used here: the json() call must reject, not resolve
      h.mockClients.search.post.mockReturnValue(
        fakeResponse({
          json: () => Promise.reject(new Error("Network error")),
        }),
      );

      const result = await h.client.callTool({
        name: "search",
        arguments: { query: "test" },
      });

      expect(result.isError).toBe(true);
    });

    test.each([
      { limit: 0, start: 0 },
      { limit: 1, start: 0 },
      { limit: 100, start: 1000 },
    ])(
      "pagination boundary limit=$limit start=$start",
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
      // Re-register with a context that has no defaultProject
      const { server: bareServer } = (() => {
        const s = new McpServer({ name: "bare", version: "1.0.0" });
        const bareClients = createMockClients();
        const bareCache = new ApiCache({ defaultTtlMs: 100 });
        registerSearchTools(
          new ToolContext({
            server: s,
            clients: bareClients,
            cache: bareCache,
          }),
        );
        return { server: s };
      })();

      const [ct, st] = InMemoryTransport.createLinkedPair();
      const bareClient = new Client(
        { name: "c", version: "1.0" },
        { capabilities: {} },
      );
      await Promise.all([bareServer.connect(st), bareClient.connect(ct)]);

      const result = await bareClient.callTool({
        name: "search",
        arguments: { query: "q", repository: "r" },
      });

      expect(result.isError).toBe(true);
      await bareClient.close();
      await st.close();
    });
  });
});
