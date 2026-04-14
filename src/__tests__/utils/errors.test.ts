import { describe, test, expect } from "vitest";
import { formatApiError, isHttpError } from "../../http/errors.js";

describe("formatApiError", () => {
  test("should format 401 with auth guidance", () => {
    const result = formatApiError(401, "Unauthorized");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Authentication failed");
    expect(result.content[0].text).toContain("BITBUCKET_TOKEN");
  });

  test("should format 403 with permission guidance", () => {
    const result = formatApiError(403, "Forbidden");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Permission denied");
  });

  test("should format 404 with verification guidance", () => {
    const result = formatApiError(404, "Not found");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Not found");
    expect(result.content[0].text).toContain("project");
  });

  test("should format 409 with version conflict guidance", () => {
    const result = formatApiError(409, "Conflict");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("conflict");
  });

  test("should format 429 with rate limit guidance", () => {
    const result = formatApiError(429, "Too Many Requests");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Rate limited");
  });

  test("should format 5xx with server error guidance", () => {
    const result = formatApiError(500, "Internal Server Error");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("server error");
  });

  test("should format unknown status with generic message", () => {
    const result = formatApiError(418, "I'm a teapot");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("418");
  });

  test("should include original message in response", () => {
    const result = formatApiError(404, "Repository XYZ does not exist");
    expect(result.content[0].text).toContain("Repository XYZ does not exist");
  });
});

describe("isHttpError", () => {
  test("should return true for objects with response.status", () => {
    const error = { response: { status: 404 } };
    expect(isHttpError(error)).toBe(true);
  });

  test("should return false for plain errors", () => {
    expect(isHttpError(new Error("oops"))).toBe(false);
  });

  test("should return false for null/undefined", () => {
    expect(isHttpError(null)).toBe(false);
    expect(isHttpError(undefined)).toBe(false);
  });
});
