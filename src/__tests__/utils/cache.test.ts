import { describe, test, expect, beforeEach } from "vitest";
import { ApiCache } from "../../http/cache.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("ApiCache", () => {
  let cache: ApiCache;

  beforeEach(() => {
    cache = new ApiCache({ maxEntries: 10, defaultTtlMs: 100 });
  });

  test("should return undefined for missing keys", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  test("should store and retrieve values", () => {
    cache.set("key1", { data: "hello" });
    expect(cache.get("key1")).toEqual({ data: "hello" });
  });

  test("should respect custom TTL", async () => {
    cache.set("key1", "value", 50);
    expect(cache.get("key1")).toBe("value");

    await delay(80);
    expect(cache.get("key1")).toBeUndefined();
  });

  test("should respect default TTL", async () => {
    cache.set("key1", "value");
    expect(cache.get("key1")).toBe("value");

    await delay(150);
    expect(cache.get("key1")).toBeUndefined();
  });

  test("should invalidate by exact key", () => {
    cache.set("key1", "val1");
    cache.set("key2", "val2");

    cache.invalidate("key1");

    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBe("val2");
  });

  test("should invalidate by prefix", () => {
    cache.set("projects:PROJ:repos", "val1");
    cache.set("projects:PROJ:branches", "val2");
    cache.set("projects:OTHER:repos", "val3");

    cache.invalidateByPrefix("projects:PROJ");

    expect(cache.get("projects:PROJ:repos")).toBeUndefined();
    expect(cache.get("projects:PROJ:branches")).toBeUndefined();
    expect(cache.get("projects:OTHER:repos")).toBe("val3");
  });

  test("should clear all entries", () => {
    cache.set("a", 1);
    cache.set("b", 2);

    cache.clear();

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});
