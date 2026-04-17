import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { registerRepositoryTools } from "../../tools/repositories.js";
import { mockError, mockJson } from "../test-utils.js";
import {
  callAndParse,
  callAndParseFull,
  callRaw,
  expectCalledWith,
  expectCalledWithSearchParams,
  setupToolHarness,
} from "../tool-test-utils.js";

describe("Repository tools", () => {
  const h = setupToolHarness({
    register: registerRepositoryTools,
    defaultProject: "DEFAULT",
  });

  describe("list_projects", () => {
    test("should list projects with pagination", async () => {
      const mockResponse = {
        values: [
          {
            key: "PROJ",
            name: "Project",
            description: "Test",
            public: false,
            type: "NORMAL",
          },
        ],
        size: 1,
        isLastPage: true,
      };

      mockJson(h.mockClients.api.get, mockResponse);

      const parsed = await callAndParse<{
        total: number;
        projects: Array<{ key: string }>;
      }>(h.client, "list_projects", { limit: 10 });

      expect(parsed.total).toBe(1);
      expect(parsed.projects).toHaveLength(1);
      expect(parsed.projects[0].key).toBe("PROJ");
    });

    test("should return curated output with default fields", async () => {
      const mockResponse = {
        values: [
          {
            key: "PROJ",
            id: 1,
            name: "Project",
            description: "Test",
            public: false,
            type: "NORMAL",
            links: { self: [{ href: "http://example.com" }] },
            extraField: "should be removed",
          },
        ],
        size: 1,
        isLastPage: true,
      };

      mockJson(h.mockClients.api.get, mockResponse);

      const parsed = await callAndParse<{
        projects: Array<Record<string, unknown>>;
      }>(h.client, "list_projects", {});

      const project = parsed.projects[0];
      expect(project.key).toBe("PROJ");
      expect(project.name).toBe("Project");
      expect(project).not.toHaveProperty("links");
      expect(project).not.toHaveProperty("extraField");
    });
  });

  describe("list_repositories", () => {
    test("should list repositories for a project", async () => {
      const mockResponse = {
        values: [
          {
            slug: "my-repo",
            name: "My Repo",
            project: { key: "TEST" },
            state: "AVAILABLE",
          },
        ],
        size: 1,
        isLastPage: true,
      };

      mockJson(h.mockClients.api.get, mockResponse);

      const parsed = await callAndParse<{
        repositories: Array<{ slug: string }>;
      }>(h.client, "list_repositories", { project: "TEST" });

      expect(parsed.repositories).toHaveLength(1);
      expect(parsed.repositories[0].slug).toBe("my-repo");
    });

    test("should use default project when not provided", async () => {
      mockJson(h.mockClients.api.get, {
        values: [],
        size: 0,
        isLastPage: true,
      });

      await callAndParse(h.client, "list_repositories", {});

      expect(h.mockClients.api.get).toHaveBeenCalledWith(
        "projects/DEFAULT/repos",
        expect.anything(),
      );
    });
  });

  describe("browse_repository", () => {
    test("should browse root directory", async () => {
      mockJson(h.mockClients.api.get, {
        children: {
          values: [
            { path: { toString: "src" }, type: "DIRECTORY" },
            { path: { toString: "README.md" }, type: "FILE" },
          ],
          size: 2,
        },
      });

      const result = await h.client.callTool({
        name: "browse_repository",
        arguments: { project: "TEST", repository: "my-repo" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].type).toBe("text");
    });

    test("should browse a specific path", async () => {
      mockJson(h.mockClients.api.get, {
        children: {
          values: [{ path: { toString: "index.ts" }, type: "FILE" }],
          size: 1,
        },
      });

      await h.client.callTool({
        name: "browse_repository",
        arguments: { project: "TEST", repository: "my-repo", path: "src" },
      });

      expect(h.mockClients.api.get).toHaveBeenCalledWith(
        "projects/TEST/repos/my-repo/browse/src",
        expect.anything(),
      );
    });

    test("should pass branch as 'at' search param", async () => {
      mockJson(h.mockClients.api.get, {
        children: { values: [], size: 0 },
      });

      await h.client.callTool({
        name: "browse_repository",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          branch: "develop",
        },
      });

      expectCalledWithSearchParams(
        h.mockClients.api.get,
        "projects/TEST/repos/my-repo/browse",
        { at: "develop" },
      );
    });

    test("should use default project when not provided", async () => {
      mockJson(h.mockClients.api.get, { children: { values: [], size: 0 } });

      await h.client.callTool({
        name: "browse_repository",
        arguments: { repository: "my-repo" },
      });

      expect(h.mockClients.api.get).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/browse",
        expect.anything(),
      );
    });

    test("should handle errors gracefully", async () => {
      mockError(h.mockClients.api.get, new Error("Not Found"));

      const result = await callRaw(h.client, "browse_repository", {
        project: "TEST",
        repository: "nonexistent",
      });

      expect(result.isError).toBe(true);
    });
  });

  describe("upload_attachment", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "bitbucket-mcp-test-"));
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    test("should upload a local file and return image markdown reference", async () => {
      await writeFile(join(tmpDir, "screenshot.png"), "fake-png-content");

      const mockResponse = {
        attachments: [
          {
            id: 3,
            url: "http://bitbucket.example.com/projects/TEST/repos/my-repo/attachments/3",
            links: {
              self: {
                href: "http://bitbucket.example.com/projects/TEST/repos/my-repo/attachments/3",
              },
              attachment: { href: "attachment:1/3" },
            },
          },
        ],
      };

      mockJson(h.mockClients.api.post, mockResponse);

      const { result, parsed } = await callAndParseFull<{
        id: number;
        markdown: string;
      }>(h.client, "upload_attachment", {
        project: "TEST",
        repository: "my-repo",
        filePath: join(tmpDir, "screenshot.png"),
      });

      expect(result.isError).toBeFalsy();

      expect(parsed.id).toBe(3);
      expect(parsed.markdown).toBe("![screenshot.png](attachment:1/3)");
      expectCalledWith(
        h.mockClients.api.post,
        "projects/TEST/repos/my-repo/attachments",
        { body: expect.any(FormData) },
      );
    });

    test("should use link markdown for non-image files", async () => {
      await writeFile(join(tmpDir, "report.pdf"), "fake-pdf-content");

      const mockResponse = {
        attachments: [
          {
            id: 5,
            url: "http://bitbucket.example.com/attachments/5",
            links: {
              self: { href: "http://bitbucket.example.com/attachments/5" },
              attachment: { href: "attachment:1/5" },
            },
          },
        ],
      };

      mockJson(h.mockClients.api.post, mockResponse);

      const parsed = await callAndParse<{ markdown: string }>(
        h.client,
        "upload_attachment",
        {
          project: "TEST",
          repository: "my-repo",
          filePath: join(tmpDir, "report.pdf"),
        },
      );
      expect(parsed.markdown).toBe("[report.pdf](attachment:1/5)");
    });
  });

  describe("get_file_content", () => {
    test("should read file content", async () => {
      mockJson(h.mockClients.api.get, {
        lines: [{ text: "line 1" }, { text: "line 2" }],
        size: 2,
        isLastPage: true,
      });

      const result = await h.client.callTool({
        name: "get_file_content",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          filePath: "README.md",
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].type).toBe("text");
    });

    test("should pass branch as 'at' search param", async () => {
      mockJson(h.mockClients.api.get, {
        lines: [{ text: "content" }],
        size: 1,
        isLastPage: true,
      });

      await h.client.callTool({
        name: "get_file_content",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          filePath: "src/index.ts",
          branch: "feature-branch",
        },
      });

      expectCalledWithSearchParams(
        h.mockClients.api.get,
        "projects/TEST/repos/my-repo/browse/src/index.ts",
        { at: "feature-branch" },
      );
    });

    test("should pass limit and start for pagination", async () => {
      mockJson(h.mockClients.api.get, {
        lines: [{ text: "line 50" }],
        size: 1,
        isLastPage: false,
      });

      await h.client.callTool({
        name: "get_file_content",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          filePath: "big-file.ts",
          limit: 50,
          start: 100,
        },
      });

      expectCalledWithSearchParams(
        h.mockClients.api.get,
        "projects/TEST/repos/my-repo/browse/big-file.ts",
        { limit: 50, start: 100 },
      );
    });

    test("should use default project when not provided", async () => {
      mockJson(h.mockClients.api.get, { lines: [], size: 0, isLastPage: true });

      await h.client.callTool({
        name: "get_file_content",
        arguments: { repository: "my-repo", filePath: "README.md" },
      });

      expect(h.mockClients.api.get).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/browse/README.md",
        expect.anything(),
      );
    });

    test("should handle errors gracefully", async () => {
      mockError(h.mockClients.api.get, new Error("File not found"));

      const result = await callRaw(h.client, "get_file_content", {
        project: "TEST",
        repository: "my-repo",
        filePath: "missing.ts",
      });

      expect(result.isError).toBe(true);
    });
  });

  describe("get_server_info", () => {
    test("should return server properties", async () => {
      mockJson(h.mockClients.api.get, {
        version: "8.19.1",
        buildNumber: "8190100",
        displayName: "Bitbucket",
      });

      const parsed = await callAndParse<{
        version: string;
        displayName: string;
      }>(h.client, "get_server_info", {});
      expect(parsed.version).toBe("8.19.1");
      expect(parsed.displayName).toBe("Bitbucket");
    });

    test("should handle errors gracefully", async () => {
      mockError(h.mockClients.api.get, new Error("Connection refused"));

      const result = await callRaw(h.client, "get_server_info", {});

      expect(result.isError).toBe(true);
    });
  });

  describe("list_projects", () => {
    test("should pass fields='*all' to bypass curation", async () => {
      const mockResponse = {
        values: [
          {
            key: "PROJ",
            name: "Project",
            links: { self: [{ href: "https://example.com" }] },
            extra: "data",
          },
        ],
        size: 1,
        isLastPage: true,
      };

      mockJson(h.mockClients.api.get, mockResponse);

      const parsed = await callAndParse<{
        projects: Array<Record<string, unknown>>;
      }>(h.client, "list_projects", { fields: "*all" });
      expect(parsed.projects[0]).toHaveProperty("links");
      expect(parsed.projects[0]).toHaveProperty("extra");
    });

    test("should handle errors gracefully", async () => {
      mockError(h.mockClients.api.get, new Error("Server error"));

      const result = await callRaw(h.client, "list_projects", {});

      expect(result.isError).toBe(true);
    });
  });

  describe("list_repositories", () => {
    test("should pass fields='*all' to bypass curation", async () => {
      const mockResponse = {
        values: [
          { slug: "repo", name: "Repo", links: { clone: [] }, extra: "data" },
        ],
        size: 1,
        isLastPage: true,
      };

      mockJson(h.mockClients.api.get, mockResponse);

      const parsed = await callAndParse<{
        repositories: Array<Record<string, unknown>>;
      }>(h.client, "list_repositories", { project: "TEST", fields: "*all" });
      expect(parsed.repositories[0]).toHaveProperty("links");
      expect(parsed.repositories[0]).toHaveProperty("extra");
    });

    test.each([
      { limit: 0, start: 0 },
      { limit: 1, start: 0 },
      { limit: 1000, start: 0 },
      { limit: 25, start: 99999 },
    ])(
      "list_repositories passes limit=$limit start=$start (boundary)",
      async ({ limit, start }) => {
        mockJson(h.mockClients.api.get, {
          values: [],
          size: 0,
          isLastPage: true,
        });
        await h.client.callTool({
          name: "list_repositories",
          arguments: { project: "P", limit, start },
        });
        expectCalledWithSearchParams(
          h.mockClients.api.get,
          "projects/P/repos",
          { limit, start },
        );
      },
    );

    test.each([
      { limit: 0, start: 0 },
      { limit: 1, start: 0 },
      { limit: 1000, start: 0 },
      { limit: 25, start: 99999 },
    ])(
      "list_projects passes limit=$limit start=$start (boundary)",
      async ({ limit, start }) => {
        mockJson(h.mockClients.api.get, {
          values: [],
          size: 0,
          isLastPage: true,
        });
        await h.client.callTool({
          name: "list_projects",
          arguments: { limit, start },
        });
        expectCalledWithSearchParams(h.mockClients.api.get, "projects", {
          limit,
          start,
        });
      },
    );

    test("should handle errors gracefully", async () => {
      mockError(h.mockClients.api.get, new Error("Not Found"));

      const result = await callRaw(h.client, "list_repositories", {
        project: "NONEXISTENT",
      });

      expect(result.isError).toBe(true);
    });
  });
});
