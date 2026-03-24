import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BitbucketServer } from "../index.js";

// Mock axios for Bitbucket API calls
import { vi } from "vitest";

const mockAxios = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
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

      // Verify all expected tools exist
      const toolNames = result.tools.map((t) => t.name);
      const expectedTools = [
        "list_projects",
        "list_repositories",
        "create_pull_request",
        "get_pull_request",
        "merge_pull_request",
        "decline_pull_request",
        "add_comment",
        "add_comment_inline",
        "get_diff",
        "get_reviews",
        "get_activities",
        "get_comments",
        "search",
        "get_file_content",
        "browse_repository",
        "list_pull_requests",
        "list_branches",
        "list_commits",
        "delete_branch",
        "approve_pull_request",
        "unapprove_pull_request",
        "edit_comment",
        "delete_comment",
        "publish_review",
        "get_code_insights",
        "get_dashboard_pull_requests",
        "update_pull_request",
      ];
      expect(new Set(toolNames)).toEqual(new Set(expectedTools));
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

  describe("create_pull_request cross-repo", () => {
    test("should create a PR from a fork to upstream", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { id: 200, title: "Cross-repo PR", state: "OPEN" },
      });

      const result = await client.callTool({
        name: "create_pull_request",
        arguments: {
          project: "DRC",
          repository: "service",
          title: "Cross-repo PR",
          description: "From fork",
          sourceBranch: "feature-branch",
          targetBranch: "master",
          sourceProject: "~JOHN",
          sourceRepository: "dr-service",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.id).toBe(200);

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/projects/DRC/repos/service/pull-requests",
        expect.objectContaining({
          fromRef: expect.objectContaining({
            id: "refs/heads/feature-branch",
            repository: { slug: "dr-service", project: { key: "~JOHN" } },
          }),
          toRef: expect.objectContaining({
            id: "refs/heads/master",
            repository: { slug: "service", project: { key: "DRC" } },
          }),
        }),
      );
    });
  });

  describe("add_comment with state", () => {
    test("should create a pending draft comment", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { id: 100, text: "Draft", state: "PENDING" },
      });

      const result = await client.callTool({
        name: "add_comment",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
          text: "Draft",
          state: "PENDING",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.state).toBe("PENDING");

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/1/comments",
        { text: "Draft", state: "PENDING" },
      );
    });
  });

  describe("add_comment_inline with state", () => {
    test("should create a pending inline comment", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { id: 101, text: "Inline draft", state: "PENDING" },
      });

      const result = await client.callTool({
        name: "add_comment_inline",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
          text: "Inline draft",
          filePath: "src/main.ts",
          line: 42,
          lineType: "ADDED",
          state: "PENDING",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.state).toBe("PENDING");

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/1/comments",
        expect.objectContaining({
          text: "Inline draft",
          state: "PENDING",
          anchor: expect.objectContaining({
            path: "src/main.ts",
            line: 42,
            lineType: "ADDED",
            diffType: "EFFECTIVE",
            fileType: "TO",
          }),
        }),
      );
    });
  });

  describe("edit_comment tool", () => {
    test("should edit an existing comment", async () => {
      mockAxios.put.mockResolvedValueOnce({
        data: { id: 789, text: "Updated text", version: 1 },
      });

      const result = await client.callTool({
        name: "edit_comment",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
          commentId: 789,
          text: "Updated text",
          version: 0,
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.text).toBe("Updated text");
      expect(parsed.version).toBe(1);

      expect(mockAxios.put).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/1/comments/789",
        { text: "Updated text", version: 0 },
      );
    });
  });

  describe("delete_comment tool", () => {
    test("should delete a comment", async () => {
      mockAxios.delete.mockResolvedValueOnce({ status: 204 });

      const result = await client.callTool({
        name: "delete_comment",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
          commentId: 789,
          version: 1,
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.deleted).toBe(true);
      expect(parsed.commentId).toBe(789);

      expect(mockAxios.delete).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/1/comments/789",
        { params: { version: 1 } },
      );
    });
  });

  describe("publish_review tool", () => {
    test("should publish review with approval", async () => {
      mockAxios.put.mockResolvedValueOnce({ data: {} });

      const result = await client.callTool({
        name: "publish_review",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
          commentText: "LGTM",
          participantStatus: "APPROVED",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].type).toBe("text");

      expect(mockAxios.put).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/1/review",
        { commentText: "LGTM", participantStatus: "APPROVED" },
      );
    });

    test("should publish review without status", async () => {
      mockAxios.put.mockResolvedValueOnce({ data: {} });

      await client.callTool({
        name: "publish_review",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
        },
      });

      expect(mockAxios.put).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/1/review",
        { commentText: null },
      );
    });
  });

  describe("get_code_insights tool", () => {
    test("should fetch reports and annotations", async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            values: [
              { key: "sonarqube", title: "SonarQube", result: "PASS" },
            ],
          },
        })
        .mockResolvedValueOnce({
          data: {
            values: [
              { path: "src/main.ts", line: 10, message: "Code smell" },
            ],
          },
        });

      const result = await client.callTool({
        name: "get_code_insights",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.reports).toHaveLength(1);
      expect(parsed.reports[0].key).toBe("sonarqube");
      expect(parsed.annotations["sonarqube"]).toHaveLength(1);
      expect(parsed.annotations["sonarqube"][0].message).toBe("Code smell");
    });

    test("should handle reports with no annotations", async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: { values: [{ key: "scanner", title: "Scanner" }] },
        })
        .mockRejectedValueOnce(new Error("Not found"));

      const result = await client.callTool({
        name: "get_code_insights",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.reports).toHaveLength(1);
      expect(parsed.annotations["scanner"]).toEqual([]);
    });
  });

  describe("add_comment with severity", () => {
    test("should create a task (BLOCKER comment)", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { id: 102, text: "Fix this", severity: "BLOCKER" },
      });

      const result = await client.callTool({
        name: "add_comment",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
          text: "Fix this",
          severity: "BLOCKER",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.severity).toBe("BLOCKER");

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/1/comments",
        { text: "Fix this", severity: "BLOCKER" },
      );
    });
  });

  describe("edit_comment with severity", () => {
    test("should convert a comment to task", async () => {
      mockAxios.put.mockResolvedValueOnce({
        data: { id: 789, text: "Now a task", version: 1, severity: "BLOCKER" },
      });

      const result = await client.callTool({
        name: "edit_comment",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 1,
          commentId: 789,
          text: "Now a task",
          version: 0,
          severity: "BLOCKER",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.severity).toBe("BLOCKER");

      expect(mockAxios.put).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/1/comments/789",
        { text: "Now a task", version: 0, severity: "BLOCKER" },
      );
    });
  });

  describe("get_dashboard_pull_requests tool", () => {
    test("should fetch PRs for the authenticated user", async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          size: 1,
          values: [
            {
              id: 42,
              title: "Some PR",
              state: "OPEN",
              properties: { commentCount: 3, openTaskCount: 1 },
            },
          ],
        },
      });

      const result = await client.callTool({
        name: "get_dashboard_pull_requests",
        arguments: { role: "REVIEWER", limit: 10 },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.size).toBe(1);
      expect(parsed.values[0].title).toBe("Some PR");

      expect(mockAxios.get).toHaveBeenCalledWith("/dashboard/pull-requests", {
        params: { limit: 10, start: 0, role: "REVIEWER" },
      });
    });

    test("should pass all filter params", async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: { size: 0, values: [] },
      });

      await client.callTool({
        name: "get_dashboard_pull_requests",
        arguments: {
          state: "OPEN",
          role: "AUTHOR",
          participantStatus: "APPROVED",
          order: "NEWEST",
          closedSince: 1700000000000,
        },
      });

      expect(mockAxios.get).toHaveBeenCalledWith("/dashboard/pull-requests", {
        params: {
          limit: 25,
          start: 0,
          state: "OPEN",
          role: "AUTHOR",
          participantStatus: "APPROVED",
          order: "NEWEST",
          closedSince: 1700000000000,
        },
      });
    });
  });

  describe("create_pull_request with default reviewers", () => {
    test("should fetch and include default reviewers when flag is true", async () => {
      // Repo ID lookup
      mockAxios.get.mockResolvedValueOnce({ data: { id: 100 } });
      // Default reviewers
      mockAxios.get.mockResolvedValueOnce({
        data: [
          { name: "default-reviewer-1" },
          { name: "default-reviewer-2" },
        ],
      });
      // PR creation
      mockAxios.post.mockResolvedValueOnce({
        data: { id: 300, title: "Test", reviewers: [] },
      });

      await client.callTool({
        name: "create_pull_request",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          title: "Test",
          description: "",
          sourceBranch: "feature",
          targetBranch: "main",
        },
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests",
        expect.objectContaining({
          reviewers: expect.arrayContaining([
            { user: { name: "default-reviewer-1" } },
            { user: { name: "default-reviewer-2" } },
          ]),
        }),
      );
    });

    test("should merge explicit and default reviewers without duplicates", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: { id: 100 } });
      mockAxios.get.mockResolvedValueOnce({
        data: [{ name: "user1" }, { name: "user2" }],
      });
      mockAxios.post.mockResolvedValueOnce({ data: { id: 301 } });

      await client.callTool({
        name: "create_pull_request",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          title: "Test",
          description: "",
          sourceBranch: "feature",
          targetBranch: "main",
          reviewers: ["user1", "user3"],
        },
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests",
        expect.objectContaining({
          reviewers: [
            { user: { name: "user1" } },
            { user: { name: "user3" } },
            { user: { name: "user2" } },
          ],
        }),
      );
    });

    test("should skip default reviewers when flag is false", async () => {
      mockAxios.post.mockResolvedValueOnce({ data: { id: 302 } });

      await client.callTool({
        name: "create_pull_request",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          title: "Test",
          description: "",
          sourceBranch: "feature",
          targetBranch: "main",
          includeDefaultReviewers: false,
        },
      });

      // Should NOT have called GET for repo ID or default reviewers
      expect(mockAxios.get).not.toHaveBeenCalled();
    });
  });

  describe("update_pull_request tool", () => {
    test("should update title while preserving reviewers", async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          id: 42,
          version: 3,
          title: "Old title",
          description: "Desc",
          reviewers: [{ user: { name: "reviewer1" } }],
        },
      });
      mockAxios.put.mockResolvedValueOnce({
        data: { id: 42, version: 4, title: "New title" },
      });

      const result = await client.callTool({
        name: "update_pull_request",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 42,
          title: "New title",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.title).toBe("New title");

      expect(mockAxios.put).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/42",
        expect.objectContaining({
          title: "New title",
          description: "Desc",
          reviewers: [{ user: { name: "reviewer1" } }],
        }),
      );
    });

    test("should replace reviewers when explicitly provided", async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          id: 42,
          version: 3,
          title: "Title",
          description: "Desc",
          reviewers: [{ user: { name: "old-reviewer" } }],
        },
      });
      mockAxios.put.mockResolvedValueOnce({
        data: { id: 42, version: 4 },
      });

      await client.callTool({
        name: "update_pull_request",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          prId: 42,
          reviewers: ["new-reviewer"],
        },
      });

      expect(mockAxios.put).toHaveBeenCalledWith(
        "/projects/TEST/repos/my-repo/pull-requests/42",
        expect.objectContaining({
          reviewers: [{ user: { name: "new-reviewer" } }],
        }),
      );
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
