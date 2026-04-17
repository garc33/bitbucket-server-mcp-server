import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { parseConfig } from "../../config.js";

describe("parseConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BITBUCKET_URL;
    delete process.env.BITBUCKET_TOKEN;
    delete process.env.BITBUCKET_USERNAME;
    delete process.env.BITBUCKET_PASSWORD;
    delete process.env.BITBUCKET_DEFAULT_PROJECT;
    delete process.env.BITBUCKET_READ_ONLY;
    delete process.env.BITBUCKET_DIFF_MAX_LINES_PER_FILE;
    delete process.env.BITBUCKET_CUSTOM_HEADERS;
    delete process.env.BITBUCKET_ENABLED_TOOLS;
    delete process.env.BITBUCKET_CACHE_TTL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("baseUrl (equivalence: env / options, boundary: trailing slashes)", () => {
    test.each([
      ["https://git.example.com", "https://git.example.com"],
      ["https://git.example.com/", "https://git.example.com"],
      ["https://git.example.com///", "https://git.example.com"],
      ["https://git.example.com/////////", "https://git.example.com"],
      ["http://localhost:7990", "http://localhost:7990"],
    ])("strips trailing slashes from '%s'", (input, expected) => {
      process.env.BITBUCKET_URL = input;
      process.env.BITBUCKET_TOKEN = "t";
      expect(parseConfig().baseUrl).toBe(expected);
    });

    test("options.baseUrl overrides BITBUCKET_URL", () => {
      process.env.BITBUCKET_URL = "https://from-env.com";
      process.env.BITBUCKET_TOKEN = "t";
      expect(parseConfig({ baseUrl: "https://from-opt.com" }).baseUrl).toBe(
        "https://from-opt.com",
      );
    });

    test("throws when missing from both env and options", () => {
      expect(() => parseConfig()).toThrow(/BITBUCKET_URL/);
    });

    test("throws when env is empty string", () => {
      process.env.BITBUCKET_URL = "";
      expect(() => parseConfig()).toThrow(/BITBUCKET_URL/);
    });
  });

  describe("authentication (decision table)", () => {
    beforeEach(() => {
      process.env.BITBUCKET_URL = "https://git.example.com";
    });

    test.each<{ name: string; env: Record<string, string | undefined> }>([
      { name: "token only", env: { BITBUCKET_TOKEN: "t" } },
      {
        name: "user + pass",
        env: { BITBUCKET_USERNAME: "u", BITBUCKET_PASSWORD: "p" },
      },
      {
        name: "all three",
        env: {
          BITBUCKET_TOKEN: "t",
          BITBUCKET_USERNAME: "u",
          BITBUCKET_PASSWORD: "p",
        },
      },
    ])("accepts credentials: $name", ({ env }) => {
      Object.assign(process.env, env);
      expect(() => parseConfig()).not.toThrow();
    });

    test.each<{ name: string; env: Record<string, string | undefined> }>([
      { name: "user only (no pass)", env: { BITBUCKET_USERNAME: "u" } },
      { name: "pass only (no user)", env: { BITBUCKET_PASSWORD: "p" } },
      { name: "none", env: {} },
    ])("rejects incomplete credentials: $name", ({ env }) => {
      Object.assign(process.env, env);
      expect(() => parseConfig()).toThrow(/Authentication/);
    });

    test("options override env for token", () => {
      process.env.BITBUCKET_TOKEN = "env-token";
      expect(parseConfig({ token: "opt-token" }).token).toBe("opt-token");
    });
  });

  describe("readOnly (BITBUCKET_READ_ONLY is strict 'true')", () => {
    beforeEach(() => {
      process.env.BITBUCKET_URL = "https://git.example.com";
      process.env.BITBUCKET_TOKEN = "t";
    });

    test.each([
      ["true", true],
      ["false", false],
      ["True", false],
      ["TRUE", false],
      ["1", false],
      ["yes", false],
      ["", false],
      ["  true  ", false],
    ])("'%s' parses to %s", (envValue, expected) => {
      process.env.BITBUCKET_READ_ONLY = envValue;
      expect(parseConfig().readOnly).toBe(expected);
    });

    test("defaults to false when env not set", () => {
      expect(parseConfig().readOnly).toBe(false);
    });

    test("options.readOnly overrides env", () => {
      process.env.BITBUCKET_READ_ONLY = "true";
      expect(parseConfig({ readOnly: false }).readOnly).toBe(false);
    });
  });

  describe("cacheTtlMs", () => {
    beforeEach(() => {
      process.env.BITBUCKET_URL = "https://git.example.com";
      process.env.BITBUCKET_TOKEN = "t";
    });

    test("defaults to 5 minutes (300_000 ms) when neither env nor option", () => {
      expect(parseConfig().cacheTtlMs).toBe(300_000);
    });

    test.each([
      ["0", 0],
      ["1", 1_000],
      ["60", 60_000],
      ["3600", 3_600_000],
    ])("env '%s' seconds -> %d ms", (envValue, expected) => {
      process.env.BITBUCKET_CACHE_TTL = envValue;
      expect(parseConfig().cacheTtlMs).toBe(expected);
    });

    test("options.cacheTtlMs overrides env", () => {
      process.env.BITBUCKET_CACHE_TTL = "60";
      expect(parseConfig({ cacheTtlMs: 10_000 }).cacheTtlMs).toBe(10_000);
    });

    test("options.cacheTtlMs=0 is respected (disables cache)", () => {
      expect(parseConfig({ cacheTtlMs: 0 }).cacheTtlMs).toBe(0);
    });
  });

  describe("maxLinesPerFile", () => {
    beforeEach(() => {
      process.env.BITBUCKET_URL = "https://git.example.com";
      process.env.BITBUCKET_TOKEN = "t";
    });

    test("undefined when neither env nor option", () => {
      expect(parseConfig().maxLinesPerFile).toBeUndefined();
    });

    test.each([
      ["0", 0],
      ["1", 1],
      ["500", 500],
      ["10000", 10000],
    ])("env '%s' -> %d", (envValue, expected) => {
      process.env.BITBUCKET_DIFF_MAX_LINES_PER_FILE = envValue;
      expect(parseConfig().maxLinesPerFile).toBe(expected);
    });

    test("options.maxLinesPerFile overrides env", () => {
      process.env.BITBUCKET_DIFF_MAX_LINES_PER_FILE = "100";
      expect(parseConfig({ maxLinesPerFile: 50 }).maxLinesPerFile).toBe(50);
    });
  });

  describe("customHeaders (equivalence: env string format)", () => {
    beforeEach(() => {
      process.env.BITBUCKET_URL = "https://git.example.com";
      process.env.BITBUCKET_TOKEN = "t";
    });

    test("empty object when env not set and no option", () => {
      expect(parseConfig().customHeaders).toEqual({});
    });

    test.each<[string, Record<string, string>]>([
      ["X-Foo=bar", { "X-Foo": "bar" }],
      ["X-A=1,X-B=2", { "X-A": "1", "X-B": "2" }],
      ["X-A = 1 , X-B = 2", { "X-A": "1", "X-B": "2" }], // trims spaces
      ["", {}],
      ["X-NoValue=", { "X-NoValue": "" }],
      ["NoEqualsSign", {}], // no '=' -> ignored
      ["=value-only", {}], // idx=0 -> ignored
    ])("env '%s' -> %j", (envValue, expected) => {
      process.env.BITBUCKET_CUSTOM_HEADERS = envValue;
      expect(parseConfig().customHeaders).toEqual(expected);
    });

    test("options.customHeaders overrides env", () => {
      process.env.BITBUCKET_CUSTOM_HEADERS = "X-Env=e";
      expect(
        parseConfig({ customHeaders: { "X-Opt": "o" } }).customHeaders,
      ).toEqual({ "X-Opt": "o" });
    });

    test("handles custom header values containing colons", () => {
      process.env.BITBUCKET_CUSTOM_HEADERS = "X-Auth=Bearer token:with:colons";
      expect(parseConfig().customHeaders).toEqual({
        "X-Auth": "Bearer token:with:colons",
      });
    });
  });

  describe("enabledTools", () => {
    beforeEach(() => {
      process.env.BITBUCKET_URL = "https://git.example.com";
      process.env.BITBUCKET_TOKEN = "t";
    });

    test("undefined when env not set and no option", () => {
      expect(parseConfig().enabledTools).toBeUndefined();
    });

    test.each<[string, string[]]>([
      ["list_projects", ["list_projects"]],
      ["a,b,c", ["a", "b", "c"]],
      [" a , b , c ", ["a", "b", "c"]], // trims spaces
    ])("env '%s' -> %j", (envValue, expected) => {
      process.env.BITBUCKET_ENABLED_TOOLS = envValue;
      expect(parseConfig().enabledTools).toEqual(expected);
    });

    test("options.enabledTools overrides env", () => {
      process.env.BITBUCKET_ENABLED_TOOLS = "a,b";
      expect(parseConfig({ enabledTools: ["c"] }).enabledTools).toEqual(["c"]);
    });
  });

  describe("defaultProject", () => {
    beforeEach(() => {
      process.env.BITBUCKET_URL = "https://git.example.com";
      process.env.BITBUCKET_TOKEN = "t";
    });

    test("undefined when not set", () => {
      expect(parseConfig().defaultProject).toBeUndefined();
    });

    test("reads from env", () => {
      process.env.BITBUCKET_DEFAULT_PROJECT = "PROJ";
      expect(parseConfig().defaultProject).toBe("PROJ");
    });

    test("options overrides env", () => {
      process.env.BITBUCKET_DEFAULT_PROJECT = "ENV_PROJ";
      expect(parseConfig({ defaultProject: "OPT_PROJ" }).defaultProject).toBe(
        "OPT_PROJ",
      );
    });
  });
});
