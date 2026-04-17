import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerReviewTools } from "../../tools/reviews.js";
import {
  type MockApiClients,
  createMockClients,
  mockJson,
  mockVoid,
} from "../test-utils.js";
import { ToolContext } from "../../tools/shared.js";
import { ApiCache } from "../../http/cache.js";

describe("Review tools", () => {
  let server: McpServer;
  let client: Client;
  let mockClients: MockApiClients;
  let cache: ApiCache;
  let serverTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[1];

  beforeEach(async () => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    mockClients = createMockClients();
    cache = new ApiCache({ defaultTtlMs: 100 });

    registerReviewTools(
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
        { json: {} },
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
