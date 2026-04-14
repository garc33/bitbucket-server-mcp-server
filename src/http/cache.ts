import { LRUCache } from "lru-cache";

interface CacheOptions {
  maxEntries?: number;
  defaultTtlMs?: number;
}

export class ApiCache {
  private cache: LRUCache<string, NonNullable<unknown>>;
  private defaultTtlMs: number;

  constructor(options: CacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 5 * 60 * 1000;
    this.cache = new LRUCache<string, NonNullable<unknown>>({
      max: options.maxEntries ?? 500,
      ttl: this.defaultTtlMs,
    });
  }

  get<T>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined;
  }

  set(key: string, value: NonNullable<unknown>, ttlMs?: number): void {
    this.cache.set(key, value, { ttl: ttlMs ?? this.defaultTtlMs });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidateByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
