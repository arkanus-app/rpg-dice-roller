import { describe, expect, it } from 'vitest';
import { isDiceRollError } from '../errors.js';
import { createExecutionContext } from './context.js';
import {
  canonicalizeSeed,
  createAutomaticSeed,
  createProvidedSeed,
  createReplayDescriptor,
  createReplaySeed,
  isReplayDescriptor,
  validateReplayDescriptor,
  type CryptoSource,
  type ReplayDescriptor,
} from './replay.js';

const PLAN_FINGERPRINT = '0123456789abcdef0123456789abcdef';

function descriptor(overrides: Partial<ReplayDescriptor> = {}): ReplayDescriptor {
  return {
    schemaVersion: 2,
    algorithm: 'mt19937',
    algorithmVersion: 1,
    executionVersion: 1,
    mathProfile: 'decimal12-v1',
    origin: 'provided-string',
    seedMaterial: '0123456789abcdef0123456789abcdef',
    planFingerprint: PLAN_FINGERPRINT,
    ...overrides,
  };
}

describe('seed and replay V2', () => {
  it('canonicalizes number and string seeds into separate fixed materials', () => {
    expect(canonicalizeSeed(42)).toBe('number:42');
    expect(canonicalizeSeed('42')).toBe('string:42');
    expect(createProvidedSeed(42).origin).toBe('provided-number');
    expect(createProvidedSeed('42').origin).toBe('provided-string');
    expect(createProvidedSeed(42).seedMaterial).toMatch(/^[0-9a-f]{32}$/u);
    expect(createProvidedSeed(42).words).not.toEqual(createProvidedSeed('42').words);
    expect(canonicalizeSeed(-0)).toBe('number:-0');
  });

  it('enforces text seed length before hashing', () => {
    expect(canonicalizeSeed('abcd', 4)).toBe('string:abcd');
    expect(() => canonicalizeSeed('abcde', 4)).toThrow(
      expect.objectContaining({ code: 'INVALID_SEED' }),
    );
    expect(() => canonicalizeSeed('x', 0)).toThrow(
      expect.objectContaining({ code: 'INVALID_LIMIT' }),
    );
  });

  it('creates a 128-bit automatic seed from crypto without exposing source text', () => {
    const cryptoSource: CryptoSource = {
      getRandomValues(values: Uint32Array): Uint32Array {
        values.set([1, 2, 3, 4]);
        return values;
      },
    };
    const seed = createAutomaticSeed(cryptoSource);
    const replay = createReplayDescriptor(seed, { planFingerprint: PLAN_FINGERPRINT });

    expect(seed.seedMaterial).toBe('00000001000000020000000300000004');
    expect(replay).toEqual({
      schemaVersion: 2,
      algorithm: 'mt19937',
      algorithmVersion: 1,
      executionVersion: 1,
      mathProfile: 'decimal12-v1',
      origin: 'crypto',
      seedMaterial: seed.seedMaterial,
      planFingerprint: PLAN_FINGERPRINT,
    });
    expect(JSON.stringify(replay)).not.toContain('crypto:');
  });

  it('fails without working crypto and rejects non-finite numeric seeds', () => {
    expect(() => createAutomaticSeed(null)).toThrow(
      expect.objectContaining({ code: 'RNG_UNAVAILABLE' }),
    );
    expect(() => createAutomaticSeed({
      getRandomValues(): Uint32Array {
        throw new Error('unavailable');
      },
    })).toThrow(expect.objectContaining({ code: 'RNG_UNAVAILABLE' }));
    expect(() => canonicalizeSeed(Number.POSITIVE_INFINITY)).toThrow(
      expect.objectContaining({ code: 'INVALID_SEED' }),
    );
  });

  it('replays both algorithms exactly and binds descriptors to a plan', () => {
    for (const algorithm of ['mt19937', 'xoshiro128ss'] as const) {
      const first = createExecutionContext({
        seed: 'encounter-42',
        randomAlgorithm: algorithm,
        planFingerprint: PLAN_FINGERPRINT,
      });
      const second = createExecutionContext({
        replay: first.replay,
        planFingerprint: PLAN_FINGERPRINT,
      });
      expect(first.replay).toEqual(second.replay);
      expect(Array.from({ length: 20 }, () => first.random.integer(1, 100))).toEqual(
        Array.from({ length: 20 }, () => second.random.integer(1, 100)),
      );
    }

    expect(() => createReplaySeed(descriptor(), 'ffffffffffffffffffffffffffffffff'))
      .toThrow(expect.objectContaining({ code: 'REPLAY_PLAN_MISMATCH' }));
  });

  it('validates the complete descriptor including null, extra fields and overrides', () => {
    expect(isReplayDescriptor(descriptor())).toBe(true);
    expect(isReplayDescriptor(null)).toBe(false);
    expect(isReplayDescriptor({ ...descriptor(), extra: true })).toBe(false);
    expect(() => validateReplayDescriptor(null)).toThrow(
      expect.objectContaining({ code: 'INVALID_REPLAY' }),
    );
    expect(() => validateReplayDescriptor({ ...descriptor(), schemaVersion: 1 }))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_REPLAY_VERSION' }));
    expect(() => validateReplayDescriptor({ ...descriptor(), seedMaterial: 'nope' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_REPLAY' }));
    expect(() => createExecutionContext({
      replay: descriptor(),
      randomAlgorithm: 'mt19937',
    })).toThrow(expect.objectContaining({ code: 'INVALID_REPLAY' }));
    expect(() => createExecutionContext({
      seed: 'x',
      replay: descriptor(),
    })).toThrow(expect.objectContaining({ code: 'INVALID_REPLAY' }));
  });

  it('rejects hostile getters without leaking their exception', () => {
    const hostile = Object.defineProperty({}, 'schemaVersion', {
      enumerable: true,
      get(): never {
        throw new Error('hostile');
      },
    });
    try {
      validateReplayDescriptor(hostile);
    } catch (error: unknown) {
      expect(isDiceRollError(error)).toBe(true);
    }
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => validateReplayDescriptor(revoked.proxy)).toThrow(
      expect.objectContaining({ code: 'INVALID_REPLAY' }),
    );
  });
});
