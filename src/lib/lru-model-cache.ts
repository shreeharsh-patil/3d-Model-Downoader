export interface SizedCacheEntry {
  byteLength: number;
}

export interface LruCacheLimits {
  maxEntries: number;
  maxBytes: number;
}

export const DEFAULT_MODEL_CACHE_LIMITS: Readonly<LruCacheLimits> = {
  maxEntries: 3,
  maxBytes: 384 * 1024 * 1024,
};

/** A bounded cache which does not clone values. Callers retain buffer ownership. */
export class LruModelCache<T extends SizedCacheEntry> {
  private readonly entries = new Map<string, T>();
  private total = 0;

  constructor(private readonly limits: LruCacheLimits = DEFAULT_MODEL_CACHE_LIMITS) {
    if (limits.maxEntries < 1 || limits.maxBytes < 1) {
      throw new Error('LRU cache limits must be positive.');
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get byteLength(): number {
    return this.total;
  }

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  get latest(): T | undefined {
    let lastValue: T | undefined;
    for (const val of this.entries.values()) {
      lastValue = val;
    }
    return lastValue;
  }

  set(key: string, value: T): void {
    const previous = this.entries.get(key);
    if (previous) this.total -= previous.byteLength;
    this.entries.delete(key);
    this.entries.set(key, value);
    this.total += value.byteLength;
    this.evict();
  }

  delete(key: string): void {
    const value = this.entries.get(key);
    if (value) this.total -= value.byteLength;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  private evict(): void {
    while (this.entries.size > this.limits.maxEntries || this.total > this.limits.maxBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.delete(oldestKey);
    }
  }
}
