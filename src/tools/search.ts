import { z } from "zod";
import { formatResponse } from "../response/format.js";
import { toolAnnotations } from "../response/annotations.js";
import { handleToolError } from "../http/errors.js";
import { curateList, DEFAULT_SEARCH_FIELDS } from "../response/curate.js";
import type { ToolContext } from "./shared.js";

export function registerSearchTools(ctx: ToolContext) {
  const { server, clients } = ctx;
  server.registerTool(
    "search",
    {
      description:
        "Search for code or files across Bitbucket repositories. Supports filtering by project, repository, and search type.",
      inputSchema: {
        query: z.string().describe("Search query string."),
        project: z
          .string()
          .optional()
          .describe(
            "Project key to scope the search. Defaults to BITBUCKET_DEFAULT_PROJECT.",
          ),
        repository: z
          .string()
          .optional()
          .describe(
            "Repository slug to scope the search. Requires project to be set.",
          ),
        type: z
          .enum(["code", "file"])
          .optional()
          .describe(
            'Search type: "code" for content search, "file" for filename search.',
          ),
        limit: z
          .number()
          .optional()
          .describe("Number of results to return (default: 25)."),
        start: z
          .number()
          .optional()
          .describe("Start index for pagination (default: 0)."),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated fields to return. Defaults to: file, hitCount, hitContexts, pathMatches, repository (slug, name, project.key). Use '*all' for the full API response.",
          ),
      },
      annotations: toolAnnotations({ openWorldHint: true }),
    },
    async ({ query, project, repository, type, limit = 25, start = 0, fields }) => {
      try {
        let effectiveQuery = query;

        if (repository) {
          const resolvedProject = ctx.resolveProject(project);
          effectiveQuery = `repo:${resolvedProject}/${repository} ${effectiveQuery}`;
        } else if (project) {
          effectiveQuery = `project:${project} ${effectiveQuery}`;
        }

        if (type === "file") {
          effectiveQuery = `"${effectiveQuery}"`;
        }

        const data = await clients.search
          .post("search", {
            json: {
              query: effectiveQuery,
              entities: {
                code: { start, limit },
              },
            },
          })
          .json<{
            code: {
              values: Record<string, unknown>[];
              isLastPage: boolean;
              count?: number;
              nextStart?: number;
            };
          }>();

        return formatResponse({
          values: curateList(data.code.values, fields ?? DEFAULT_SEARCH_FIELDS),
          isLastPage: data.code.isLastPage,
          count: data.code.count,
          nextStart: data.code.nextStart,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
  );
}
