import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClients } from "../client.js";
import type { ApiCache } from "../utils/cache.js";
import { formatResponse } from "../utils/response.js";
import { handleToolError } from "../utils/errors.js";
import {
  curateList,
  curateResponse,
  DEFAULT_BRANCH_FIELDS,
  DEFAULT_COMMIT_FIELDS,
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

interface CommitAuthor {
  name?: string;
  slug?: string;
  displayName?: string;
}

interface Commit {
  author?: CommitAuthor;
  [key: string]: unknown;
}

export function registerBranchTools(
  server: McpServer,
  clients: ApiClients,
  cache: ApiCache,
  defaultProject?: string,
) {
  server.registerTool(
    "list_branches",
    {
      description:
        "List branches in a repository. Also returns the default branch when available.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        filterText: z
          .string()
          .optional()
          .describe("Filter branches by name substring."),
        limit: z
          .number()
          .optional()
          .describe("Number of branches to return (default: 25, max: 1000)."),
        start: z
          .number()
          .optional()
          .describe("Start index for pagination (default: 0)."),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated fields to return. Defaults to: id, displayId, type, latestCommit, isDefault, metadata. Use '*all' for the full API response.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      project,
      repository,
      filterText,
      limit = 25,
      start = 0,
      fields,
    }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);
        const searchParams: Record<string, string | number> = { limit, start };
        if (filterText) searchParams.filterText = filterText;

        const [branchData, defaultBranch] = await Promise.all([
          clients.api
            .get(`projects/${resolvedProject}/repos/${repository}/branches`, {
              searchParams,
            })
            .json<{
              values: Record<string, unknown>[];
              size: number;
              isLastPage: boolean;
            }>(),
          clients.api
            .get(
              `projects/${resolvedProject}/repos/${repository}/default-branch`,
            )
            .json<Record<string, unknown>>()
            .catch(() => null),
        ]);

        const activeFields = fields ?? DEFAULT_BRANCH_FIELDS;

        return formatResponse({
          total: branchData.size,
          branches: curateList(branchData.values, activeFields),
          isLastPage: branchData.isLastPage,
          defaultBranch: defaultBranch
            ? curateResponse(defaultBranch, activeFields)
            : null,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "list_commits",
    {
      description:
        "List commits in a repository, optionally filtered by branch and author.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        branch: z
          .string()
          .optional()
          .describe("Branch name to list commits from."),
        author: z
          .string()
          .optional()
          .describe(
            "Filter commits by author (case-insensitive match on name, slug, or displayName).",
          ),
        limit: z
          .number()
          .optional()
          .describe("Number of commits to return (default: 25, max: 1000)."),
        start: z
          .number()
          .optional()
          .describe("Start index for pagination (default: 0)."),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated fields to return. Defaults to: id, displayId, message, author (name, email), authorTimestamp, parents. Use '*all' for the full API response.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      project,
      repository,
      branch,
      author,
      limit = 25,
      start = 0,
      fields,
    }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);
        const searchParams: Record<string, string | number> = { limit, start };
        if (branch) searchParams.until = branch;

        const data = await clients.api
          .get(`projects/${resolvedProject}/repos/${repository}/commits`, {
            searchParams,
          })
          .json<{ values: Commit[]; size: number; isLastPage: boolean }>();

        let commits = data.values;

        if (author) {
          const authorLower = author.toLowerCase();
          commits = commits.filter((commit) => {
            const a = commit.author;
            if (!a) return false;
            return (
              a.name?.toLowerCase().includes(authorLower) ||
              a.slug?.toLowerCase().includes(authorLower) ||
              a.displayName?.toLowerCase().includes(authorLower)
            );
          });
        }

        return formatResponse({
          total: author ? commits.length : data.size,
          commits: curateList(
            commits as Record<string, unknown>[],
            fields ?? DEFAULT_COMMIT_FIELDS,
          ),
          isLastPage: data.isLastPage,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "delete_branch",
    {
      description:
        "Delete a branch from a repository. Refuses to delete the default branch.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        branch: z.string().describe("Branch name to delete."),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project, repository, branch }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);

        const defaultBranch = await clients.api
          .get(`projects/${resolvedProject}/repos/${repository}/default-branch`)
          .json<{ displayId?: string }>();

        if (defaultBranch.displayId === branch) {
          throw new Error(`Cannot delete the default branch "${branch}".`);
        }

        await clients.branchUtils
          .post(`projects/${resolvedProject}/repos/${repository}/branches`, {
            json: { name: `refs/heads/${branch}`, dryRun: false },
          })
          .json();

        return formatResponse({ deleted: true, branch });
      } catch (error) {
        return handleToolError(error);
      }
    },
  );
}
