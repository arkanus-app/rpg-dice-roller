import { describe, expect, it } from 'vitest';
import type { RandomCallBudget } from './budget.js';
import { MersenneTwister19937 } from './mt19937.js';

describe('MersenneTwister19937', () => {
  it('matches the published reference sequence for seed 5489', () => {
    const random = new MersenneTwister19937(5_489);

    expect(Array.from({ length: 10 }, () => random.nextUint32())).toEqual([
      3_499_211_612,
      581_869_302,
      3_890_346_734,
      3_586_334_585,
      545_404_204,
      4_161_255_391,
      3_922_919_429,
      949_333_985,
      2_715_962_298,
      1_323_567_403,
    ]);
  });

  it('is deterministic for seed arrays and accounts for every random draw', () => {
    let calls = 0;
    const budget: RandomCallBudget = {
      consumeRandomCalls(count = 1): void {
        calls += count;
      },
    };
    const first = new MersenneTwister19937([1, 2, 3, 4], budget);
    const second = new MersenneTwister19937([1, 2, 3, 4]);

    const firstValues = Array.from({ length: 20 }, () => first.integer(1, 20));
    const secondValues = Array.from({ length: 20 }, () => second.integer(1, 20));
    expect(firstValues).toEqual(secondValues);
    expect(firstValues.every((value) => value >= 1 && value <= 20)).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(20);
  });

  it('returns reals in the half-open unit interval', () => {
    const random = new MersenneTwister19937(42);
    const values = Array.from({ length: 100 }, () => random.real());
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('validates seeds and integer ranges', () => {
    expect(() => new MersenneTwister19937(Number.POSITIVE_INFINITY)).toThrow('seed words');
    expect(() => new MersenneTwister19937(1.5)).toThrow('seed words');
    expect(() => new MersenneTwister19937([])).toThrow('at least one seed');
    expect(() => new MersenneTwister19937([1, Number.NaN])).toThrow('seed words');
    const sparse = new Array<number>(4);
    expect(() => new MersenneTwister19937(sparse)).not.toThrow();

    const random = new MersenneTwister19937(5_489);
    expect(() => random.integer(2, 1)).toThrow(RangeError);
    expect(() => random.integer(0.5, 2)).toThrow(RangeError);
    expect(() => random.integer(-2_147_483_648, 2_147_483_648)).toThrow(RangeError);
  });

  it('supports the full uint32 range and rejection sampling', () => {
    const full = new MersenneTwister19937(5_489);
    expect(full.integer(-2_147_483_648, 2_147_483_647)).toBe(1_351_727_964);

    const rejecting = new MersenneTwister19937(5_489);
    // The first reference value is above the rejection limit for this range.
    expect(rejecting.integer(0, 2_147_483_648)).toBe(581_869_302);
  });
});
