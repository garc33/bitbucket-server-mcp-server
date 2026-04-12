import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerInsightTools } from "../../tools/insights.js";
import { createMockClients, mockJson } from "../test-utils.js";
import type { ApiClients } from "../../client.js";
import { ApiCache } from "../../utils/cache.js";

describe("Insight tools", () => {
  let server: McpServer;
  let client: Client;
  let mockClients: ApiClients;
  let cache: ApiCache;
  let serverTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[1];

  beforeEach(async () => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    mockClients = createMockClients();
    cache = new ApiCache({ defaultTtlMs: 100 });

    registerInsightTools(server, mockClients, cache, "DEFAULT");

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

  describe("get_code_insights", () => {
    test("should fetch reports and annotations", async () => {
      const mockReports = {
        values: [
          { key: "sonar", title: "SonarQube", result: "PASS" },
          { key: "coverage", title: "Coverage", result: "FAIL" },
        ],
      };

      const sonarAnnotations = {
        values: [
          {
            path: "src/index.ts",
            line: 10,
            message: "Bug found",
            severity: "HIGH",
          },
        ],
      };

      const coverageAnnotations = {
        values: [
          {
            path: "src/utils.ts",
            line: 5,
            message: "Not covered",
            severity: "LOW",
          },
        ],
      };

      (mockClients.insights.get as ReturnType<typeof vi.fn>).mockImplementation(
        (url: string) => {
          if (url.endsWith("/reports")) {
            return { json: () => Promise.resolve(mockReports) };
          }
          if (url.includes("/reports/sonar/annotations")) {
            return { json: () => Promise.resolve(sonarAnnotations) };
          }
          if (url.includes("/reports/coverage/annotations")) {
            return { json: () => Promise.resolve(coverageAnnotations) };
          }
          return { json: () => Promise.resolve({ values: [] }) };
        },
      );

      const result = await client.callTool({
        name: "get_code_insights",
        arguments: { project: "TEST", repository: "my-repo", pullRequestId: 1 },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.reports).toHaveLength(2);
      expect(parsed.reports[0].key).toBe("sonar");
      expect(parsed.reports[1].key).toBe("coverage");

      expect(parsed.annotations["sonar"]).toHaveLength(1);
      expect(parsed.annotations["sonar"][0].message).toBe("Bug found");

      expect(parsed.annotations["coverage"]).toHaveLength(1);
      expect(parsed.annotations["coverage"][0].message).toBe("Not covered");
    });

    test("should use default project when not provided", async () => {
      mockJson(mockClients.insights.get, { values: [] });

      await client.callTool({
        name: "get_code_insights",
        arguments: { repository: "my-repo", pullRequestId: 1 },
      });

      expect(mockClients.insights.get).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/1/reports",
        expect.anything(),
      );
    });

    test("should default annotations to empty array on error", async () => {
      const mockReports = {
        values: [{ key: "broken-report", title: "Broken", result: "PASS" }],
      };

      (mockClients.insights.get as ReturnType<typeof vi.fn>).mockImplementation(
        (url: string) => {
          if (url.endsWith("/reports")) {
            return { json: () => Promise.resolve(mockReports) };
          }
          return {
            json: () => Promise.reject(new Error("Annotations not available")),
          };
        },
      );

      const result = await client.callTool({
        name: "get_code_insights",
        arguments: { project: "TEST", repository: "my-repo", pullRequestId: 1 },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.reports).toHaveLength(1);
      expect(parsed.annotations["broken-report"]).toEqual([]);
    });

    test("should handle reports fetch error", async () => {
      (mockClients.insights.get as ReturnType<typeof vi.fn>).mockReturnValue({
        json: () => Promise.reject(new Error("Server error")),
      });

      const result = await client.callTool({
        name: "get_code_insights",
        arguments: { project: "TEST", repository: "my-repo", pullRequestId: 1 },
      });

      expect(result.isError).toBe(true);
    });

    test("should handle empty reports list", async () => {
      mockJson(mockClients.insights.get, { values: [] });

      const result = await client.callTool({
        name: "get_code_insights",
        arguments: { project: "TEST", repository: "my-repo", pullRequestId: 1 },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.reports).toHaveLength(0);
      expect(parsed.annotations).toEqual({});
    });
  });
});
