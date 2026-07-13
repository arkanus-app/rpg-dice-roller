import { DiceRollError } from '../errors.js';
import type { RandomCallBudget } from './budget.js';

const STATE_SIZE = 624;
const PERIOD = 397;
const MATRIX_A = 0x9908_b0df;
const UPPER_MASK = 0x8000_0000;
const LOWER_MASK = 0x7fff_ffff;
const UINT32_RANGE = 0x1_0000_0000;

// A single immutable post-twist snapshot removes the 624-word initialization
// cost from repeated deterministic rolls without creating an unbounded cache.
let cachedSeedWords: Uint32Array | null = null;
let cachedTwistedState: Uint32Array | null = null;

export interface RandomSource {
  nextUint32(): number;
  integer(min: number, max: number): number;
  real(): number;
}

function validateSeedWord(seed: number): number {
  if (!Number.isSafeInteger(seed)) {
    throw new DiceRollError('MT19937 seed words must be safe integers', {
      code: 'INVALID_SEED',
      details: { seed: Number.isFinite(seed) ? seed : String(seed) },
    });
  }

  return seed >>> 0;
}

/** A dependency-free implementation of the original 32-bit MT19937 algorithm. */
export class MersenneTwister19937 implements RandomSource {
  private readonly state = new Uint32Array(STATE_SIZE);

  private index = STATE_SIZE;

  private readonly budget: RandomCallBudget | null;

  constructor(seed: number | ArrayLike<number>, budget: RandomCallBudget | null = null) {
    this.budget = budget;

    if (typeof seed === 'number') {
      this.initializeSeed(validateSeedWord(seed));
    } else if (!this.restoreCachedSeedArray(seed)) {
      this.initializeSeedArray(seed);
      this.twist();
      this.cacheSeedArray(seed);
    } else {
      this.index = 0;
    }
  }

  nextUint32(): number {
    this.budget?.consumeRandomCalls();

    if (this.index >= STATE_SIZE) {
      this.twist();
    }

    let value = this.readState(this.index);
    this.index += 1;
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c_5680;
    value ^= (value << 15) & 0xefc6_0000;
    value ^= value >>> 18;
    return value >>> 0;
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

  private readState(index: number): number {
    return this.state[index] ?? 0;
  }

  private writeState(index: number, value: number): void {
    this.state[index] = value >>> 0;
  }

  private initializeSeed(seed: number): void {
    this.writeState(0, seed);

    for (let index = 1; index < STATE_SIZE; index += 1) {
      const previous = this.readState(index - 1);
      const mixed = previous ^ (previous >>> 30);
      this.writeState(index, Math.imul(1_812_433_253, mixed) + index);
    }

    this.index = STATE_SIZE;
  }

  private initializeSeedArray(seeds: ArrayLike<number>): void {
    if (seeds.length < 1) {
      throw new DiceRollError('MT19937 requires at least one seed word', {
        code: 'INVALID_SEED',
      });
    }

    this.initializeSeed(19_650_218);
    let stateIndex = 1;
    let seedIndex = 0;
    let remaining = Math.max(STATE_SIZE, seeds.length);

    while (remaining > 0) {
      const previous = this.readState(stateIndex - 1);
      const current = this.readState(stateIndex);
      const seedWord = validateSeedWord(seeds[seedIndex] ?? 0);
      const mixed = Math.imul(previous ^ (previous >>> 30), 1_664_525);
      this.writeState(stateIndex, (current ^ mixed) + seedWord + seedIndex);
      stateIndex += 1;
      seedIndex += 1;

      if (stateIndex >= STATE_SIZE) {
        this.writeState(0, this.readState(STATE_SIZE - 1));
        stateIndex = 1;
      }

      if (seedIndex >= seeds.length) {
        seedIndex = 0;
      }

      remaining -= 1;
    }

    remaining = STATE_SIZE - 1;
    while (remaining > 0) {
      const previous = this.readState(stateIndex - 1);
      const current = this.readState(stateIndex);
      const mixed = Math.imul(previous ^ (previous >>> 30), 1_566_083_941);
      this.writeState(stateIndex, (current ^ mixed) - stateIndex);
      stateIndex += 1;

      if (stateIndex >= STATE_SIZE) {
        this.writeState(0, this.readState(STATE_SIZE - 1));
        stateIndex = 1;
      }

      remaining -= 1;
    }

    this.writeState(0, UPPER_MASK);
    this.index = STATE_SIZE;
  }

  private restoreCachedSeedArray(seeds: ArrayLike<number>): boolean {
    const seedWords = cachedSeedWords;
    const state = cachedTwistedState;
    if (seedWords === null || state === null || seedWords.length !== seeds.length) {
      return false;
    }
    for (let index = 0; index < seedWords.length; index += 1) {
      if (seedWords[index] !== seeds[index]) {
        return false;
      }
    }
    this.state.set(state);
    return true;
  }

  private cacheSeedArray(seeds: ArrayLike<number>): void {
    const words = new Uint32Array(seeds.length);
    for (let index = 0; index < seeds.length; index += 1) {
      words[index] = validateSeedWord(seeds[index] ?? 0);
    }
    cachedSeedWords = words;
    cachedTwistedState = this.state.slice();
  }

  private twist(): void {
    const firstBoundary = STATE_SIZE - PERIOD;
    let index = 0;
    for (; index < firstBoundary; index += 1) {
      const bits = (this.readState(index) & UPPER_MASK)
        | (this.readState(index + 1) & LOWER_MASK);
      const oddMask = (bits & 1) === 1 ? MATRIX_A : 0;
      this.writeState(index, this.readState(index + PERIOD) ^ (bits >>> 1) ^ oddMask);
    }
    for (; index < STATE_SIZE - 1; index += 1) {
      const bits = (this.readState(index) & UPPER_MASK)
        | (this.readState(index + 1) & LOWER_MASK);
      const oddMask = (bits & 1) === 1 ? MATRIX_A : 0;
      this.writeState(
        index,
        this.readState(index + PERIOD - STATE_SIZE) ^ (bits >>> 1) ^ oddMask,
      );
    }
    const finalBits = (this.readState(STATE_SIZE - 1) & UPPER_MASK)
      | (this.readState(0) & LOWER_MASK);
    const finalOddMask = (finalBits & 1) === 1 ? MATRIX_A : 0;
    this.writeState(
      STATE_SIZE - 1,
      this.readState(PERIOD - 1) ^ (finalBits >>> 1) ^ finalOddMask,
    );

    this.index = 0;
  }
}
