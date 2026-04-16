import { test, fc } from "@fast-check/vitest";
import { describe, expect, beforeEach, afterEach } from "vitest";
import { parseConfig } from "../../config.js";

describe("parseConfig (property-based)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BITBUCKET_URL;
    delete process.env.BITBUCKET_TOKEN;
    delete process.env.BITBUCKET_USERNAME;
    delete process.env.BITBUCKET_PASSWORD;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test.prop([fc.stringMatching(/^https?:\/\/[a-z][a-z0-9.:-]+\/+$/)])(
    "should strip all trailing slashes from any URL",
    (url) => {
      const config = parseConfig({ baseUrl: url, token: "tok" });
      expect(config.baseUrl).not.toMatch(/\/$/);
      expect(config.baseUrl.length).toBeGreaterThan(0);
    },
  );

  test.prop([fc.string({ minLength: 1 })])(
    "should accept any non-empty string as token",
    (token) => {
      const config = parseConfig({
        baseUrl: "https://git.example.com",
        token,
      });
      expect(config.token).toBe(token);
    },
  );

  test.prop([fc.string({ minLength: 1 }), fc.string({ minLength: 1 })])(
    "should accept any non-empty username/password pair",
    (username, password) => {
      const config = parseConfig({
        baseUrl: "https://git.example.com",
        username,
        password,
      });
      expect(config.username).toBe(username);
      expect(config.password).toBe(password);
    },
  );

  test.prop([
    fc.array(
      fc.tuple(
        fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]+$/),
        fc.string({ minLength: 1 }),
      ),
      { minLength: 1, maxLength: 5 },
    ),
  ])("should parse any valid custom headers", (pairs) => {
    const config = parseConfig({
      baseUrl: "https://git.example.com",
      token: "tok",
      customHeaders: Object.fromEntries(pairs),
    });
    for (const [key, value] of pairs) {
      expect(config.customHeaders?.[key]).toBe(value);
    }
  });

  test.prop([
    fc.array(fc.stringMatching(/^[a-z_]+$/), {
      minLength: 1,
      maxLength: 10,
    }),
  ])("should preserve all enabled tools", (tools) => {
    const config = parseConfig({
      baseUrl: "https://git.example.com",
      token: "tok",
      enabledTools: tools,
    });
    expect(config.enabledTools).toEqual(tools);
  });

  test.prop([
    fc.array(
      fc.tuple(
        fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]+$/),
        fc.stringMatching(/^[^,=\s]+$/),
      ),
      { minLength: 1, maxLength: 5 },
    ),
  ])("should parse custom headers from env var string", (pairs) => {
    process.env.BITBUCKET_URL = "https://git.example.com";
    process.env.BITBUCKET_TOKEN = "tok";
    process.env.BITBUCKET_CUSTOM_HEADERS = pairs
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    const config = parseConfig();
    for (const [key, value] of pairs) {
      expect(config.customHeaders?.[key]).toBe(value);
    }
  });

  test.prop([fc.integer({ min: 0, max: 3_600_000 })])(
    "should accept any non-negative cacheTtlMs",
    (cacheTtlMs) => {
      const config = parseConfig({
        baseUrl: "https://git.example.com",
        token: "tok",
        cacheTtlMs,
      });
      expect(config.cacheTtlMs).toBe(cacheTtlMs);
    },
  );
});
