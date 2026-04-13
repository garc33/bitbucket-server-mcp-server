import { describe, test, expect, beforeEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { initLogging, logger } from "../../utils/logging.js";

describe("logging", () => {
  let server: McpServer;
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    sendSpy = vi.fn();
    server.sendLoggingMessage = sendSpy as typeof server.sendLoggingMessage;
    initLogging(server);
  });

  test("logger.info should send info level message", () => {
    logger.info("something happened");

    expect(sendSpy).toHaveBeenCalledWith({
      level: "info",
      logger: "bitbucket-mcp",
      data: "something happened",
    });
  });

  test("logger.error should send error level message", () => {
    logger.error("bad thing");

    expect(sendSpy).toHaveBeenCalledWith({
      level: "error",
      logger: "bitbucket-mcp",
      data: "bad thing",
    });
  });

  test("logger.debug should send debug level message", () => {
    logger.debug("GET /api/foo");

    expect(sendSpy).toHaveBeenCalledWith({
      level: "debug",
      logger: "bitbucket-mcp",
      data: "GET /api/foo",
    });
  });

  test("logger.warn should send warning level message", () => {
    logger.warn("HTTP 429");

    expect(sendSpy).toHaveBeenCalledWith({
      level: "warning",
      logger: "bitbucket-mcp",
      data: "HTTP 429",
    });
  });

  test("should include data when provided", () => {
    logger.info("request", { url: "/foo", status: 200 });

    expect(sendSpy).toHaveBeenCalledWith({
      level: "info",
      logger: "bitbucket-mcp",
      data: 'request {"url":"/foo","status":200}',
    });
  });

  test("should not throw when server is not initialized", () => {
    // @ts-expect-error testing undefined to verify runtime safety
    initLogging(undefined);
    expect(() => logger.info("no server")).not.toThrow();
  });

  test("should not throw when sendLoggingMessage fails", () => {
    sendSpy.mockImplementation(() => {
      throw new Error("disconnected");
    });
    expect(() => logger.error("oops")).not.toThrow();
  });
});
