import { DiceRollError } from '../errors.js';
import { MATH_PROFILE, type MathProfile } from '../math.js';
import { DEFAULT_DICE_LIMITS } from './limits.js';

export type SeedInput = number | string;

export type SeedOrigin = 'provided-number' | 'provided-string' | 'crypto';

export type RandomAlgorithm = 'mt19937' | 'xoshiro128ss';

export interface ReplayDescriptor {
  readonly schemaVersion: 2;
  readonly algorithm: RandomAlgorithm;
  readonly algorithmVersion: 1;
  readonly executionVersion: 1;
  readonly mathProfile: MathProfile;
  readonly origin: SeedOrigin;
  readonly seedMaterial: string;
  readonly planFingerprint: string;
}

export interface SeedMaterial {
  /** Internal namespaced representation. Never included in ReplayDescriptor. */
  readonly canonicalSeed: string;
  readonly seedMaterial: string;
  readonly origin: SeedOrigin;
  readonly words: readonly number[];
}

export interface CryptoSource {
  getRandomValues(array: Uint32Array): Uint32Array;
}

export interface ReplayDescriptorOptions {
  readonly algorithm?: RandomAlgorithm;
  readonly planFingerprint?: string;
}

const WORD_COUNT = 4;
const HEX_128_PATTERN = /^[0-9a-f]{32}$/u;
const EMPTY_PLAN_FINGERPRINT = '00000000000000000000000000000000';

function defaultCryptoSource(): CryptoSource | null {
  const cryptoSource = globalThis.crypto;
  return typeof cryptoSource?.getRandomValues === 'function' ? cryptoSource : null;
}

function hashCanonicalSeed(value: string): readonly number[] {
  let hash = 1_779_033_703 ^ value.length;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3_432_918_353);
    hash = (hash << 13) | (hash >>> 19);
  }

  const words: number[] = [];
  for (let index = 0; index < WORD_COUNT; index += 1) {
    hash = Math.imul(hash ^ (hash >>> 16), 2_246_822_507);
    hash = Math.imul(hash ^ (hash >>> 13), 3_266_489_909);
    hash ^= hash >>> 16;
    words.push(hash >>> 0);
  }

  return Object.freeze(words);
}

function wordsToHex(words: ArrayLike<number>): string {
  let output = '';
  for (let index = 0; index < words.length; index += 1) {
    output += (words[index] ?? 0).toString(16).padStart(8, '0');
  }
  return output;
}

function hexToWords(material: string): readonly number[] {
  const words: number[] = [];
  for (let index = 0; index < WORD_COUNT; index += 1) {
    words.push(Number.parseInt(material.slice(index * 8, (index + 1) * 8), 16));
  }
  return Object.freeze(words);
}

function invalidReplay(message: string): DiceRollError {
  return new DiceRollError(message, { code: 'INVALID_REPLAY' });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  try {
    return !Array.isArray(value);
  } catch {
    return false;
  }
}

function hasExactReplayKeys(value: Readonly<Record<string, unknown>>): boolean {
  const expected = [
    'algorithm',
    'algorithmVersion',
    'executionVersion',
    'mathProfile',
    'origin',
    'planFingerprint',
    'schemaVersion',
    'seedMaterial',
  ];
  try {
    return Object.keys(value).sort().join(',') === expected.join(',');
  } catch {
    return false;
  }
}

export function isReplayDescriptor(value: unknown): value is ReplayDescriptor {
  if (!isRecord(value) || !hasExactReplayKeys(value)) {
    return false;
  }

  try {
    return value['schemaVersion'] === 2
      && (value['algorithm'] === 'mt19937' || value['algorithm'] === 'xoshiro128ss')
      && value['algorithmVersion'] === 1
      && value['executionVersion'] === 1
      && value['mathProfile'] === MATH_PROFILE
      && (value['origin'] === 'provided-number'
        || value['origin'] === 'provided-string'
        || value['origin'] === 'crypto')
      && typeof value['seedMaterial'] === 'string'
      && HEX_128_PATTERN.test(value['seedMaterial'])
      && typeof value['planFingerprint'] === 'string'
      && HEX_128_PATTERN.test(value['planFingerprint']);
  } catch {
    return false;
  }
}

/** Validates all replay fields and optionally binds it to an expected plan. */
export function validateReplayDescriptor(
  value: unknown,
  expectedPlanFingerprint?: string,
): ReplayDescriptor {
  if (!isRecord(value)) {
    throw invalidReplay('Replay descriptor must be a non-null object');
  }

  try {
    if (value['schemaVersion'] !== 2
      || value['algorithmVersion'] !== 1
      || value['executionVersion'] !== 1
      || value['mathProfile'] !== MATH_PROFILE
      || (value['algorithm'] !== 'mt19937' && value['algorithm'] !== 'xoshiro128ss')) {
      throw new DiceRollError('The replay algorithm or version is not supported', {
        code: 'UNSUPPORTED_REPLAY_VERSION',
      });
    }
  } catch (error: unknown) {
    if (error instanceof DiceRollError) {
      throw error;
    }
    throw invalidReplay('Replay descriptor could not be read');
  }

  if (!isReplayDescriptor(value)) {
    throw invalidReplay('Replay descriptor contains malformed or unexpected fields');
  }
  if (expectedPlanFingerprint !== undefined
    && value.planFingerprint !== expectedPlanFingerprint) {
    throw new DiceRollError('Replay descriptor belongs to a different roll plan', {
      code: 'REPLAY_PLAN_MISMATCH',
      details: {
        expectedPlanFingerprint,
        actualPlanFingerprint: value.planFingerprint,
      },
    });
  }
  return value;
}

