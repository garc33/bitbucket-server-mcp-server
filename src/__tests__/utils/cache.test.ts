import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { ApiCache } from "../../http/cache.js";

describe("ApiCache", () => {
  let cache: ApiCache;
  let now: number;
  let perfSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // lru-cache captures `performance.now` at module load for TTL bookkeeping
    // and debounces it with a `setTimeout(..., ttlResolution)` that zeros out
    // its internal `cachedNow`. Faking both together keeps the debounce in
    // lock-step with our synthetic clock. We seed `now` with a non-zero value
    // because lru-cache short-circuits staleness when `starts[index]` is 0
    // (stored from the first `performance.now()` call at set time).
    now = 1_000;
    perfSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    cache = new ApiCache({ maxEntries: 10, defaultTtlMs: 100 });
  });

  afterEach(() => {
    perfSpy.mockRestore();
    vi.useRealTimers();
  });

  const advance = (ms: number) => {
    now += ms;
    vi.advanceTimersByTime(ms);
  };

  test("should return undefined for missing keys", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  test("should store and retrieve values", () => {
    cache.set("key1", { data: "hello" });
    expect(cache.get("key1")).toEqual({ data: "hello" });
  });

  test("should respect custom TTL", () => {
    cache.set("key1", "value", 50);
    expect(cache.get("key1")).toBe("value");

    advance(51);
    expect(cache.get("key1")).toBeUndefined();
  });

  test("should respect default TTL", () => {
    cache.set("key1", "value");
    expect(cache.get("key1")).toBe("value");

    advance(101);
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
