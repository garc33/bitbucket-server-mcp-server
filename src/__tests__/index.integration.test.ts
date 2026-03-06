import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BitbucketServer } from "../index.js";

// Mock axios for Bitbucket API calls
import { vi } from "vitest";

const mockAxios = {
  get: vi.fn(),
  post: vi.fn(),
};

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => mockAxios),
  },
  isAxiosError: vi.fn(),
}));

describe("BitbucketServer Integration Tests", () => {
  let server: BitbucketServer;
  let client: Client;
  let clientTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[0];
  let serverTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[1];

  beforeEach(async () => {
    // Create linked transports
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Create server with test configuration
    server = new BitbucketServer({
      baseUrl: "https://bb.example.com",
      token: "test-token",
      defaultProject: "DEFAULT",
    });

    // Create MCP client
    client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    // Connect both sides
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await client.close();
    await serverTransport.close();
  });

  describe("Tool Listing", () => {
    test("should list available tools", async () => {
      const result = await client.listTools();

      expect(result.tools).toBeDefined();
      expect(result.tools.length).toBeGreaterThan(0);

      // Verify some expected tools exist
      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain("list_projects");
      expect(toolNames).toContain("list_repositories");
      expect(toolNames).toContain("create_pull_request");
      expect(toolNames).toContain("get_pull_request");
      expect(toolNames).toContain("merge_pull_request");
    });
  });

  describe("list_projects tool", () => {
    test("should list projects", async () => {
      // Mock axios response
      mockAxios.get.mockResolvedValueOnce({
        data: {
          values: [
            {
              key: "TEST",
              name: "Test Project",
              description: "A test project",
              public: false,
              type: "NORMAL",
            },
          ],
          size: 1,
        },
      });

      const result = await client.callTool({
        name: "list_projects",
        arguments: {},
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe("text");

      const parsed = JSON.parse(content[0].text);
      expect(parsed.total).toBe(1);
      expect(parsed.projects).toHaveLength(1);
      expect(parsed.projects[0].key).toBe("TEST");

      expect(mockAxios.get).toHaveBeenCalledWith("/projects", {
        params: { limit: 25, start: 0 },
      });
    });
  });

  describe("list_repositories tool", () => {
    test("should list repositories with explicit project", async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          values: [
            {
              slug: "my-repo",
              name: "My Repository",
              description: "Test repo",
              project: { key: "TEST" },
              public: false,
              links: {
                clone: [
                  {
                    name: "http",
                    href: "https://bb.example.com/scm/test/my-repo.git",
                  },
                ],
              },
              state: "AVAILABLE",
            },
          ],
          size: 1,
        },
      });

      const result = await client.callTool({
        name: "list_repositories",
        arguments: { project: "TEST" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.repositories).toHaveLength(1);
      expect(parsed.repositories[0].slug).toBe("my-repo");

      expect(mockAxios.get).toHaveBeenCalledWith("/projects/TEST/repos", {
        params: { limit: 25, start: 0 },
      });
    });

    test("should use default project when not specified", async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          values: [],
          size: 0,
        },
      });

      await client.callTool({
        name: "list_repositories",
        arguments: {},
      });

      expect(mockAxios.get).toHaveBeenCalledWith("/projects/DEFAULT/repos", {
        params: { limit: 25, start: 0 },
      });
    });
  });

  describe("create_pull_request tool", () => {
    test("should create a pull request", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: {
          id: 123,
          title: "Test PR",
          description: "Test description",
          state: "OPEN",
        },
      });

      const result = await client.callTool({
        name: "create_pull_request",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          title: "Test PR",
          description: "Test description",
          sourceBranch: "feature-branch",
          targetBranch: "main",
          reviewers: ["user1"],
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.id).toBe(123);

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests",
        expect.objectContaining({
          title: "Test PR",
          description: "Test description",
          fromRef: expect.objectContaining({
            id: "refs/heads/feature-branch",
          }),
          toRef: expect.objectContaining({
            id: "refs/heads/main",
          }),
          reviewers: [{ user: { name: "user1" } }],
        }),
      );
    });
  });

  describe("get_pull_request tool", () => {
    test("should get pull request details", async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          id: 456,
          title: "Existing PR",
          state: "OPEN",
          version: 1,
        },
      });

      const result = await client.callTool({
        name: "get_pull_request",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 456,
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.id).toBe(456);

      expect(mockAxios.get).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/456",
      );
    });

    test("should throw when no project provided", async () => {
      // Close existing client connection first
      await client.close();

      // Create server without default project
      server = new BitbucketServer({
        baseUrl: "https://bb.example.com",
        token: "test-token",
      });

      const [newClientTransport, newServerTransport] =
        InMemoryTransport.createLinkedPair();
      clientTransport = newClientTransport;
      serverTransport = newServerTransport;

      await server.connect(serverTransport);
      await client.connect(clientTransport);

      await expect(
        client.callTool({
          name: "get_pull_request",
          arguments: {
            repository: "my-repo",
            prId: 1,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("merge_pull_request tool", () => {
    test("should merge a pull request", async () => {
      // First get PR version
      mockAxios.get.mockResolvedValueOnce({
        data: { id: 1, version: 3 },
      });

      // Then merge
      mockAxios.post.mockResolvedValueOnce({
        data: { state: "MERGED" },
      });

      const result = await client.callTool({
        name: "merge_pull_request",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
          message: "Merged PR",
          strategy: "squash",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.state).toBe("MERGED");

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/1/merge",
        expect.objectContaining({
          version: 3,
          message: "Merged PR",
          strategy: "squash",
        }),
      );
    });
  });

  describe("add_comment tool", () => {
    test("should add a comment", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { id: 789, text: "Test comment" },
      });

      const result = await client.callTool({
        name: "add_comment",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
          text: "Test comment",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.id).toBe(789);

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/1/comments",
        { text: "Test comment" },
      );
    });

    test("should add a comment with parent", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { id: 790, text: "Reply comment" },
      });

      await client.callTool({
        name: "add_comment",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
          text: "Reply comment",
          parentId: 123,
        },
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/1/comments",
        { text: "Reply comment", parent: { id: 123 } },
      );
    });
  });

  describe("get_reviews tool", () => {
    test("should filter review activities", async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          values: [
            { action: "APPROVED", user: { name: "user1" } },
            { action: "COMMENTED", user: { name: "user2" } },
            { action: "REVIEWED", user: { name: "user3" } },
          ],
        },
      });

      const result = await client.callTool({
        name: "get_reviews",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed).toHaveLength(2);
      expect(
        parsed.every((r: { action: string }) =>
          ["APPROVED", "REVIEWED"].includes(r.action),
        ),
      ).toBe(true);
    });
  });

  describe("Error handling", () => {
    test("should handle API errors", async () => {
      interface AxiosError extends Error {
        response?: { data: { message: string } };
        isAxiosError: boolean;
      }

      const error = new Error("Not found") as AxiosError;
      error.response = { data: { message: "Not found" } };
      error.isAxiosError = true;

      mockAxios.get.mockRejectedValueOnce(error);

      await expect(
        client.callTool({
          name: "get_pull_request",
          arguments: {
            project: "TEST",
            repository: "my-repo",
            prId: 999,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
