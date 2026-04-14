import { writeFile, mkdir } from "node:fs/promises";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerRepositoryTools } from "../../tools/repositories.js";
import {
  type MockApiClients,
  createMockClients,
  mockJson,
} from "../test-utils.js";
import { ApiCache } from "../../http/cache.js";

describe("Repository tools", () => {
  let server: McpServer;
  let client: Client;
  let mockClients: MockApiClients;
  let cache: ApiCache;
  let serverTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[1];

  beforeEach(async () => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    mockClients = createMockClients();
    cache = new ApiCache({ defaultTtlMs: 100 });

    registerRepositoryTools({
      server,
      clients: mockClients,
      cache,
      defaultProject: "DEFAULT",
    });

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

      mockJson(mockClients.api.get, mockResponse);

      const result = await client.callTool({
        name: "list_projects",
        arguments: { limit: 10 },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

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

      mockJson(mockClients.api.get, mockResponse);

      const result = await client.callTool({
        name: "list_projects",
        arguments: {},
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

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

      mockJson(mockClients.api.get, mockResponse);

      const result = await client.callTool({
        name: "list_repositories",
        arguments: { project: "TEST" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.repositories).toHaveLength(1);
      expect(parsed.repositories[0].slug).toBe("my-repo");
    });

    test("should use default project when not provided", async () => {
      mockJson(mockClients.api.get, { values: [], size: 0, isLastPage: true });

      await client.callTool({ name: "list_repositories", arguments: {} });

      expect(mockClients.api.get).toHaveBeenCalledWith(
        "projects/DEFAULT/repos",
        expect.anything(),
      );
    });
  });

  describe("browse_repository", () => {
    test("should browse root directory", async () => {
      mockJson(mockClients.api.get, {
        children: {
          values: [
            { path: { toString: "src" }, type: "DIRECTORY" },
            { path: { toString: "README.md" }, type: "FILE" },
          ],
          size: 2,
        },
      });

      const result = await client.callTool({
        name: "browse_repository",
        arguments: { project: "TEST", repository: "my-repo" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].type).toBe("text");
    });
  });

  describe("upload_attachment", () => {
    test("should upload a local file and return image markdown reference", async () => {
      const tmpDir = "/tmp/bitbucket-mcp-test";
      await mkdir(tmpDir, { recursive: true });
      await writeFile(`${tmpDir}/screenshot.png`, "fake-png-content");

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

      mockJson(mockClients.api.post, mockResponse);

      const result = await client.callTool({
        name: "upload_attachment",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          filePath: `${tmpDir}/screenshot.png`,
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(content[0].text);

      expect(parsed.id).toBe(3);
      expect(parsed.markdown).toBe("![screenshot.png](attachment:1/3)");
      expect(mockClients.api.post).toHaveBeenCalledWith(
        "projects/TEST/repos/my-repo/attachments",
        expect.objectContaining({ body: expect.any(FormData) }),
      );
    });

    test("should use link markdown for non-image files", async () => {
      const tmpDir = "/tmp/bitbucket-mcp-test";
      await mkdir(tmpDir, { recursive: true });
      await writeFile(`${tmpDir}/report.pdf`, "fake-pdf-content");

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

      mockJson(mockClients.api.post, mockResponse);

      const result = await client.callTool({
        name: "upload_attachment",
        arguments: {
          project: "TEST",
          repository: "my-repo",
          filePath: `${tmpDir}/report.pdf`,
        },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.markdown).toBe("[report.pdf](attachment:1/5)");
    });
  });

  describe("get_file_content", () => {
    test("should read file content", async () => {
      mockJson(mockClients.api.get, {
        lines: [{ text: "line 1" }, { text: "line 2" }],
        size: 2,
        isLastPage: true,
      });

      const result = await client.callTool({
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
  });
});
