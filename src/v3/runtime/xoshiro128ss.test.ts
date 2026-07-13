import { describe, expect, it } from 'vitest';
import type { RandomCallBudget } from './budget.js';
import { Xoshiro128StarStar } from './xoshiro128ss.js';

describe('Xoshiro128StarStar', () => {
  it('matches the reference xoshiro128** 1.1 sequence', () => {
    const random = new Xoshiro128StarStar([1, 2, 3, 4]);
    expect(Array.from({ length: 10 }, () => random.nextUint32())).toEqual([
      11_520,
      0,
      5_927_040,
      70_819_200,
      2_031_721_883,
      1_637_235_492,
      1_287_239_034,
      3_734_860_849,
      3_729_100_597,
      4_258_142_804,
    ]);
  });

  it('is deterministic and charges every draw to the random budget', () => {
    let calls = 0;
    const budget: RandomCallBudget = {
      consumeRandomCalls(count = 1): void {
        calls += count;
      },
    };
    const first = new Xoshiro128StarStar([11, 22, 33, 44], budget);
    const second = new Xoshiro128StarStar([11, 22, 33, 44]);
    expect(Array.from({ length: 50 }, () => first.integer(1, 20))).toEqual(
      Array.from({ length: 50 }, () => second.integer(1, 20)),
    );
    expect(calls).toBeGreaterThanOrEqual(50);
  });

  it('supports ranges, real values and the deterministic all-zero repair', () => {
    const random = new Xoshiro128StarStar([0, 0, 0, 0]);
    expect(random.nextUint32()).toBe(0);
    random.nextUint32();
    expect(random.nextUint32()).not.toBe(0);
    expect(new Xoshiro128StarStar([1, 2, 3, 4]).real()).toBeGreaterThanOrEqual(0);
    expect(new Xoshiro128StarStar([1, 2, 3, 4]).integer(-2_147_483_648, 2_147_483_647))
      .toBe(-2_147_472_128);
  });

  it('rejects malformed seeds and invalid ranges', () => {
    expect(() => new Xoshiro128StarStar([1, 2, 3])).toThrow('exactly four');
    expect(() => new Xoshiro128StarStar([1, 2, 3, Number.NaN])).toThrow('seed words');
    expect(() => new Xoshiro128StarStar([1, 2, 3, 1.5])).toThrow('seed words');
    const random = new Xoshiro128StarStar([1, 2, 3, 4]);
    expect(() => random.integer(2, 1)).toThrow(RangeError);
    expect(() => random.integer(0.5, 1)).toThrow(RangeError);
    expect(() => random.integer(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .toThrow(RangeError);

    const sparse = new Array<number>(4);
    expect(() => new Xoshiro128StarStar(sparse)).not.toThrow();
  });

  it('uses rejection sampling when the first value falls outside the fair range', () => {
    const random = new Xoshiro128StarStar([1, 2, 3, 4]);
    for (let index = 0; index < 7; index += 1) {
      random.nextUint32();
    }
    expect(random.integer(0, 2_147_483_648)).toBeGreaterThanOrEqual(0);
  });
});
