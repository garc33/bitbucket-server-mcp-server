import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClients } from "../client.js";
import type { ApiCache } from "../utils/cache.js";
import { formatResponse } from "../utils/response.js";
import { handleToolError } from "../utils/errors.js";
import { truncateDiff } from "../utils/diff.js";
import {
  curateResponse,
  curateList,
  DEFAULT_PR_FIELDS,
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

interface PrAuthor {
  user?: { name?: string; slug?: string; displayName?: string };
}

interface PullRequest {
  id: number;
  version: number;
  title: string;
  description?: string;
  state: string;
  fromRef: {
    id: string;
    displayId: string;
    repository: { slug: string; project: { key: string } };
  };
  toRef: {
    id: string;
    displayId: string;
    repository: { slug: string; project: { key: string } };
  };
  reviewers: Array<{ user: { name: string }; status?: string }>;
  author?: PrAuthor;
  [key: string]: unknown;
}

interface Activity {
  action: string;
  [key: string]: unknown;
}

interface Reviewer {
  name: string;
  [key: string]: unknown;
}

export function registerPullRequestTools(
  server: McpServer,
  clients: ApiClients,
  cache: ApiCache,
  defaultProject?: string,
  defaultMaxLinesPerFile?: number,
) {
  // ── create_pull_request ──────────────────────────────────────────────
  server.registerTool(
    "create_pull_request",
    {
      description:
        "Create a new pull request. Supports cross-repo PRs via sourceProject/sourceRepository and automatic default reviewer merging.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        title: z.string().describe("Pull request title."),
        description: z
          .string()
          .optional()
          .describe("Pull request description (Markdown supported)."),
        sourceBranch: z.string().describe("Source branch name."),
        targetBranch: z.string().describe("Target branch name."),
        sourceProject: z
          .string()
          .optional()
          .describe("Source project key for cross-repo PRs."),
        sourceRepository: z
          .string()
          .optional()
          .describe("Source repository slug for cross-repo PRs."),
        reviewers: z
          .array(z.string())
          .optional()
          .describe("Usernames to assign as reviewers."),
        includeDefaultReviewers: z
          .boolean()
          .optional()
          .describe(
            "Merge default reviewers into the reviewer list (default: true).",
          ),
      },
    },
    async ({
      project,
      repository,
      title,
      description,
      sourceBranch,
      targetBranch,
      sourceProject,
      sourceRepository,
      reviewers,
      includeDefaultReviewers,
    }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);
        const srcProject = sourceProject || resolvedProject;
        const srcRepo = sourceRepository || repository;

        const allReviewers = (reviewers ?? []).map((name) => ({
          user: { name },
        }));

        // Fetch and merge default reviewers unless explicitly disabled
        if (includeDefaultReviewers !== false) {
          try {
            // Get repo IDs for the default-reviewers endpoint
            const [sourceRepoData, targetRepoData] = await Promise.all([
              clients.api
                .get(`projects/${srcProject}/repos/${srcRepo}`)
                .json<{ id: number }>(),
              srcProject === resolvedProject && srcRepo === repository
                ? Promise.resolve(null)
                : clients.api
                    .get(`projects/${resolvedProject}/repos/${repository}`)
                    .json<{ id: number }>(),
            ]);

            const sourceRepoId = sourceRepoData.id;
            const targetRepoId = targetRepoData
              ? targetRepoData.id
              : sourceRepoData.id;

            const defaultReviewersList = await clients.defaultReviewers
              .get(
                `projects/${resolvedProject}/repos/${repository}/reviewers`,
                {
                  searchParams: {
                    sourceRepoId,
                    targetRepoId,
                    sourceRefId: `refs/heads/${sourceBranch}`,
                    targetRefId: `refs/heads/${targetBranch}`,
                  },
                },
              )
              .json<Reviewer[]>();

            if (Array.isArray(defaultReviewersList)) {
              const existingNames = new Set(
                allReviewers.map((r) => r.user.name),
              );
              for (const reviewer of defaultReviewersList) {
                if (!existingNames.has(reviewer.name)) {
                  allReviewers.push({ user: { name: reviewer.name } });
                  existingNames.add(reviewer.name);
                }
              }
            }
          } catch {
            // Proceed without default reviewers on error
          }
        }

        const body: Record<string, unknown> = {
          title,
          description,
          fromRef: {
            id: `refs/heads/${sourceBranch}`,
            repository: {
              slug: srcRepo,
              project: { key: srcProject },
            },
          },
          toRef: {
            id: `refs/heads/${targetBranch}`,
            repository: {
              slug: repository,
              project: { key: resolvedProject },
            },
          },
          reviewers: allReviewers,
        };

        const data = await clients.api
          .post(
            `projects/${resolvedProject}/repos/${repository}/pull-requests`,
            { json: body },
          )
          .json();

        return formatResponse(data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  // ── get_pull_request ─────────────────────────────────────────────────
  server.registerTool(
    "get_pull_request",
    {
      description:
        "Get details of a specific pull request including status, reviewers, and metadata.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        prId: z.number().describe("Pull request ID."),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated fields to return. Defaults to: id, title, description, state, dates, author (name, displayName, status), branches (displayId), reviewers (name, displayName, status, approved), properties (commentCount, taskCount). Use '*all' for the full API response with all nested objects.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project, repository, prId, fields }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);
        const data = await clients.api
          .get(
            `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}`,
          )
          .json<Record<string, unknown>>();

        return formatResponse(
          curateResponse(data, fields ?? DEFAULT_PR_FIELDS),
        );
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  // ── update_pull_request ──────────────────────────────────────────────
  server.registerTool(
    "update_pull_request",
    {
      description:
        "Update a pull request (title, description, target branch, or reviewers). Only changed fields are applied; reviewers are preserved if not provided.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        prId: z.number().describe("Pull request ID."),
        title: z.string().optional().describe("New title."),
        description: z.string().optional().describe("New description."),
        targetBranch: z.string().optional().describe("New target branch."),
        reviewers: z
          .array(z.string())
          .optional()
          .describe("Replace reviewer list with these usernames."),
      },
    },
    async ({
      project,
      repository,
      prId,
      title,
      description,
      targetBranch,
      reviewers,
    }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);

        // Fetch current PR state
        const current = await clients.api
          .get(
            `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}`,
          )
          .json<PullRequest>();

        // Merge only changed fields
        const updated: Record<string, unknown> = {
          ...current,
          title: title ?? current.title,
          description: description ?? current.description,
          toRef: targetBranch
            ? { ...current.toRef, id: `refs/heads/${targetBranch}` }
            : current.toRef,
          reviewers: reviewers
            ? reviewers.map((name) => ({ user: { name } }))
            : current.reviewers,
        };

        const data = await clients.api
          .put(
            `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}`,
            { json: updated },
          )
          .json();

        return formatResponse(data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  // ── merge_pull_request ───────────────────────────────────────────────
  server.registerTool(
    "merge_pull_request",
    {
      description:
        "Merge an approved pull request. Fetches the current version automatically for optimistic locking.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        prId: z.number().describe("Pull request ID."),
        message: z.string().optional().describe("Custom merge commit message."),
        strategy: z
          .enum(["merge-commit", "squash", "fast-forward"])
          .optional()
          .describe("Merge strategy."),
      },
    },
    async ({ project, repository, prId, message, strategy }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);

        // Fetch current version for optimistic locking
        const pr = await clients.api
          .get(
            `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}`,
          )
          .json<PullRequest>();

        const body: Record<string, unknown> = { version: pr.version };
        if (message) body.message = message;
        if (strategy) body.strategy = strategy;

        const data = await clients.api
          .post(
            `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}/merge`,
            { json: body },
          )
          .json();

        return formatResponse(data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  // ── decline_pull_request ─────────────────────────────────────────────
  server.registerTool(
    "decline_pull_request",
    {
      description:
        "Decline a pull request. Fetches the current version automatically for optimistic locking.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        prId: z.number().describe("Pull request ID."),
        message: z.string().optional().describe("Reason for declining."),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project, repository, prId, message }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);

        // Fetch current version for optimistic locking
        const pr = await clients.api
          .get(
            `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}`,
          )
          .json<PullRequest>();

        const body: Record<string, unknown> = { version: pr.version };
        if (message) body.message = message;

        const data = await clients.api
          .post(
            `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}/decline`,
            { json: body },
          )
          .json();

        return formatResponse(data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  // ── list_pull_requests ───────────────────────────────────────────────
  server.registerTool(
    "list_pull_requests",
    {
      description:
        "List pull requests in a repository. Supports filtering by state, direction, order, and client-side author filtering.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        state: z
          .enum(["OPEN", "MERGED", "DECLINED", "ALL"])
          .optional()
          .describe("Filter by state (default: OPEN)."),
        author: z
          .string()
          .optional()
          .describe("Client-side filter by author username/displayName."),
        direction: z
          .enum(["INCOMING", "OUTGOING"])
          .optional()
          .describe("PR direction filter."),
        order: z.enum(["OLDEST", "NEWEST"]).optional().describe("Sort order."),
        limit: z
          .number()
          .optional()
          .describe("Number of PRs to return (default: 25)."),
        start: z
          .number()
          .optional()
          .describe("Start index for pagination (default: 0)."),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated fields to return. Defaults to: id, title, description, state, dates, author (name, displayName, status), branches (displayId), reviewers (name, displayName, status, approved), properties (commentCount, taskCount). Use '*all' for the full API response with all nested objects.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      project,
      repository,
      state,
      author,
      direction,
      order,
      limit = 25,
      start = 0,
      fields,
    }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);
        const searchParams: Record<string, string | number | boolean> = {
          limit,
          start,
          withAttributes: false,
          withProperties: false,
        };
        if (state) searchParams.state = state;
        if (direction) searchParams.direction = direction;
        if (order) searchParams.order = order;

        const data = await clients.api
          .get(
            `projects/${resolvedProject}/repos/${repository}/pull-requests`,
            { searchParams },
          )
          .json<{
            values: Array<{ author?: PrAuthor; [key: string]: unknown }>;
            size: number;
            isLastPage: boolean;
          }>();

        let pullRequests = data.values;

        if (author) {
          const authorLower = author.toLowerCase();
          pullRequests = pullRequests.filter((pr) => {
            const u = pr.author?.user;
            if (!u) return false;
            return (
              u.name?.toLowerCase() === authorLower ||
              u.slug?.toLowerCase() === authorLower ||
              u.displayName?.toLowerCase().includes(authorLower)
            );
          });
        }

        return formatResponse({
          total: author ? pullRequests.length : data.size,
          pullRequests: curateList(
            pullRequests as Record<string, unknown>[],
            fields ?? DEFAULT_PR_FIELDS,
          ),
          isLastPage: data.isLastPage,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  // ── get_dashboard_pull_requests ──────────────────────────────────────
  server.registerTool(
    "get_dashboard_pull_requests",
    {
      description:
        "Get pull requests from the authenticated user dashboard. No project/repo needed.",
      inputSchema: {
        state: z
          .enum(["OPEN", "MERGED", "DECLINED", "ALL"])
          .optional()
          .describe("Filter by state."),
        role: z
          .enum(["AUTHOR", "REVIEWER", "PARTICIPANT"])
          .optional()
          .describe("Filter by user role."),
        participantStatus: z
          .enum(["APPROVED", "UNAPPROVED", "NEEDS_WORK"])
          .optional()
          .describe("Filter by participant status."),
        order: z.enum(["OLDEST", "NEWEST"]).optional().describe("Sort order."),
        closedSince: z
          .number()
          .optional()
          .describe("Only return PRs closed after this timestamp (epoch ms)."),
        limit: z
          .number()
          .optional()
          .describe("Number of PRs to return (default: 25)."),
        start: z
          .number()
          .optional()
          .describe("Start index for pagination (default: 0)."),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated fields to return. Defaults to: id, title, description, state, dates, author (name, displayName, status), branches (displayId), reviewers (name, displayName, status, approved), properties (commentCount, taskCount). Use '*all' for the full API response with all nested objects.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      state,
      role,
      participantStatus,
      order,
      closedSince,
      limit = 25,
      start = 0,
      fields,
    }) => {
      try {
        const searchParams: Record<string, string | number> = { limit, start };
        if (state) searchParams.state = state;
        if (role) searchParams.role = role;
        if (participantStatus)
          searchParams.participantStatus = participantStatus;
        if (order) searchParams.order = order;
        if (closedSince) searchParams.closedSince = closedSince;

        const data = await clients.api
          .get("dashboard/pull-requests", {
            searchParams,
          })
          .json<{
            values: Record<string, unknown>[];
            size: number;
            isLastPage: boolean;
          }>();

        return formatResponse({
          ...data,
          values: curateList(data.values, fields ?? DEFAULT_PR_FIELDS),
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  // ── get_pr_activity ──────────────────────────────────────────────────
  server.registerTool(
    "get_pr_activity",
    {
      description:
        "Get activity feed for a pull request. Optionally filter to only reviews or comments.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        prId: z.number().describe("Pull request ID."),
        filter: z
          .enum(["all", "reviews", "comments"])
          .optional()
          .describe("Filter activity type (default: all)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project, repository, prId, filter = "all" }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);
        const data = await clients.api
          .get(
            `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}/activities`,
          )
          .json<{ values: Activity[] }>();

        let activities = data.values;

        if (filter === "reviews") {
          activities = activities.filter(
            (a) => a.action === "APPROVED" || a.action === "REVIEWED",
          );
        } else if (filter === "comments") {
          activities = activities.filter((a) => a.action === "COMMENTED");
        }

        return formatResponse(activities);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  // ── get_diff ─────────────────────────────────────────────────────────
  server.registerTool(
    "get_diff",
    {
      description:
        "Get the diff of a pull request. Large diffs are truncated per file unless maxLinesPerFile is set to 0.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        prId: z.number().describe("Pull request ID."),
        contextLines: z
          .number()
          .optional()
          .describe("Number of context lines around changes (default: 10)."),
        maxLinesPerFile: z
          .number()
          .optional()
          .describe(
            "Max lines per file. 0 = no limit. Defaults to BITBUCKET_DIFF_MAX_LINES_PER_FILE.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      project,
      repository,
      prId,
      contextLines = 10,
      maxLinesPerFile,
    }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);

        const rawDiff = await clients.api
          .get(
            `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}/diff`,
            {
              searchParams: { contextLines, withComments: false },
              headers: { Accept: "text/plain" },
            },
          )
          .text();

        const effectiveMaxLines =
          maxLinesPerFile !== undefined
            ? maxLinesPerFile
            : defaultMaxLinesPerFile;

        const diffContent = effectiveMaxLines
          ? truncateDiff(rawDiff, effectiveMaxLines)
          : rawDiff;

        return {
          content: [{ type: "text" as const, text: diffContent }],
        };
      } catch (error) {
        return handleToolError(error);
      }
    },
  );
}