export function canonicalizeSeed(
  seed: SeedInput,
  maxSeedLength = DEFAULT_DICE_LIMITS.maxSeedLength,
): string {
  if (!Number.isSafeInteger(maxSeedLength) || maxSeedLength < 1) {
    throw new DiceRollError('maxSeedLength must be a positive safe integer', {
      code: 'INVALID_LIMIT',
      details: { maxSeedLength },
    });
  }

  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) {
      throw new DiceRollError('Numeric seeds must be finite', {
        code: 'INVALID_SEED',
        details: { seed: String(seed) },
      });
    }

    const value = Object.is(seed, -0) ? '-0' : seed.toString(10);
    return `number:${value}`;
  }

  if (typeof seed !== 'string') {
    throw new DiceRollError('Seeds must be finite numbers or strings', {
      code: 'INVALID_SEED',
    });
  }

  if (seed.length > maxSeedLength) {
    throw new DiceRollError('Text seed exceeds the maximum length', {
      code: 'INVALID_SEED',
      details: { seedLength: seed.length, maxSeedLength },
    });
  }
  return `string:${seed}`;
}

export function createProvidedSeed(
  seed: SeedInput,
  maxSeedLength = DEFAULT_DICE_LIMITS.maxSeedLength,
): SeedMaterial {
  const canonicalSeed = canonicalizeSeed(seed, maxSeedLength);
  const words = hashCanonicalSeed(canonicalSeed);
  return Object.freeze({
    canonicalSeed,
    seedMaterial: wordsToHex(words),
    origin: typeof seed === 'number' ? 'provided-number' : 'provided-string',
    words,
  });
}

export function createAutomaticSeed(
  cryptoSource: CryptoSource | null = defaultCryptoSource(),
): SeedMaterial {
  if (cryptoSource === null) {
    throw new DiceRollError('A cryptographic random source is not available', {
      code: 'RNG_UNAVAILABLE',
    });
  }

  const values = new Uint32Array(WORD_COUNT);
  try {
    cryptoSource.getRandomValues(values);
  } catch {
    throw new DiceRollError('The cryptographic random source failed', {
      code: 'RNG_UNAVAILABLE',
    });
  }
  const words = Object.freeze(Array.from(values));
  const seedMaterial = wordsToHex(words);

  return Object.freeze({
    canonicalSeed: `crypto:${seedMaterial}`,
    seedMaterial,
    origin: 'crypto',
    words,
  });
}

/** Restores the fixed 128-bit seed represented by a public replay descriptor. */
export function createReplaySeed(
  descriptor: unknown,
  expectedPlanFingerprint?: string,
): SeedMaterial {
  const replay = validateReplayDescriptor(descriptor, expectedPlanFingerprint);
  const words = hexToWords(replay.seedMaterial);
  return Object.freeze({
    canonicalSeed: `replay:${replay.seedMaterial}`,
    seedMaterial: replay.seedMaterial,
    origin: replay.origin,
    words,
  });
}

export function createSeedMaterial(
  seed: SeedInput | undefined,
  cryptoSource: CryptoSource | null = defaultCryptoSource(),
  maxSeedLength = DEFAULT_DICE_LIMITS.maxSeedLength,
): SeedMaterial {
  return seed === undefined
    ? createAutomaticSeed(cryptoSource)
    : createProvidedSeed(seed, maxSeedLength);
}

export function createReplayDescriptor(
  seed: SeedMaterial,
  options: ReplayDescriptorOptions = {},
): ReplayDescriptor {
  const algorithm = options.algorithm ?? 'mt19937';
  const planFingerprint = options.planFingerprint ?? EMPTY_PLAN_FINGERPRINT;
  if ((algorithm !== 'mt19937' && algorithm !== 'xoshiro128ss')
    || !HEX_128_PATTERN.test(seed.seedMaterial)
    || !HEX_128_PATTERN.test(planFingerprint)) {
    throw invalidReplay('Replay seed material and plan fingerprint must be 128-bit hex strings');
  }

  return Object.freeze({
    schemaVersion: 2,
    algorithm,
    algorithmVersion: 1,
    executionVersion: 1,
    mathProfile: MATH_PROFILE,
    origin: seed.origin,
    seedMaterial: seed.seedMaterial,
    planFingerprint,
  });
}
