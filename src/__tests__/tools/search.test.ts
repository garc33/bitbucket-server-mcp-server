import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerSearchTools } from "../../tools/search.js";
import {
  type MockApiClients,
  createMockClients,
  fakeResponse,
  mockJson,
} from "../test-utils.js";
import { ToolContext } from "../../tools/shared.js";
import { ApiCache } from "../../http/cache.js";

describe("Search tools", () => {
  let server: McpServer;
  let client: Client;
  let mockClients: MockApiClients;
  let cache: ApiCache;
  let serverTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[1];

  beforeEach(async () => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    mockClients = createMockClients();
    cache = new ApiCache({ defaultTtlMs: 100 });

    registerSearchTools(
      new ToolContext({
        server,
        clients: mockClients,
        cache,
        defaultProject: "DEFAULT",
      }),
    );

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

  describe("search", () => {
    test("should search with a plain query", async () => {
      const mockResponse = {
        values: [{ file: { path: "src/index.ts" }, hitCount: 3 }],
        size: 1,
        isLastPage: true,
      };

      mockJson(mockClients.search.get, mockResponse);

      const result = await client.callTool({
        name: "search",
        arguments: { query: "createClient" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.values).toHaveLength(1);
      expect(parsed.values[0].file.path).toBe("src/index.ts");

      expect(mockClients.search.get).toHaveBeenCalledWith("search", {
        searchParams: { query: "createClient", limit: 25, start: 0 },
      });
    });

    test("should prepend project filter when project is provided", async () => {
      mockJson(mockClients.search.get, {
        values: [],
        size: 0,
        isLastPage: true,
      });

      await client.callTool({
        name: "search",
        arguments: { query: "TODO", project: "MYPROJ" },
      });

      expect(mockClients.search.get).toHaveBeenCalledWith("search", {
        searchParams: { query: "project:MYPROJ TODO", limit: 25, start: 0 },
      });
    });

    test("should prepend repo filter when repository is provided", async () => {
      mockJson(mockClients.search.get, {
        values: [],
        size: 0,
        isLastPage: true,
      });

      await client.callTool({
        name: "search",
        arguments: { query: "TODO", project: "MYPROJ", repository: "my-repo" },
      });

      expect(mockClients.search.get).toHaveBeenCalledWith("search", {
        searchParams: {
          query: "repo:MYPROJ/my-repo TODO",
          limit: 25,
          start: 0,
        },
      });
    });

    test("should use default project for repo filter when project is not provided", async () => {
      mockJson(mockClients.search.get, {
        values: [],
        size: 0,
        isLastPage: true,
      });

      await client.callTool({
        name: "search",
        arguments: { query: "TODO", repository: "my-repo" },
      });

      expect(mockClients.search.get).toHaveBeenCalledWith("search", {
        searchParams: {
          query: "repo:DEFAULT/my-repo TODO",
          limit: 25,
          start: 0,
        },
      });
    });

    test("should wrap query in quotes when type is file", async () => {
      mockJson(mockClients.search.get, {
        values: [],
        size: 0,
        isLastPage: true,
      });

      await client.callTool({
        name: "search",
        arguments: { query: "index.ts", type: "file" },
      });

      expect(mockClients.search.get).toHaveBeenCalledWith("search", {
        searchParams: { query: '"index.ts"', limit: 25, start: 0 },
      });
    });

    test("should apply both repo filter and file type together", async () => {
      mockJson(mockClients.search.get, {
        values: [],
        size: 0,
        isLastPage: true,
      });

      await client.callTool({
        name: "search",
        arguments: {
          query: "config.yaml",
          project: "PROJ",
          repository: "svc",
          type: "file",
        },
      });

      expect(mockClients.search.get).toHaveBeenCalledWith("search", {
        searchParams: {
          query: '"repo:PROJ/svc config.yaml"',
          limit: 25,
          start: 0,
        },
      });
    });

    test("should pass custom limit and start", async () => {
      mockJson(mockClients.search.get, {
        values: [],
        size: 0,
        isLastPage: true,
      });

      await client.callTool({
        name: "search",
        arguments: { query: "test", limit: 50, start: 10 },
      });

      expect(mockClients.search.get).toHaveBeenCalledWith("search", {
        searchParams: { query: "test", limit: 50, start: 10 },
      });
    });

    test("should handle errors", async () => {
      // mockJson can't be used here: the json() call must reject, not resolve
      mockClients.search.get.mockReturnValue(
        fakeResponse({
          json: () => Promise.reject(new Error("Network error")),
        }),
      );

      const result = await client.callTool({
        name: "search",
        arguments: { query: "test" },
      });

      expect(result.isError).toBe(true);
    });
  });
});
