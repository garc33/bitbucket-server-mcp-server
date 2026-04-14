import { z } from "zod";
import { formatResponse } from "../response/format.js";
import { toolAnnotations } from "../response/annotations.js";
import { handleToolError } from "../http/errors.js";
import type { ToolContext } from "./shared.js";
import type { ApiClients } from "../http/client.js";

interface CommentActionContext {
  clients: ApiClients;
  basePath: string;
  resolvedProject: string;
  repository: string;
  prId: number;
  text?: string;
  commentId?: number;
  version?: number;
  parentId?: number;
  state?: "OPEN" | "PENDING" | "RESOLVED";
  severity?: "NORMAL" | "BLOCKER";
  filePath?: string;
  line?: number;
  lineType?: "ADDED" | "REMOVED";
  emoticon?: string;
}

interface CommentAnchor {
  path: string;
  lineType?: "ADDED" | "REMOVED";
  line?: number;
  diffType: "EFFECTIVE";
  fileType: "TO";
}

interface CreateCommentBody {
  text?: string;
  parent?: { id: number };
  state?: string;
  severity?: string;
  anchor?: CommentAnchor;
}

interface EditCommentBody {
  text?: string;
  version?: number;
  severity?: string;
  state?: string;
}

const commentActions: Record<
  string,
  (ctx: CommentActionContext) => Promise<ReturnType<typeof formatResponse>>
> = {
  create: async ({
    clients,
    basePath,
    text,
    parentId,
    state,
    severity,
    filePath,
    line,
    lineType,
  }) => {
    const body: CreateCommentBody = {
      text,
      parent: parentId ? { id: parentId } : undefined,
      ...(state && { state }),
      ...(severity && { severity }),
      ...(filePath && {
        anchor: {
          path: filePath,
          lineType,
          line,
          diffType: "EFFECTIVE" as const,
          fileType: "TO" as const,
        },
      }),
    };
    const data = await clients.api.post(basePath, { json: body }).json();
    return formatResponse(data);
  },

  edit: async ({
    clients,
    basePath,
    commentId,
    text,
    version,
    severity,
    state,
  }) => {
    const body: EditCommentBody = {
      text,
      version,
      ...(severity && { severity }),
      ...(state && { state }),
    };
    const data = await clients.api
      .put(`${basePath}/${commentId}`, { json: body })
      .json();
    return formatResponse(data);
  },

  delete: async ({ clients, basePath, commentId, version }) => {
    await clients.api.delete(`${basePath}/${commentId}`, {
      searchParams: { version: version! },
    });
    return formatResponse({ deleted: true, commentId });
  },

  react: async ({
    clients,
    resolvedProject,
    repository,
    prId,
    commentId,
    emoticon,
  }) => {
    const reactionPath = `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}/comments/${commentId}/reactions/${emoticon}`;
    await clients.commentLikes.put(reactionPath);
    return formatResponse({ react: true, commentId, emoticon });
  },

  unreact: async ({
    clients,
    resolvedProject,
    repository,
    prId,
    commentId,
    emoticon,
  }) => {
    const reactionPath = `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}/comments/${commentId}/reactions/${emoticon}`;
    await clients.commentLikes.delete(reactionPath);
    return formatResponse({ unreact: true, commentId, emoticon });
  },
};

export function registerCommentTools(ctx: ToolContext) {
  const { server, clients } = ctx;

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
          .describe("Comment ID (required for edit, delete, react, unreact)."),
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
            "Comment state. PENDING = draft (create only). RESOLVED = mark as resolved (edit only). OPEN = reopen (edit only).",
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
    async (params) => {
      try {
        const resolvedProject = ctx.resolveProject(params.project);
        const basePath = `projects/${resolvedProject}/repos/${params.repository}/pull-requests/${params.prId}/comments`;
        const handler = commentActions[params.action];
        return await handler({
          clients,
          basePath,
          resolvedProject,
          repository: params.repository,
          prId: params.prId,
          text: params.text,
          commentId: params.commentId,
          version: params.version,
          parentId: params.parentId,
          state: params.state,
          severity: params.severity,
          filePath: params.filePath,
          line: params.line,
          lineType: params.lineType,
          emoticon: params.emoticon,
        });
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
          .json<{ values: Array<{ shortcut: string }> }>();
        return formatResponse(data.values.map((e) => e.shortcut));
      } catch (error) {
        return handleToolError(error);
      }
    },
  );
}
