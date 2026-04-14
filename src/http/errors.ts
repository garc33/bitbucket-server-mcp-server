import { logger } from "../logging.js";

interface ToolErrorResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError: true;
}

const ERROR_GUIDANCE: Record<number, string> = {
  401: "Authentication failed. Verify BITBUCKET_TOKEN or BITBUCKET_USERNAME/BITBUCKET_PASSWORD environment variables.",
  403: "Permission denied. Your credentials may not have access to this resource.",
  404: "Not found. Verify the project key, repository slug, and PR/comment ID are correct.",
  409: "Version conflict. The resource was modified since you last fetched it. Re-fetch and retry with the updated version.",
  429: "Rate limited. Wait a moment before retrying; the server will retry automatically for GET requests.",
};

export function formatApiError(
  status: number,
  message: string,
): ToolErrorResult {
  let guidance: string;

  if (ERROR_GUIDANCE[status]) {
    guidance = ERROR_GUIDANCE[status];
  } else if (status >= 500) {
    guidance =
      "Bitbucket server error. The server may be temporarily unavailable; try again.";
  } else {
    guidance = `Unexpected HTTP ${status} error.`;
  }

  return {
    content: [
      { type: "text", text: `${guidance}\n\nServer response: ${message}` },
    ],
    isError: true,
  };
}

export function isHttpError(
  error: unknown,
): error is { response: { status: number; data?: { message?: string } } } {
  if (!error || typeof error !== "object") return false;
  const obj = error as Record<string, unknown>;
  if (!obj.response || typeof obj.response !== "object") return false;
  const res = obj.response as Record<string, unknown>;
  return typeof res.status === "number";
}

export function handleToolError(error: unknown): ToolErrorResult {
  if (isHttpError(error)) {
    const msg = (error.response.data?.message as string) ?? String(error);
    logger.error(`API error ${error.response.status}`, msg);
    return formatApiError(error.response.status, msg);
  }

  const message = error instanceof Error ? error.message : String(error);
  logger.error("Tool error", message);

  return {
    content: [{ type: "text", text: `Unexpected error: ${message}` }],
    isError: true,
  };
}
