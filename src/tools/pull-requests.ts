import { z } from "zod";
import { formatResponse } from "../response/format.js";
import { toolAnnotations } from "../response/annotations.js";
import { handleToolError } from "../http/errors.js";
import { truncateDiff } from "../diff.js";
import {
  curateResponse,
  curateList,
  DEFAULT_PR_FIELDS,
} from "../response/curate.js";
import { resolveProject } from "./shared.js";
import type { ToolContext } from "./shared.js";

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
  user?: { name: string; [key: string]: unknown };
  comment?: {
    author?: { name: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface Reviewer {
  name: string;
  [key: string]: unknown;
}

export function registerPullRequestTools(ctx: ToolContext) {
  const {
    server,
    clients,
    defaultProject,
    maxLinesPerFile: defaultMaxLinesPerFile,
  } = ctx;
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
      annotations: toolAnnotations({
        readOnlyHint: false,
        idempotentHint: false,
      }),
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
        prId: z.coerce.number().describe("Pull request ID."),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated fields to return. Defaults to: id, title, description, state, dates, author (name, displayName, status), branches (displayId), reviewers (name, displayName, status, approved), properties (commentCount, taskCount). Use '*all' for the full API response with all nested objects.",
          ),
      },
      annotations: toolAnnotations(),
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
        prId: z.coerce.number().describe("Pull request ID."),
        title: z.string().optional().describe("New title."),
        description: z.string().optional().describe("New description."),
        targetBranch: z.string().optional().describe("New target branch."),
        reviewers: z
          .array(z.string())
          .optional()
          .describe("Replace reviewer list with these usernames."),
      },
      annotations: toolAnnotations({ readOnlyHint: false }),
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
            ? {
                id: `refs/heads/${targetBranch}`,
                displayId: current.toRef.displayId,
                repository: current.toRef.repository,
              }
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
        prId: z.coerce.number().describe("Pull request ID."),
        message: z.string().optional().describe("Custom merge commit message."),
        strategy: z
          .enum([
            "no-ff",
            "ff",
            "ff-only",
            "squash",
            "squash-ff-only",
            "rebase-no-ff",
            "rebase-ff-only",
          ])
          .optional()
          .describe(
            "Merge strategy ID. no-ff = merge commit, ff = fast-forward, ff-only = fast-forward only, squash = squash, rebase-no-ff = rebase + merge commit, rebase-ff-only = rebase + fast-forward.",
          ),
      },
      annotations: toolAnnotations({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      }),
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

        const searchParams: Record<string, string> = {};
        if (strategy) searchParams.strategyId = strategy;

        const data = await clients.api
          .post(
            `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}/merge`,
            { json: body, searchParams },
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
        prId: z.coerce.number().describe("Pull request ID."),
        message: z.string().optional().describe("Reason for declining."),
      },
      annotations: toolAnnotations({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      }),
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
      annotations: toolAnnotations(),
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
      annotations: toolAnnotations(),
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
        prId: z.coerce.number().describe("Pull request ID."),
        filter: z
          .enum(["all", "reviews", "comments"])
          .optional()
          .describe("Filter activity type (default: all)."),
        excludeUsers: z
          .array(z.string())
          .optional()
          .describe(
            "Usernames to exclude from results (e.g. bot accounts like sa_sec_appsec_auto).",
          ),
        limit: z
          .number()
          .optional()
          .describe("Number of activities to return (default: 25)."),
        start: z
          .number()
          .optional()
          .describe("Start index for pagination (default: 0)."),
      },
      annotations: toolAnnotations(),
    },
    async ({
      project,
      repository,
      prId,
      filter = "all",
      excludeUsers,
      limit = 25,
      start = 0,
    }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);
        const data = await clients.api
          .get(
            `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}/activities`,
            { searchParams: { limit, start } },
          )
          .json<{ values: Activity[]; isLastPage: boolean; size: number }>();

        let activities = data.values;

        if (excludeUsers?.length) {
          const excluded = new Set(excludeUsers.map((u) => u.toLowerCase()));
          activities = activities.filter((a) => {
            const user = a.user?.name ?? a.comment?.author?.name ?? "";
            return !excluded.has(user.toLowerCase());
          });
        }

        if (filter === "reviews") {
          activities = activities.filter(
            (a) => a.action === "APPROVED" || a.action === "REVIEWED",
          );
        } else if (filter === "comments") {
          activities = activities.filter((a) => a.action === "COMMENTED");
        }

        return formatResponse({
          activities,
          size: data.size,
          isLastPage: data.isLastPage,
        });
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
        "Get the diff of a pull request. Use stat=true for a lightweight summary of changed files (and line counts if the server supports it) instead of the full diff.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        prId: z.coerce.number().describe("Pull request ID."),
        stat: z
          .boolean()
          .optional()
          .describe(
            "If true, return only the list of changed files and types (ADD, MODIFY, DELETE, RENAME, COPY) instead of the full diff. Line count summary included when available (Bitbucket DC 9.1+).",
          ),
        filePath: z
          .string()
          .optional()
          .describe(
            "Path to a specific file to get the diff for. Use with stat=true first to discover file paths, then request individual diffs.",
          ),
        contextLines: z
          .number()
          .optional()
          .describe(
            "Number of context lines around changes (default: 10). Ignored when stat=true.",
          ),
        maxLinesPerFile: z
          .number()
          .optional()
          .describe(
            "Max lines per file. 0 = no limit. Defaults to BITBUCKET_DIFF_MAX_LINES_PER_FILE. Ignored when stat=true.",
          ),
      },
      annotations: toolAnnotations(),
    },
    async ({
      project,
      repository,
      prId,
      stat,
      filePath,
      contextLines = 10,
      maxLinesPerFile,
    }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);
        const basePath = `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}`;

        if (stat) {
          const changesData = await clients.api
            .get(`${basePath}/changes`, {
              searchParams: { limit: 1000 },
            })
            .json<{
              values: Array<{
                path: { toString: string };
                type: string;
                nodeType: string;
              }>;
            }>();

          const files = changesData.values.map((c) => ({
            path: c.path.toString,
            type: c.type,
          }));

          let summary: Record<string, number> | undefined;
          try {
            summary = await clients.api
              .get(`${basePath}/diff-stats-summary`)
              .json<Record<string, number>>();
          } catch {
            // diff-stats-summary only available on Bitbucket DC 9.1+
          }

          return formatResponse({
            files,
            totalFiles: files.length,
            ...(summary && { summary }),
          });
        }

        const diffUrl = filePath
          ? `${basePath}/diff/${filePath}`
          : `${basePath}/diff`;
        const rawDiff = await clients.api
          .get(diffUrl, {
            searchParams: { contextLines, withComments: false },
            headers: { Accept: "text/plain" },
          })
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
