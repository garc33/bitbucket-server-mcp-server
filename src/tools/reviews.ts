import { z } from "zod";
import { formatResponse } from "../response/format.js";
import { toolAnnotations } from "../response/annotations.js";
import { handleToolError } from "../http/errors.js";
import type { ToolContext } from "./shared.js";
import type { ApiClients } from "../http/client.js";

interface ReviewActionContext {
  clients: ApiClients;
  prPath: string;
  prId: number;
  commentText?: string;
  participantStatus?: "APPROVED" | "NEEDS_WORK";
}

interface PublishReviewBody {
  commentText: string | null;
  participantStatus?: string;
}

const reviewActions: Record<
  string,
  (ctx: ReviewActionContext) => Promise<ReturnType<typeof formatResponse>>
> = {
  approve: async ({ clients, prPath }) => {
    const data = await clients.api.post(`${prPath}/approve`).json();
    return formatResponse(data);
  },

  unapprove: async ({ clients, prPath, prId }) => {
    await clients.api.delete(`${prPath}/approve`);
    return formatResponse({ unapproved: true, prId });
  },

  publish: async ({ clients, prPath, commentText, participantStatus }) => {
    const body: PublishReviewBody = {
      commentText: commentText ?? null,
      ...(participantStatus && { participantStatus }),
    };
    const data = await clients.api
      .put(`${prPath}/review`, { json: body })
      .json();
    return formatResponse(data);
  },
};

export function registerReviewTools(ctx: ToolContext) {
  const { server, clients } = ctx;

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
        const resolvedProject = ctx.resolveProject(project);
        const prPath = `projects/${resolvedProject}/repos/${repository}/pull-requests/${prId}`;
        const handler = reviewActions[action];
        return await handler({
          clients,
          prPath,
          prId,
          commentText,
          participantStatus,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
  );
}
