import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDiceEngine } from './engine.js';
import { compileDicePlan, compileDiceProgram, compilePreparedDicePlan, inspectDicePlan, prepareDicePlanInput, validateKnownPlan } from './compiler.js';
import { createExecutionContext } from './runtime/context.js';
import { createDiceLimits } from './runtime/limits.js';
import { canonicalizeSeed, createAutomaticSeed, createProvidedSeed, createReplayDescriptor, isReplayDescriptor } from './runtime/replay.js';
import type { DiceEngineOptions, RollOptions, RollPlan } from './types.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('runtime boundaries for JavaScript consumers', () => {
  test.each([null, true, [], 1, 'cache'])('rejects invalid cache %j', (cache) => {
    expect(() => createDiceEngine({ cache } as unknown as DiceEngineOptions)).toThrow(RangeError);
  });

  test('contains revoked proxies and throwing cache properties', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const cache of [revoked.proxy, Object.defineProperty({}, 'maxInputEntries', { get() { throw new Error('private'); } })]) {
      expect(() => createDiceEngine({ cache })).toThrow('cache options could not be read');
    }
    const options = Object.defineProperty({}, 'seed', { get() { throw new Error('private'); } });
    expect(() => createDiceEngine().roll('d6', options)).toThrow(expect.objectContaining({ code: 'INVALID_REPLAY', details: { option: 'seed' } }));
  });

  test.each([{ seed: null }, { seed: {} }, { randomAlgorithm: 'unknown' }])('rejects roll options %j', (options) => {
    expect(() => createDiceEngine().roll('d6', options as unknown as RollOptions)).toThrow(expect.objectContaining({ code: 'seed' in options ? 'INVALID_SEED' : 'INVALID_REPLAY' }));
  });

  test.each([{ freezeResults: true }, { randomAlgorithm: 'unknown' }])('rejects engine options %j', (options) => {
    expect(() => createDiceEngine(options as unknown as DiceEngineOptions)).toThrow(expect.objectContaining({ code: 'freezeResults' in options ? 'INVALID_LIMIT' : 'INVALID_REPLAY' }));
  });

  test.each([null, {}, { type: 'roll-plan' }, { type: 'roll-plan', schemaVersion: 3 },
    { type: 'roll-plan', schemaVersion: 3, compilerVersion: 1 },
    { type: 'roll-plan', schemaVersion: 3, compilerVersion: 1, input: 'd6', planFingerprint: 'x'.repeat(32) },
  ])('rejects malformed external plan %j', (plan) => {
    expect(() => createDiceEngine().roll(plan as RollPlan)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_NOTATION' }));
  });

  test('contains external plan access failures', () => {
    const plan = new Proxy({}, { has() { throw 'private' as unknown as Error; } });
    expect(() => createDiceEngine().roll(plan as RollPlan)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_NOTATION', details: { cause: 'External plan access failed' } }));
  });

  test('rejects non-string compilation input and returns invalid inspections', () => {
    const input = null as unknown as string;
    expect(() => createDiceEngine().compile(input)).toThrow(expect.objectContaining({ code: 'INVALID_NOTATION' }));
    expect(() => compileDicePlan(input, createDiceLimits())).toThrow(expect.objectContaining({ code: 'INVALID_NOTATION' }));
    expect(createDiceEngine().inspect(input)).toMatchObject({ input: '', isValid: false });
    expect(inspectDicePlan(input, createDiceLimits())).toMatchObject({ input: '', isValid: false });
  });

  test('creates automatic details and summary, with freezing and algorithm overrides', () => {
    const engine = createDiceEngine({ freezeResults: 'always' });
    for (const result of [engine.rollDetails('d6'), engine.rollSummary('d6'), engine.rollDetails('d6', { randomAlgorithm: 'xoshiro128ss' }), engine.rollSummary('d6', { randomAlgorithm: 'xoshiro128ss' })]) {
      expect(Object.isFrozen(result)).toBe(true);
      expect(result.replay.origin).toBe('crypto');
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeLessThanOrEqual(6);
    }
  });

  test('validates direct execution options and absent cryptographic sources', () => {
    expect(() => createExecutionContext({ collectEvents: 1 } as unknown as Parameters<typeof createExecutionContext>[0])).toThrow(expect.objectContaining({ code: 'ROLL_EXECUTION_LIMIT' }));
    expect(() => createExecutionContext({ randomAlgorithm: 'unknown' } as unknown as Parameters<typeof createExecutionContext>[0])).toThrow(expect.objectContaining({ code: 'INVALID_REPLAY' }));
    expect(createExecutionContext({ seed: 'context' }).replay.planFingerprint).toHaveLength(32);
    vi.stubGlobal('crypto', undefined);
    expect(() => createAutomaticSeed()).toThrow(expect.objectContaining({ code: 'RNG_UNAVAILABLE' }));
  });

  test('rejects hostile replay enumeration and access', () => {
    const descriptor = createReplayDescriptor(createProvidedSeed('seed'));
    expect(isReplayDescriptor(new Proxy(descriptor, { ownKeys() { throw new Error('private'); } }))).toBe(false);
    expect(isReplayDescriptor(new Proxy({ ...descriptor }, { get() { throw new Error('private'); } }))).toBe(false);
    expect(() => canonicalizeSeed(null as unknown as string)).toThrow(expect.objectContaining({ code: 'INVALID_SEED' }));
    for (const options of [{ algorithm: 'unknown' }, { planFingerprint: 'invalid' }]) {
      expect(() => createReplayDescriptor(createProvidedSeed('seed'), options as Parameters<typeof createReplayDescriptor>[1])).toThrow(expect.objectContaining({ code: 'INVALID_REPLAY' }));
    }
    expect(() => createReplayDescriptor({ ...createProvidedSeed('seed'), seedMaterial: 'invalid' })).toThrow(expect.objectContaining({ code: 'INVALID_REPLAY' }));
  });
});

describe('cached compiled program limits', () => {
  test.each([
    ['d6+1', { maxAstNodes: 1 }, 'TOO_MANY_NODES'],
    ['d6+1', { maxAstDepth: 1 }, 'AST_TOO_DEEP'],
    ['d6', { maxSides: 5 }, 'DICE_SIDES_LIMIT_EXCEEDED'],
    ['2#d6', { maxRolls: 1 }, 'TOO_MANY_ROLLS'],
  ] as const)('revalidates %s against %j', (input, overrides, code) => {
    const plan = compileDicePlan(input, createDiceLimits());
    expect(() => validateKnownPlan(plan, createDiceLimits(overrides))).toThrow(expect.objectContaining({ code }));
  });

  test('rejects a program for a different normalized formula', () => {
    const limits = createDiceLimits();
    expect(() => compilePreparedDicePlan(prepareDicePlanInput('d6', limits), limits, compileDiceProgram('d8', 'd8', limits))).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_NOTATION' }));
  });
});
