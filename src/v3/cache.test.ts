import { describe, expect, test } from 'vitest';
import { WeightedLruCache } from './cache.js';

describe('weighted LRU cache', () => {
  test('promotes hits and evicts the least-recently-used entry by count', () => {
    const cache = new WeightedLruCache<string, number>(2, 10);
    cache.set('first', 1, 1);
    cache.set('second', 2, 1);
    expect(cache.get('first')).toBe(1);
    cache.set('third', 3, 1);

    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('first')).toBe(1);
    expect(cache.get('third')).toBe(3);
    cache.set('third', 30, 2);
    expect(cache.get('third')).toBe(30);
    expect(cache.stats()).toMatchObject({ entries: 2, weight: 3, evictions: 1 });
  });

  test('enforces aggregate weight and never retains an oversized entry', () => {
    const cache = new WeightedLruCache<string, number>(10, 4);
    cache.set('first', 1, 3);
    cache.set('second', 2, 2);
    expect(cache.get('first')).toBeUndefined();
    expect(cache.stats()).toMatchObject({ entries: 1, weight: 2, evictions: 1 });

    cache.set('oversized', 3, 5);
    expect(cache.get('oversized')).toBeUndefined();
    expect(cache.stats()).toMatchObject({ entries: 1, weight: 2 });
  });

  test('clear removes entries and resets counters', () => {
    const cache = new WeightedLruCache<string, number>(1, 1);
    cache.get('missing');
    cache.set('value', 1);
    cache.get('value');
    cache.clear();
    expect(cache.stats()).toEqual({
      entries: 0,
      weight: 0,
      hits: 0,
      misses: 0,
      evictions: 0,
    });
  });

  test('stops eviction safely if constructed with an impossible internal cap', () => {
    const cache = new WeightedLruCache<string, number>(-1, 1);
    cache.set('value', 1);
    expect(cache.stats()).toMatchObject({ entries: 0, weight: 0 });
  });
});
