import { describe, expect, test } from 'vitest';
import { createDiceEngine } from './engine.js';
import { isDiceRollError } from './errors.js';
import { validateReplayDescriptor } from './runtime/replay.js';

const formulas = [
  '20d6min3', '20d6max3', '20d6kh1', '20d6kl1', '20d6dh1', '20d6dl1',
  '20d6kh7', '20d6kl7', '20d6dh7', '20d6dl7', '20d6kh20', '20d6dh20',
  '20d6kh30', '20d6dl30', '20d6>=4f=1', '20d6>=1f=1',
  '20dF.1kh1', '20dF.2dl1', '20d%>=50', '3#20d6kh1', '3#20d6>=4f=1',
  '4d0kh1', '4d0>=4', '4d0min3', '20d6min3max4kh7>=4',
  '20d6kh1+2', '{20d6kh1,20d6kl1}kh1',
];

describe('optimized execution compatibility', () => {
  test.each(['20d6kh0', '20d6dh0', '0d6kh1', '0d6>=4', '0d6min3'])(
    'preserves invalid notation errors for %s', (formula) => {
      expect(() => createDiceEngine().rollSummary(formula, { seed: 1 }))
        .toThrow(expect.objectContaining({ code: 'INVALID_NOTATION' }));
    },
  );
  test.each(formulas)('summary matches the full executor for %s', (formula) => {
    const engine = createDiceEngine();
    const plan = engine.compile(formula);
    for (const randomAlgorithm of ['mt19937', 'xoshiro128ss'] as const) {
      for (let seed = 0; seed < 30; seed += 1) {
        const full = engine.roll(plan, { seed, randomAlgorithm });
        const summary = engine.rollSummary(plan, { seed, randomAlgorithm });
        expect(summary).toMatchObject({
          total: full.total, pool: full.pool, stats: full.stats, replay: full.replay,
          rolls: full.rolls.map(({ index, total, pool }) => ({ index, total, pool })),
        });
        expect(engine.rollSummary(plan, { replay: full.replay })).toEqual(summary);
      }
    }
  });

  test('modified summaries preserve the first failing budget and error details', () => {
    const engine = createDiceEngine();
    const capture = (run: () => unknown): unknown => {
      try {
        run();
        return null;
      } catch (error: unknown) {
        if (!isDiceRollError(error)) throw error;
        return { code: error.code, details: error.details, input: error.input };
      }
    };
    for (const formula of ['4d6min4', '4d6max2', '4d6kh1', '4d6dl2', '4d6>=4', '2#4d6kh1']) {
      const plan = engine.compile(formula);
      for (let events = 1; events <= 22; events += 1) {
        for (let items = 1; items <= 30; items += 1) {
          const options = { seed: 42, limits: { maxEvents: events, maxResultItems: items } };
          expect(capture(() => engine.rollSummary(plan, options)))
            .toEqual(capture(() => engine.roll(plan, options)));
        }
      }
      for (const limits of [{ maxRandomCalls: 1 }, { maxResolvedGroups: 1 }, { maxInitialDice: 1 }]) {
        expect(capture(() => engine.rollSummary(plan, { seed: 42, limits })))
          .toEqual(capture(() => engine.roll(plan, { seed: 42, limits })));
      }
    }
  });

  test('cached strings still honor per-call caps and external plan validation', () => {
    const engine = createDiceEngine();
    const plan = engine.compile('4d6');
    for (const input of ['4d6', plan, structuredClone(plan)]) {
      expect(() => engine.rollSummary(input, { seed: 1, limits: { maxInitialDice: 3 } }))
        .toThrow(expect.objectContaining({ code: 'TOO_MANY_INITIAL_DICE' }));
      expect(engine.rollSummary(input, { seed: 1 }))
        .toEqual(engine.rollSummary(plan, { seed: 1 }));
    }
  });

  test('replay validation snapshots getters once and never trusts external mutation', () => {
    const engine = createDiceEngine();
    const original = engine.roll('4d6', { seed: 1 }).replay;
    let reads = 0;
    const external = {
      ...original,
      get seedMaterial() {
        reads += 1;
        return reads === 1 ? original.seedMaterial : 'malformed';
      },
    };
    const validated = validateReplayDescriptor(external);
    expect(reads).toBe(1);
    expect(validated).toEqual(original);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(validateReplayDescriptor(validated)).toEqual(validated);
    expect(() => validateReplayDescriptor(external))
      .toThrow(expect.objectContaining({ code: 'INVALID_REPLAY' }));
    const mutable = { ...original };
    validateReplayDescriptor(mutable);
    mutable.seedMaterial = 'malformed';
    expect(() => validateReplayDescriptor(mutable))
      .toThrow(expect.objectContaining({ code: 'INVALID_REPLAY' }));
    expect(() => engine.roll('1d8', { replay: validated }))
      .toThrow(expect.objectContaining({ code: 'REPLAY_PLAN_MISMATCH' }));
  });
});
