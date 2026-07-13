import { DiceRollError } from '../errors.js';
import type { RandomCallBudget } from './budget.js';
import type { RandomSource } from './mt19937.js';

const STATE_SIZE = 4;
const UINT32_RANGE = 0x1_0000_0000;

function rotateLeft(value: number, count: number): number {
  return (value << count) | (value >>> (32 - count));
}

function validateSeedWord(seed: number): number {
  if (!Number.isSafeInteger(seed)) {
    throw new DiceRollError('xoshiro128** seed words must be safe integers', {
      code: 'INVALID_SEED',
      details: { seed: Number.isFinite(seed) ? seed : String(seed) },
    });
  }
  return seed >>> 0;
}

/** The public-domain xoshiro128** 1.1 generator by Blackman and Vigna. */
export class Xoshiro128StarStar implements RandomSource {
  private state0: number;

  private state1: number;

  private state2: number;

  private state3: number;

  private readonly budget: RandomCallBudget | null;

  constructor(seed: ArrayLike<number>, budget: RandomCallBudget | null = null) {
    if (seed.length !== STATE_SIZE) {
      throw new DiceRollError('xoshiro128** requires exactly four seed words', {
        code: 'INVALID_SEED',
        details: { wordCount: seed.length },
      });
    }
    this.budget = budget;
    this.state0 = validateSeedWord(seed[0] ?? 0) | 0;
    this.state1 = validateSeedWord(seed[1] ?? 0) | 0;
    this.state2 = validateSeedWord(seed[2] ?? 0) | 0;
    this.state3 = validateSeedWord(seed[3] ?? 0) | 0;
    if ((this.state0 | this.state1 | this.state2 | this.state3) === 0) {
      // The all-zero state is absorbing. This deterministic repair keeps every
      // 128-bit descriptor replayable while avoiding a degenerate generator.
      this.state3 = 0x9e37_79b9 | 0;
    }
  }

  nextUint32(): number {
    this.budget?.consumeRandomCalls();

    const state0 = this.state0;
    let state1 = this.state1;
    let state2 = this.state2;
    let state3 = this.state3;
    const result = Math.imul(rotateLeft(Math.imul(state1, 5), 7), 9) >>> 0;
    const shifted = state1 << 9;

    state2 ^= state0;
    state3 ^= state1;
    state1 ^= state2;
    this.state0 = state0 ^ state3;
    this.state1 = state1;
    this.state2 = state2 ^ shifted;
    this.state3 = rotateLeft(state3, 11);

    return result;
  }

  integer(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new RangeError('Random integer bounds must be ordered safe integers');
    }

    const range = max - min + 1;
    if (!Number.isSafeInteger(range) || range < 1 || range > UINT32_RANGE) {
      throw new RangeError('Random integer range must contain at most 2^32 values');
    }
    if (range === UINT32_RANGE) {
      return min + this.nextUint32();
    }

    const rejectionLimit = Math.floor(UINT32_RANGE / range) * range;
    let sample = this.nextUint32();
    while (sample >= rejectionLimit) {
      sample = this.nextUint32();
    }
    return min + (sample % range);
  }

  real(): number {
    return this.nextUint32() / UINT32_RANGE;
  }
}
