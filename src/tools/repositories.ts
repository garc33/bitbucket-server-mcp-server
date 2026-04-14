import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import { formatResponse } from "../response/format.js";
import { toolAnnotations } from "../response/annotations.js";
import { handleToolError } from "../http/errors.js";
import {
  curateList,
  DEFAULT_PROJECT_FIELDS,
  DEFAULT_REPOSITORY_FIELDS,
} from "../response/curate.js";
import { resolveProject } from "./shared.js";
import type { ToolContext } from "./shared.js";

export function registerRepositoryTools(ctx: ToolContext) {
  const { server, clients, defaultProject } = ctx;
  server.registerTool(
    "list_projects",
    {
      description:
        "List all Bitbucket projects you have access to. Use this first to discover project keys.",
      inputSchema: {
        limit: z
          .number()
          .optional()
          .describe("Number of projects to return (default: 25, max: 1000)"),
        start: z
          .number()
          .optional()
          .describe("Start index for pagination (default: 0)"),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated fields to return. Defaults to: key, id, name, description, type, public. Use '*all' for the full API response.",
          ),
      },
      annotations: toolAnnotations(),
    },
    async ({ limit = 25, start = 0, fields }) => {
      try {
        const data = await clients.api
          .get("projects", {
            searchParams: { limit, start },
          })
          .json<{
            values: Record<string, unknown>[];
            size: number;
            isLastPage: boolean;
          }>();

        return formatResponse({
          total: data.size,
          projects: curateList(data.values, fields ?? DEFAULT_PROJECT_FIELDS),
          isLastPage: data.isLastPage,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "list_repositories",
    {
      description:
        "List repositories in a project. Use this to find repository slugs for other operations.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        limit: z
          .number()
          .optional()
          .describe(
            "Number of repositories to return (default: 25, max: 1000)",
          ),
        start: z
          .number()
          .optional()
          .describe("Start index for pagination (default: 0)"),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated fields to return. Defaults to: slug, id, name, description, state, forkable, project (key, name). Use '*all' for the full API response with clone URLs and links.",
          ),
      },
      annotations: toolAnnotations(),
    },
    async ({ project, limit = 25, start = 0, fields }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);
        const data = await clients.api
          .get(`projects/${resolvedProject}/repos`, {
            searchParams: { limit, start },
          })
          .json<{
            values: Record<string, unknown>[];
            size: number;
            isLastPage: boolean;
          }>();

        return formatResponse({
          total: data.size,
          repositories: curateList(
            data.values,
            fields ?? DEFAULT_REPOSITORY_FIELDS,
          ),
          isLastPage: data.isLastPage,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "browse_repository",
    {
      description:
        "Browse files and directories in a repository to understand project structure.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        path: z
          .string()
          .optional()
          .describe("Directory path to browse (default: root)."),
        branch: z
          .string()
          .optional()
          .describe("Branch or commit hash (default: default branch)."),
        limit: z
          .number()
          .optional()
          .describe("Max items to return (default: 50)."),
      },
      annotations: toolAnnotations(),
    },
    async ({ project, repository, path, branch, limit = 50 }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);
        const endpoint = path
          ? `projects/${resolvedProject}/repos/${repository}/browse/${path}`
          : `projects/${resolvedProject}/repos/${repository}/browse`;

        const searchParams: Record<string, string | number> = { limit };
        if (branch) searchParams.at = branch;

        const data = await clients.api.get(endpoint, { searchParams }).json();
        return formatResponse(data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "get_file_content",
    {
      description:
        "Read file contents from a repository with pagination support for large files.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        filePath: z.string().describe("Path to the file in the repository."),
        branch: z
          .string()
          .optional()
          .describe("Branch or commit hash (default: default branch)."),
        limit: z
          .number()
          .optional()
          .describe("Max lines per request (default: 100, max: 1000)."),
        start: z
          .number()
          .optional()
          .describe("Starting line number (default: 0)."),
      },
      annotations: toolAnnotations(),
    },
    async ({
      project,
      repository,
      filePath,
      branch,
      limit = 100,
      start = 0,
    }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);
        const searchParams: Record<string, string | number> = { limit, start };
        if (branch) searchParams.at = branch;

        const data = await clients.api
          .get(
            `projects/${resolvedProject}/repos/${repository}/browse/${filePath}`,
            { searchParams },
          )
          .json();

        return formatResponse(data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "upload_attachment",
    {
      description:
        "Upload a file attachment to a repository. Returns a markdown reference to embed in PR comments or descriptions.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        filePath: z
          .string()
          .describe("Absolute path to the file on the local filesystem."),
      },
      annotations: toolAnnotations({
        readOnlyHint: false,
        idempotentHint: false,
      }),
    },
    async ({ project, repository, filePath }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);

        const fileBuffer = await readFile(filePath);
        const fileName = basename(filePath);
        const blob = new Blob([fileBuffer]);
        const formData = new FormData();
        formData.append("files", blob, fileName);

        const data = await clients.api
          .post(`projects/${resolvedProject}/repos/${repository}/attachments`, {
            body: formData,
          })
          .json<{
            attachments: Array<{
              id: number;
              url: string;
              links: {
                self: { href: string };
                attachment: { href: string };
              };
            }>;
          }>();

        const attachment = data.attachments[0];
        const ref = attachment.links.attachment.href;
        const isImage = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(fileName);
        const markdown = isImage
          ? `![${fileName}](${ref})`
          : `[${fileName}](${ref})`;

        return formatResponse({
          id: attachment.id,
          url: attachment.url,
          ref,
          markdown,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
  );
}
