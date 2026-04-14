import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerBranchTools } from "../../tools/branches.js";
import {
  type MockApiClients,
  createMockClients,
  fakeResponse,
  mockJson,
} from "../test-utils.js";
import { ToolContext } from "../../tools/shared.js";
import { ApiCache } from "../../http/cache.js";

describe("Branch tools", () => {
  let server: McpServer;
  let client: Client;
  let mockClients: MockApiClients;
  let cache: ApiCache;
  let serverTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[1];

  beforeEach(async () => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    mockClients = createMockClients();
    cache = new ApiCache({ defaultTtlMs: 100 });

    registerBranchTools(
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

  describe("list_branches", () => {
    test("should list branches and include default branch", async () => {
      const branchesResponse = {
        values: [
          { displayId: "main", id: "refs/heads/main", isDefault: true },
          { displayId: "develop", id: "refs/heads/develop", isDefault: false },
        ],
        size: 2,
        isLastPage: true,
      };
      const defaultBranchResponse = {
        displayId: "main",
        id: "refs/heads/main",
      };

      mockClients.api.get.mockImplementation((url: string | URL | Request) => {
        if (String(url).includes("default-branch")) {
          return fakeResponse({
            json: () => Promise.resolve(defaultBranchResponse),
          });
        }
        return fakeResponse({ json: () => Promise.resolve(branchesResponse) });
      });

      const result = await client.callTool({
        name: "list_branches",
        arguments: { project: "TEST", repository: "my-repo" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.total).toBe(2);
      expect(parsed.branches).toHaveLength(2);
      expect(parsed.branches[0].displayId).toBe("main");
      expect(parsed.defaultBranch.displayId).toBe("main");
    });

    test("should use default project when not provided", async () => {
      mockClients.api.get.mockImplementation((url: string | URL | Request) => {
        if (String(url).includes("default-branch")) {
          return fakeResponse({ json: () => Promise.resolve(null) });
        }
        return fakeResponse({
          json: () =>
            Promise.resolve({ values: [], size: 0, isLastPage: true }),
        });
      });

      await client.callTool({
        name: "list_branches",
        arguments: { repository: "my-repo" },
      });

      expect(mockClients.api.get).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/branches",
        expect.anything(),
      );
    });

    test("should return raw output when fields is '*all'", async () => {
      const branchesResponse = {
        values: [
          {
            displayId: "main",
            id: "refs/heads/main",
            isDefault: true,
            type: "BRANCH",
            latestCommit: "abc123",
            metadata: { someKey: "someValue" },
            extraField: "should be kept",
          },
        ],
        size: 1,
        isLastPage: true,
      };
      const defaultBranchResponse = {
        displayId: "main",
        id: "refs/heads/main",
        extraField: "also kept",
      };

      mockClients.api.get.mockImplementation((url: string | URL | Request) => {
        if (String(url).includes("default-branch")) {
          return fakeResponse({
            json: () => Promise.resolve(defaultBranchResponse),
          });
        }
        return fakeResponse({ json: () => Promise.resolve(branchesResponse) });
      });

      const result = await client.callTool({
        name: "list_branches",
        arguments: { project: "TEST", repository: "my-repo", fields: "*all" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.branches[0].extraField).toBe("should be kept");
      expect(parsed.defaultBranch.extraField).toBe("also kept");
    });

    test("should handle default branch fetch failure gracefully", async () => {
      const branchesResponse = {
        values: [{ displayId: "main", id: "refs/heads/main" }],
        size: 1,
        isLastPage: true,
      };

      mockClients.api.get.mockImplementation((url: string | URL | Request) => {
        if (String(url).includes("default-branch")) {
          return fakeResponse({
            json: () => Promise.reject(new Error("Not found")),
          });
        }
        return fakeResponse({ json: () => Promise.resolve(branchesResponse) });
      });

      const result = await client.callTool({
        name: "list_branches",
        arguments: { project: "TEST", repository: "my-repo" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.total).toBe(1);
      expect(parsed.defaultBranch).toBeNull();
    });
  });

  describe("list_commits", () => {
    test("should list commits for a branch", async () => {
      const mockResponse = {
        values: [
          {
            id: "abc123",
            message: "Initial commit",
            author: { name: "john", displayName: "John Doe", slug: "jdoe" },
          },
          {
            id: "def456",
            message: "Second commit",
            author: { name: "jane", displayName: "Jane Smith", slug: "jsmith" },
          },
        ],
        size: 2,
        isLastPage: true,
      };

      mockJson(mockClients.api.get, mockResponse);

      const result = await client.callTool({
        name: "list_commits",
        arguments: { project: "TEST", repository: "my-repo", branch: "main" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.total).toBe(2);
      expect(parsed.commits).toHaveLength(2);
      expect(parsed.commits[0].id).toBe("abc123");

      expect(mockClients.api.get).toHaveBeenCalledWith(
        "projects/TEST/repos/my-repo/commits",
        expect.objectContaining({
          searchParams: expect.objectContaining({ until: "main" }),
        }),
      );
    });

    test("should filter commits by author (case-insensitive)", async () => {
      const mockResponse = {
        values: [
          {
            id: "abc123",
            message: "First",
            author: { name: "john", displayName: "John Doe", slug: "jdoe" },
          },
          {
            id: "def456",
            message: "Second",
            author: { name: "jane", displayName: "Jane Smith", slug: "jsmith" },
          },
        ],
        size: 2,
        isLastPage: true,
      };

      mockJson(mockClients.api.get, mockResponse);

      const result = await client.callTool({
        name: "list_commits",
        arguments: { project: "TEST", repository: "my-repo", author: "JOHN" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.total).toBe(1);
      expect(parsed.commits).toHaveLength(1);
      expect(parsed.commits[0].id).toBe("abc123");
    });

    test("should use default project when not provided", async () => {
      mockJson(mockClients.api.get, { values: [], size: 0, isLastPage: true });

      await client.callTool({
        name: "list_commits",
        arguments: { repository: "my-repo" },
      });

      expect(mockClients.api.get).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/commits",
        expect.anything(),
      );
    });
  });

  describe("delete_branch", () => {
    test("should delete a non-default branch", async () => {
      mockJson(mockClients.api.get, {
        displayId: "main",
        id: "refs/heads/main",
      });
      mockJson(mockClients.branchUtils.post, {});

      const result = await client.callTool({
        name: "delete_branch",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          branch: "feature/old",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.deleted).toBe(true);
      expect(parsed.branch).toBe("feature/old");

      expect(mockClients.branchUtils.post).toHaveBeenCalledWith(
        "projects/TEST/repos/my-repo/branches",
        { json: { name: "refs/heads/feature/old", dryRun: false } },
      );
    });

    test("should refuse to delete the default branch", async () => {
      mockJson(mockClients.api.get, {
        displayId: "main",
        id: "refs/heads/main",
      });

      const result = await client.callTool({
        name: "delete_branch",
        arguments: { project: "TEST", repository: "my-repo", branch: "main" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("Cannot delete the default branch");
      expect(result.isError).toBe(true);

      expect(mockClients.branchUtils.post).not.toHaveBeenCalled();
    });

    test("should use default project when not provided", async () => {
      mockJson(mockClients.api.get, {
        displayId: "main",
        id: "refs/heads/main",
      });
      mockJson(mockClients.branchUtils.post, {});

      await client.callTool({
        name: "delete_branch",
        arguments: { repository: "my-repo", branch: "feature/old" },
      });

      expect(mockClients.api.get).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/default-branch",
      );
    });
  });
});
