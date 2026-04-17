import { describe, test, expect } from "vitest";
import {
  formatResponse,
  formatCompactResponse,
} from "../../response/format.js";

describe("formatResponse", () => {
  test("should wrap data in MCP content format", () => {
    const result = formatResponse({ id: 1, name: "test" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ id: 1, name: "test" });
  });

  test("should pretty-print JSON with 2-space indent", () => {
    const result = formatResponse({ a: 1 });
    expect(result.content[0].text).toBe('{\n  "a": 1\n}');
  });

  test.each<[string, unknown]>([
    ["object", { id: 1 }],
    ["array", [1, 2, 3]],
    ["string", "hello"],
    ["number", 42],
    ["boolean", true],
    ["null", null],
  ])("handles %s value", (_type, input) => {
    const result = formatResponse(input);
    expect(JSON.parse(result.content[0].text)).toEqual(input);
  });

  test("sets isError to undefined by default", () => {
    const result = formatResponse({});
    expect(result.isError).toBeUndefined();
  });
});

describe("formatCompactResponse", () => {
  test("should include both user and assistant content", () => {
    const result = formatCompactResponse("PR #1 merged", {
      id: 1,
      state: "MERGED",
      extra: "data",
    });
    expect(result.content).toHaveLength(2);
    expect(result.content[0].text).toBe("PR #1 merged");
    expect(result.content[0].annotations?.audience).toEqual(["user"]);
    expect(JSON.parse(result.content[1].text)).toEqual({
      id: 1,
      state: "MERGED",
      extra: "data",
    });
    expect(result.content[1].annotations?.audience).toEqual(["assistant"]);
  });

  test("should work with summary only", () => {
    const result = formatCompactResponse("Done");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe("Done");
    expect(result.content[0].annotations?.audience).toEqual(["user"]);
  });
});
