import { describe, test, expect } from "vitest";
import type { Input } from "ky";
import { registerInsightTools } from "../../tools/insights.js";
import { fakeResponse, mockError, mockJson } from "../test-utils.js";
import { callAndParse, setupToolHarness } from "../tool-test-utils.js";

describe("Insight tools", () => {
  const h = setupToolHarness({
    register: registerInsightTools,
    defaultProject: "DEFAULT",
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

      h.mockClients.insights.get.mockImplementation((url: Input) => {
        if (String(url).endsWith("/reports")) {
          return fakeResponse({ json: () => Promise.resolve(mockReports) });
        }
        if (String(url).includes("/reports/sonar/annotations")) {
          return fakeResponse({
            json: () => Promise.resolve(sonarAnnotations),
          });
        }
        if (String(url).includes("/reports/coverage/annotations")) {
          return fakeResponse({
            json: () => Promise.resolve(coverageAnnotations),
          });
        }
        return fakeResponse({ json: () => Promise.resolve({ values: [] }) });
      });

      const parsed = await callAndParse<{
        reports: Array<{ key: string }>;
        annotations: Record<string, Array<{ message: string }>>;
      }>(h.client, "get_code_insights", {
        project: "TEST",
        repository: "my-repo",
        pullRequestId: 1,
      });

      expect(parsed.reports).toHaveLength(2);
      expect(parsed.reports[0].key).toBe("sonar");
      expect(parsed.reports[1].key).toBe("coverage");

      expect(parsed.annotations["sonar"]).toHaveLength(1);
      expect(parsed.annotations["sonar"][0].message).toBe("Bug found");

      expect(parsed.annotations["coverage"]).toHaveLength(1);
      expect(parsed.annotations["coverage"][0].message).toBe("Not covered");
    });

    test("should use default project when not provided", async () => {
      mockJson(h.mockClients.insights.get, { values: [] });

      await h.client.callTool({
        name: "get_code_insights",
        arguments: { repository: "my-repo", pullRequestId: 1 },
      });

      expect(h.mockClients.insights.get).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/pull-requests/1/reports",
        expect.anything(),
      );
    });

    test("should default annotations to empty array on error", async () => {
      const mockReports = {
        values: [{ key: "broken-report", title: "Broken", result: "PASS" }],
      };

      h.mockClients.insights.get.mockImplementation((url: Input) => {
        if (String(url).endsWith("/reports")) {
          return fakeResponse({ json: () => Promise.resolve(mockReports) });
        }
        return fakeResponse({
          json: () => Promise.reject(new Error("Annotations not available")),
        });
      });

      const parsed = await callAndParse<{
        reports: Array<{ key: string }>;
        annotations: Record<string, unknown[]>;
      }>(h.client, "get_code_insights", {
        project: "TEST",
        repository: "my-repo",
        pullRequestId: 1,
      });

      expect(parsed.reports).toHaveLength(1);
      expect(parsed.annotations["broken-report"]).toEqual([]);
    });

    test("should handle reports fetch error", async () => {
      mockError(h.mockClients.insights.get, new Error("Server error"));

      const result = await h.client.callTool({
        name: "get_code_insights",
        arguments: { project: "TEST", repository: "my-repo", pullRequestId: 1 },
      });

      expect(result.isError).toBe(true);
    });

    test("should skip reports without a key", async () => {
      mockJson(h.mockClients.insights.get, {
        values: [
          { key: "sonar", title: "SonarQube", result: "PASS" },
          { title: "No Key Report", result: "PASS" },
        ],
      });

      h.mockClients.insights.get.mockImplementation((url: Input) => {
        if (String(url).includes("/reports/sonar/annotations")) {
          return fakeResponse({
            json: () => Promise.resolve({ values: [{ message: "Bug" }] }),
          });
        }
        return fakeResponse({ json: () => Promise.resolve({ values: [] }) });
      });

      const parsed = await callAndParse<{
        reports: unknown[];
        annotations: Record<string, unknown[]>;
      }>(h.client, "get_code_insights", {
        project: "TEST",
        repository: "my-repo",
        pullRequestId: 1,
      });

      expect(parsed.reports).toHaveLength(2);
      expect(parsed.annotations["sonar"]).toHaveLength(1);
      expect(parsed.annotations).not.toHaveProperty("undefined");
    });

    test("should handle empty reports list", async () => {
      mockJson(h.mockClients.insights.get, { values: [] });

      const parsed = await callAndParse<{
        reports: unknown[];
        annotations: Record<string, unknown>;
      }>(h.client, "get_code_insights", {
        project: "TEST",
        repository: "my-repo",
        pullRequestId: 1,
      });

      expect(parsed.reports).toHaveLength(0);
      expect(parsed.annotations).toEqual({});
    });
  });

  describe("get_build_status", () => {
    test("should fetch build status by commit ID", async () => {
      mockJson(h.mockClients.buildStatus.get, {
        values: [
          {
            state: "SUCCESSFUL",
            key: "jenkins-123",
            name: "Build #123",
            url: "https://jenkins.example.com/job/123",
          },
        ],
      });

      const parsed = await callAndParse<Array<{ state: string; url: string }>>(
        h.client,
        "get_build_status",
        { commitId: "abc123def456" },
      );

      expect(parsed).toHaveLength(1);
      expect(parsed[0].state).toBe("SUCCESSFUL");
      expect(parsed[0].url).toBe("https://jenkins.example.com/job/123");
      expect(h.mockClients.buildStatus.get).toHaveBeenCalledWith(
        "commits/abc123def456",
      );
    });

    test("should resolve latest commit from PR and fetch build status", async () => {
      mockJson(h.mockClients.api.get, {
        fromRef: { latestCommit: "resolved999" },
      });

      mockJson(h.mockClients.buildStatus.get, {
        values: [
          {
            state: "FAILED",
            name: "Build #99",
            url: "https://ci.example.com/99",
          },
        ],
      });

      const parsed = await callAndParse<Array<{ state: string }>>(
        h.client,
        "get_build_status",
        { project: "PROJ", repository: "my-repo", prId: 42 },
      );

      expect(parsed[0].state).toBe("FAILED");
      expect(h.mockClients.buildStatus.get).toHaveBeenCalledWith(
        "commits/resolved999",
      );
    });

    test("should return error when neither commitId nor prId provided", async () => {
      const result = await h.client.callTool({
        name: "get_build_status",
        arguments: {},
      });

      expect(result.isError).toBe(true);
    });

    test("should return error when prId provided but no repository", async () => {
      const result = await h.client.callTool({
        name: "get_build_status",
        arguments: { prId: 42 },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("repository is required");
    });

    test("should return empty array when commit has no build statuses", async () => {
      mockJson(h.mockClients.buildStatus.get, { values: [] });

      const parsed = await callAndParse<unknown[]>(
        h.client,
        "get_build_status",
        { commitId: "abc123" },
      );
      expect(parsed).toEqual([]);
    });

    test.each(["SUCCESSFUL", "FAILED", "INPROGRESS"])(
      "returns build status %s correctly",
      async (state) => {
        mockJson(h.mockClients.buildStatus.get, {
          values: [{ state, name: "build", url: "https://ci.example.com" }],
        });

        const parsed = await callAndParse<Array<{ state: string }>>(
          h.client,
          "get_build_status",
          { commitId: "abc" },
        );
        expect(parsed[0].state).toBe(state);
      },
    );
  });
});
