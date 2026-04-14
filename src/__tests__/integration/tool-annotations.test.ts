import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerRepositoryTools } from "../../tools/repositories.js";
import { registerBranchTools } from "../../tools/branches.js";
import { registerPullRequestTools } from "../../tools/pull-requests.js";
import { registerCommentTools } from "../../tools/comments.js";
import { registerSearchTools } from "../../tools/search.js";
import { registerInsightTools } from "../../tools/insights.js";
import { createMockClients } from "../test-utils.js";
import { ApiCache } from "../../http/cache.js";

describe("Tool annotations", () => {
  let client: Client;
  let serverTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[1];
  let tools: Map<string, Record<string, unknown>>;

  beforeAll(async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const mockClients = createMockClients();
    const cache = new ApiCache({ defaultTtlMs: 100 });

    const ctx = {
      server,
      clients: mockClients,
      cache,
      defaultProject: "DEFAULT",
      maxLinesPerFile: 500,
    };
    registerRepositoryTools(ctx);
    registerBranchTools(ctx);
    registerPullRequestTools(ctx);
    registerCommentTools(ctx);
    registerSearchTools(ctx);
    registerInsightTools(ctx);

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

    const { tools: toolList } = await client.listTools();
    tools = new Map(toolList.map((t) => [t.name, t.annotations ?? {}]));
  });

  afterAll(async () => {
    await client.close();
    await serverTransport.close();
  });

  describe("read-only tools", () => {
    const readOnlyTools = [
      "list_projects",
      "list_repositories",
      "browse_repository",
      "get_file_content",
      "get_pull_request",
      "list_pull_requests",
      "get_dashboard_pull_requests",
      "get_pr_activity",
      "get_diff",
      "list_branches",
      "list_commits",
      "get_code_insights",
      "get_build_status",
    ];

    test.each(readOnlyTools)("%s is read-only and idempotent", (name) => {
      const a = tools.get(name);
      expect(a).toBeDefined();
      expect(a).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
    });
  });

  describe("write tools", () => {
    const writeTools = [
      "create_pull_request",
      "manage_comment",
      "submit_review",
      "upload_attachment",
    ];

    test.each(writeTools)("%s is writable and non-idempotent", (name) => {
      const a = tools.get(name);
      expect(a).toBeDefined();
      expect(a).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      });
    });
  });

  test("update_pull_request is writable but idempotent", () => {
    expect(tools.get("update_pull_request")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  describe("destructive tools", () => {
    const destructiveTools = [
      "merge_pull_request",
      "decline_pull_request",
      "delete_branch",
    ];

    test.each(destructiveTools)("%s is destructive", (name) => {
      const a = tools.get(name);
      expect(a).toBeDefined();
      expect(a).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
    });
  });

  test("search has openWorldHint", () => {
    expect(tools.get("search")).toMatchObject({
      readOnlyHint: true,
      openWorldHint: true,
    });
  });
});
