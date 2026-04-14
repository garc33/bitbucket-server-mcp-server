import { z } from "zod";
import { formatResponse } from "../response/format.js";
import { toolAnnotations } from "../response/annotations.js";
import { handleToolError } from "../http/errors.js";
import { resolveProject } from "./shared.js";
import type { ToolContext } from "./shared.js";

export function registerCommentTools(ctx: ToolContext) {
  const { server, clients, defaultProject } = ctx;
  server.registerTool(
    "manage_comment",
    {
      description:
        'Manage pull request comments. Actions: "create" (general, inline, threaded, or tasks), "edit" (update text/severity/state), "delete", "react" (add emoji reaction), "unreact" (remove reaction).',
      inputSchema: {
        action: z
          .enum(["create", "edit", "delete", "react", "unreact"])
          .describe("Operation to perform on the comment."),
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        prId: z.coerce.number().describe("Pull request ID."),
        text: z
          .string()
          .optional()
          .describe("Comment text (required for create and edit)."),
        commentId: z
          .number()
          .optional()
          .describe("Comment ID (required for edit and delete)."),
        version: z
          .number()
          .optional()
          .describe(
            "Comment version for optimistic locking (required for edit and delete).",
          ),
        parentId: z
          .number()
          .optional()
          .describe("Parent comment ID for threaded replies (create only)."),
        state: z
          .enum(["OPEN", "PENDING", "RESOLVED"])
          .optional()
          .describe(
            "Comment state. PENDING = draft (create only). RESOLVED = mark as resolved (edit only). OPEN = reopen a resolved comment (edit only).",
          ),
        severity: z
          .enum(["NORMAL", "BLOCKER"])
          .optional()
          .describe(
            "Comment severity. BLOCKER marks it as a task (create and edit).",
          ),
        filePath: z
          .string()
          .optional()
          .describe("File path for inline comments (create only)."),
        line: z
          .number()
          .optional()
          .describe("Line number for inline comments (create only)."),
        lineType: z
          .enum(["ADDED", "REMOVED"])
          .optional()
          .describe("Whether the line is added or removed (create only)."),
        emoticon: z
          .string()
          .optional()
          .describe(
            "Emoticon shortcut for react/unreact (e.g. thumbsup, heart, tada). Use search_emoticons to find available options.",
          ),
      },
      annotations: toolAnnotations({
        readOnlyHint: false,
        idempotentHint: false,
      }),
    },
    async ({
      action,
      project,
      repository,
      prId,
      text,
      commentId,
      version,
      parentId,
      state,
      severity,
      filePath,
      line,
      lineType,
      emoticon,
    }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);
        const basePath = `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}/comments`;

        if (action === "create") {
          const body: Record<string, unknown> = {
            text,
            parent: parentId ? { id: parentId } : undefined,
            ...(state && { state }),
            ...(severity && { severity }),
            ...(filePath && {
              anchor: {
                path: filePath,
                lineType,
                line,
                diffType: "EFFECTIVE",
                fileType: "TO",
              },
            }),
          };

          const data = await clients.api.post(basePath, { json: body }).json();
          return formatResponse(data);
        }

        if (action === "edit") {
          const body: Record<string, unknown> = {
            text,
            version,
            ...(severity && { severity }),
            ...(state && { state }),
          };

          const data = await clients.api
            .put(`${basePath}/${commentId}`, { json: body })
            .json();
          return formatResponse(data);
        }

        if (action === "react" || action === "unreact") {
          const reactionPath = `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}/comments/${commentId}/reactions/${emoticon}`;
          if (action === "react") {
            await clients.commentLikes.put(reactionPath);
          } else {
            await clients.commentLikes.delete(reactionPath);
          }
          return formatResponse({ [action]: true, commentId, emoticon });
        }

        // delete
        await clients.api.delete(`${basePath}/${commentId}`, {
          searchParams: { version: version! },
        });
        return formatResponse({ deleted: true, commentId });
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "submit_review",
    {
      description:
        'Approve, unapprove, or publish a review on a pull request. Use "approve" to approve, "unapprove" to remove your approval, and "publish" to submit a review with an optional overview comment and status.',
      inputSchema: {
        action: z
          .enum(["approve", "unapprove", "publish"])
          .describe("Review action to perform."),
        project: z
          .string()
          .optional()
          .describe("Project key. Defaults to BITBUCKET_DEFAULT_PROJECT."),
        repository: z.string().describe("Repository slug."),
        prId: z.coerce.number().describe("Pull request ID."),
        commentText: z
          .string()
          .optional()
          .describe("Overview comment text (for publish action)."),
        participantStatus: z
          .enum(["APPROVED", "NEEDS_WORK"])
          .optional()
          .describe("Participant status to set (for publish action)."),
      },
      annotations: toolAnnotations({
        readOnlyHint: false,
        idempotentHint: false,
      }),
    },
    async ({
      action,
      project,
      repository,
      prId,
      commentText,
      participantStatus,
    }) => {
      try {
        const resolvedProject = resolveProject(project, defaultProject);
        const prPath = `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}`;

        if (action === "approve") {
          const data = await clients.api.post(`${prPath}/approve`).json();
          return formatResponse(data);
        }

        if (action === "unapprove") {
          await clients.api.delete(`${prPath}/approve`);
          return formatResponse({ unapproved: true, prId });
        }

        // publish
        const body: Record<string, unknown> = {
          commentText: commentText ?? null,
          ...(participantStatus && { participantStatus }),
        };

        const data = await clients.api
          .put(`${prPath}/review`, { json: body })
          .json();
        return formatResponse(data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "search_emoticons",
    {
      description:
        "Search available emoticons for comment reactions. Returns matching shortcut names to use with manage_comment react/unreact.",
      inputSchema: {
        query: z.string().describe("Search term (e.g. thumb, fire, heart)."),
      },
      annotations: toolAnnotations(),
    },
    async ({ query }) => {
      try {
        const data = await clients.emoticons
          .get("search", { searchParams: { query } })
          .json<{
            values: Array<{ shortcut: string; url: string }>;
          }>();

        return formatResponse(data.values.map((e) => e.shortcut));
      } catch (error) {
        return handleToolError(error);
      }
    },
  );
}
