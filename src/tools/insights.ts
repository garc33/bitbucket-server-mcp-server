import { z } from "zod";
import { formatResponse } from "../response/format.js";
import { toolAnnotations } from "../response/annotations.js";
import { handleToolError } from "../http/errors.js";
import type { ToolContext } from "./shared.js";
import type { InsightReport } from "../generated/types.js";

export function registerInsightTools(ctx: ToolContext) {
  const { server, clients } = ctx;
  server.registerTool(
    "get_code_insights",
    {
      description:
        "Get code insight reports and their annotations for a pull request. Shows build results, code quality, and other analysis.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        pullRequestId: z.coerce.number().describe("Pull request ID."),
      },
      annotations: toolAnnotations(),
    },
    async ({ project, repository, pullRequestId }) => {
      try {
        const resolvedProject = ctx.resolveProject(project);
        const basePath = `projects/${resolvedProject}/repos/${repository}/pull-requests/${pullRequestId}`;

        const reportsData = await clients.insights
          .get(`${basePath}/reports`, {
            searchParams: {},
          })
          .json<{ values: InsightReport[] }>();

        const reports = reportsData.values;

        const annotations: Record<string, unknown[]> = {};

        for (const report of reports) {
          if (!report.key) continue;
          try {
            const annotationsData = await clients.insights
              .get(`${basePath}/reports/${report.key}/annotations`, {
                searchParams: {},
              })
              .json<{ values: unknown[] }>();
            annotations[report.key] = annotationsData.values;
          } catch {
            annotations[report.key] = [];
          }
        }

        return formatResponse({ reports, annotations });
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "get_build_status",
    {
      description:
        "Get CI build status for a commit or pull request. When prId is provided, automatically resolves the latest commit. Returns build state (SUCCESSFUL, FAILED, INPROGRESS), name, and URL to the CI build.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe(
            "Project key. Defaults to BITBUCKET_DEFAULT_PROJECT. Only needed with prId.",
          ),
        repository: z
          .string()
          .optional()
          .describe("Repository slug. Only needed with prId."),
        prId: z.coerce
          .number()
          .optional()
          .describe(
            "Pull request ID. If provided, resolves the latest commit automatically.",
          ),
        commitId: z
          .string()
          .optional()
          .describe("Full commit hash. Use this or prId, not both."),
      },
      annotations: toolAnnotations(),
    },
    async ({ project, repository, prId, commitId }) => {
      try {
        let resolvedCommit = commitId;

        if (prId) {
          if (!repository) {
            throw new Error("repository is required when using prId.");
          }
          const resolvedProject = ctx.resolveProject(project);
          const pr = await clients.api
            .get(
              `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}`,
            )
            .json<{ fromRef: { latestCommit: string } }>();
          resolvedCommit = pr.fromRef.latestCommit;
        }

        if (!resolvedCommit) {
          throw new Error("Either commitId or prId is required.");
        }

        const data = await clients.buildStatus
          .get(`commits/${resolvedCommit}`)
          .json<{ values: unknown[] }>();

        return formatResponse(data.values);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );
}
