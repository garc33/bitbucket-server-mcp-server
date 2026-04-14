import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClients } from "../http/client.js";
import type { ApiCache } from "../http/cache.js";

export interface ToolContext {
  server: McpServer;
  clients: ApiClients;
  cache: ApiCache;
  defaultProject?: string;
  maxLinesPerFile?: number;
}

export function resolveProject(
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
