interface CacheEntry<Value> {
  readonly value: Value;
  readonly weight: number;
}

export interface LruCacheStats {
  readonly entries: number;
  readonly weight: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

/** Small deterministic LRU used by the engine's input and compiled-program caches. */
export class WeightedLruCache<Key, Value> {
  private readonly maxEntries: number;

  private readonly maxWeight: number;

  private readonly entries = new Map<Key, CacheEntry<Value>>();

  private currentWeight = 0;

  private hitCount = 0;

  private missCount = 0;

  private evictionCount = 0;

  constructor(
    maxEntries: number,
    maxWeight: number,
  ) {
    this.maxEntries = maxEntries;
    this.maxWeight = maxWeight;
  }

  get(key: Key): Value | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      this.missCount += 1;
      return undefined;
    }

    this.hitCount += 1;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: Key, value: Value, weight = 1): void {
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      this.entries.delete(key);
      this.currentWeight -= existing.weight;
    }

    if (this.maxEntries === 0 || this.maxWeight === 0 || weight > this.maxWeight) {
      return;
    }

    this.entries.set(key, { value, weight });
    this.currentWeight += weight;
    this.evictOverflow();
  }

  clear(): void {
    this.entries.clear();
    this.currentWeight = 0;
    this.hitCount = 0;
    this.missCount = 0;
    this.evictionCount = 0;
  }

  stats(): LruCacheStats {
    return {
      entries: this.entries.size,
      weight: this.currentWeight,
      hits: this.hitCount,
      misses: this.missCount,
      evictions: this.evictionCount,
    };
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries || this.currentWeight > this.maxWeight) {
      const oldest = this.entries.entries().next().value;
      if (oldest === undefined) {
        return;
      }
      const [key, entry] = oldest;
      this.entries.delete(key);
      this.currentWeight -= entry.weight;
      this.evictionCount += 1;
    }
  }
}
