import { describe, it, expect } from "vitest";
import { parseCustomHeaders } from "../headers.js";

describe("parseCustomHeaders", () => {
  it("returns empty object for undefined input", () => {
    expect(parseCustomHeaders(undefined)).toEqual({});
  });

  it("returns empty object for empty string", () => {
    expect(parseCustomHeaders("")).toEqual({});
  });

  it("returns empty object for blank string", () => {
    expect(parseCustomHeaders("   ")).toEqual({});
  });

  it("parses a single header", () => {
    expect(parseCustomHeaders("X-Custom=value1")).toEqual({
      "X-Custom": "value1",
    });
  });

  it("parses multiple headers", () => {
    expect(parseCustomHeaders("X-Custom=value1,X-Other=value2")).toEqual({
      "X-Custom": "value1",
      "X-Other": "value2",
    });
  });

  it("preserves = characters in values (e.g. Base64/JWT tokens)", () => {
    const token = "eyJhbGciOiJFUzI1NiJ9.payload.sig==";
    expect(parseCustomHeaders(`X-Zero-Trust-Token=${token}`)).toEqual({
      "X-Zero-Trust-Token": token,
    });
  });

  it("trims whitespace from keys and values", () => {
    expect(parseCustomHeaders(" X-Key = val ")).toEqual({ "X-Key": "val" });
  });

  it("skips malformed entries without a value", () => {
    expect(parseCustomHeaders("X-Valid=ok,INVALID")).toEqual({
      "X-Valid": "ok",
    });
  });
});
