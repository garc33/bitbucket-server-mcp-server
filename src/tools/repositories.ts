import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClients } from "../client.js";
import type { ApiCache } from "../utils/cache.js";
import { formatResponse } from "../utils/response.js";
import { handleToolError } from "../utils/errors.js";
import {
  curateList,
  DEFAULT_PROJECT_FIELDS,
  DEFAULT_REPOSITORY_FIELDS,
} from "../utils/curate.js";

function resolveProject(
  provided: string | undefined,
  defaultProject?: string,
): string {
  const project = provided || defaultProject;
  if (!project) {
    throw new Error(
      "Project is required. Provide it as a parameter or set BITBUCKET_DEFAULT_PROJECT.",
    );
  }
  return project;
}

export function registerRepositoryTools(
  server: McpServer,
  clients: ApiClients,
  cache: ApiCache,
  defaultProject?: string,
) {
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
}
