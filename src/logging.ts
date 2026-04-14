import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type LogLevel = "debug" | "info" | "warning" | "error";

let serverRef: McpServer | undefined;

export function initLogging(server: McpServer) {
  serverRef = server;
}

export function log(level: LogLevel, message: string, data?: unknown) {
  if (!serverRef) return;

  try {
    serverRef.sendLoggingMessage({
      level,
      logger: "bitbucket-mcp",
      data: data ? `${message} ${JSON.stringify(data)}` : message,
    });
  } catch {
    // Server not connected yet or client disconnected; ignore silently
  }
}

export const logger = {
  debug: (message: string, data?: unknown) => log("debug", message, data),
  info: (message: string, data?: unknown) => log("info", message, data),
  warn: (message: string, data?: unknown) => log("warning", message, data),
  error: (message: string, data?: unknown) => log("error", message, data),
};
