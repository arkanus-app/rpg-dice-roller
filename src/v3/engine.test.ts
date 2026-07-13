import { describe, expect, test } from 'vitest';
import { compileDicePlan } from './compiler.js';
import {
  compileRpgDice,
  createDiceEngine,
  inspectRpgDiceNotation,
  rollRpgDice,
  verifyRpgDiceNotation,
} from './engine.js';
import { DEFAULT_DICE_LIMITS } from './runtime/limits.js';

describe('V3 dice engine', () => {
  test('exposes the functional facade and reusable plans', () => {
    const plan = compileRpgDice('2d6+3 [ataque]');
    const first = rollRpgDice(plan, { seed: 'same' });
    const second = rollRpgDice(plan, { seed: 'same' });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      type: 'dice-roll',
      schemaVersion: 3,
      notation: '2d6+3',
      comment: 'ataque',
      replay: {
        schemaVersion: 2,
        algorithm: 'mt19937',
        algorithmVersion: 1,
        origin: 'provided-string',
      },
    });
    expect(first.total).toBe(first.rolls[0]?.total);
    expect(first.dice).toHaveLength(2);
    expect(first.groups.map((group) => group.kind)).toEqual(['dice', 'expression', 'expression']);
    expect(first.events.map((event) => event.sequence))
      .toEqual(first.events.map((_, index) => index + 1));
  });

  test('rolls independent multi-roll entries and sums their totals', () => {
    const result = rollRpgDice('2#2d6+3 // vantagem', { seed: 'test' });

    expect(result.rolls.map((roll) => roll.total)).toEqual([7, 11]);
    expect(result.total).toBe(18);
    expect(result.dice.map((die) => die.rollIndex)).toEqual([1, 1, 2, 2]);
    expect(result.output).toContain('Total: 18');
  });

  test('resolves keep, drop, min, max, critical, and sorting modifiers', () => {
    const kept = rollRpgDice('4d6kh3', { seed: 'test' });
    expect(kept.dice.filter((die) => !die.included)).toHaveLength(1);
    expect(kept.events).toContainEqual(expect.objectContaining({
      type: 'exclude', reason: 'keep', dieId: 'roll-1-die-2',
    }));

    const dropped = rollRpgDice('3d6dl1', { seed: 'test' });
    expect(dropped.dice.filter((die) => !die.included)).toHaveLength(1);
    expect(dropped.events).toContainEqual(expect.objectContaining({ type: 'exclude', reason: 'drop' }));

    const bounded = rollRpgDice('1d6min4max5', { seed: 'test' });
    expect(bounded.dice[0]).toMatchObject({ value: 4, states: ['minimum'] });

    const critical = rollRpgDice('2d6cs=6cf=1', { seed: 'test' });
    expect(critical.dice[1]?.states).toContain('critical-failure');

    const sorted = rollRpgDice('2d6sd', { seed: 'test' });
    expect(sorted.groups[0]?.childIds).toEqual(['roll-1-die-1', 'roll-1-die-2']);
  });

  test('records causal explosions, rerolls, and unique retries', () => {
    const exploded = rollRpgDice('1d6!', { seed: 's12' });
    expect(exploded.dice.map((die) => die.rawValue)).toEqual([6, 2]);
    expect(exploded.dice[1]?.parentDieId).toBe(exploded.dice[0]?.id);
    expect(exploded.events).toContainEqual(expect.objectContaining({
      type: 'explode',
      dieId: exploded.dice[0]?.id,
      childDieId: exploded.dice[1]?.id,
    }));

    const rerolled = rollRpgDice('1d6r<3', { seed: 's0' });
    expect(rerolled.dice[0]).toMatchObject({ rawValue: 1, value: 5, states: ['rerolled'] });
    expect(rerolled.events).toContainEqual(expect.objectContaining({
      type: 'reroll', from: 1, to: 5, reason: 'reroll',
    }));

    const unique = rollRpgDice('4d6u', { seed: 's2' });
    expect(unique.dice[3]).toMatchObject({ rawValue: 4, value: 6, states: ['unique-rerolled'] });
    expect(unique.events.filter((event) => event.type === 'reroll')).toHaveLength(3);
  });

  test('keeps every causal reference valid and event sequences strictly increasing', () => {
    for (const notation of ['2#1d6!', '1d6!!', '1d6!p', '4d6u', '2d6r<3']) {
      const result = rollRpgDice(notation, { seed: `causal:${notation}` });
      const dieIds = new Set(result.dice.map((die) => die.id));

      for (const die of result.dice) {
        expect(die.parentDieId === null || dieIds.has(die.parentDieId)).toBe(true);
      }
      for (const event of result.events) {
        if (event.subject === 'die') {
          expect(dieIds.has(event.dieId)).toBe(true);
          expect(event.parentDieId === null || dieIds.has(event.parentDieId)).toBe(true);
          if (event.type === 'explode') {
            expect(dieIds.has(event.childDieId)).toBe(true);
          }
        }
      }
      expect(result.events.map((event) => event.sequence))
        .toEqual(result.events.map((_, index) => index + 1));
    }
  });

  test('supports compound, penetrate, and once variants', () => {
    const compound = rollRpgDice('1d6!!', { seed: 's12' });
    expect(compound.total).toBe(8);
    expect(compound.dice[0]?.states).toEqual(expect.arrayContaining(['exploded', 'compound']));
    expect(compound.dice[1]).toMatchObject({ included: false, parentDieId: 'roll-1-die-1' });

    const penetrate = rollRpgDice('1d6!p', { seed: 's12' });
    expect(penetrate.dice.map((die) => die.value)).toEqual([6, 1]);

    const once = rollRpgDice('1d6ro<3', { seed: 's0' });
    expect(once.events).toContainEqual(expect.objectContaining({ reason: 'reroll-once' }));

    const uniqueOnce = rollRpgDice('4d6uo', { seed: 's2' });
    expect(uniqueOnce.events).toContainEqual(expect.objectContaining({ reason: 'unique-once' }));
  });

  test('covers explicit and default comparison variants', () => {
    const explicitExplosion = rollRpgDice('1d6!=3', { seed: 'test' });
    expect(explicitExplosion.events.some((event) => event.type === 'explode')).toBe(true);

    const defaultReroll = rollRpgDice('1d6r', { seed: 's0' });
    expect(defaultReroll.events).toContainEqual(expect.objectContaining({
      type: 'reroll', from: 1, reason: 'reroll',
    }));

    const bounded = rollRpgDice('1d6min2max2', { seed: 'test' });
    expect(bounded.dice[0]).toMatchObject({ value: 2, states: ['maximum'] });

    expect(rollRpgDice('1d6cs', { seed: 's12' }).dice[0]?.states)
      .toContain('critical-success');
    expect(rollRpgDice('1d6cf', { seed: 's0' }).dice[0]?.states)
      .toContain('critical-failure');
    expect(rollRpgDice('2d6sa', { seed: 'test' }).groups[0]?.childIds)
      .toEqual(['roll-1-die-2', 'roll-1-die-1']);
  });

  test('handles constant dice arguments and every expression node', () => {
    const result = rollRpgDice('(abs(-2)+1)d(pow(2,2))+(2**3-8)+(7%3)*2', { seed: 'test' });
    expect(result.dice).toHaveLength(3);
    expect(result.dice.every((die) => die.sides === 4)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(5);

    expect(rollRpgDice('1+(+2)+(-3)', { seed: 'test' }).total).toBe(0);
    expect(rollRpgDice('max(2,3)+min(2,3)+floor(1.8)', { seed: 'test' }).total).toBe(6);
    expect(rollRpgDice('1', { seed: 'test' })).toMatchObject({ total: 1, dice: [] });
  });

  test('classifies failures and excluded target dice without contributing them', () => {
    const result = rollRpgDice('2d6dl1>=3f=1', { seed: 'test' });
    expect(result.dice).toEqual([
      expect.objectContaining({ included: true, contribution: 1, states: ['target-success'] }),
      expect.objectContaining({
        included: false,
        contribution: 0,
        states: ['dropped', 'target-failure'],
      }),
    ]);
    expect(result.pool).toEqual({ successes: 1, failures: 0, netSuccesses: 1 });
  });

  test('supports only keep, drop, and sort modifiers on groups', () => {
    expect(rollRpgDice('{1,2}kh1', { seed: 'test' }).total).toBe(2);
    expect(rollRpgDice('{1,2}dl1', { seed: 'test' }).total).toBe(2);
    expect(rollRpgDice('{1,2}sd', { seed: 'test' }).groups.at(-1)?.childIds)
      .toEqual(['roll-1:group:number@3:4', 'roll-1:group:number@1:2']);
    for (const notation of ['{1,2}min3', '{1,2}>=2', '{1,2}cs=2', '{1,2}!', '{1,2}r', '{1,2}u']) {
      expect(() => rollRpgDice(notation, { seed: 'test' }))
        .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_GROUP_MODIFIER' }));
    }
  });

  test('keeps inactive compound children out of later modifiers', () => {
    const result = rollRpgDice('1d6!!r<3>=1cs', { seed: 's12' });
    expect(result.dice[1]).toMatchObject({ included: false, contribution: 0 });
    expect(result.events.filter((event) => event.type === 'classify')).toHaveLength(1);
  });

  test('returns typed success pools and null for normal dice', () => {
    const pool = rollRpgDice('5d10>=8f=1', { seed: 'test' });
    expect(pool.pool).toEqual({ successes: 1, failures: 0, netSuccesses: 1 });
    expect(pool.dice.map((die) => die.contribution)).toEqual([1, 0, 0, 0, 0]);
    expect(pool.events.filter((event) => event.type === 'classify')).toHaveLength(5);
    expect(rollRpgDice('1d6', { seed: 'test' }).pool).toBeNull();
  });

  test('resolves groups, functions, standard, percentile, and Fudge dice', () => {
    const grouped = rollRpgDice('{1d6,1d8}kh1', { seed: 'test' });
    expect(grouped.total).toBe(7);
    expect(grouped.groups.at(-1)).toMatchObject({ kind: 'group', value: 7 });

    const calculated = rollRpgDice('ceil(1d6/2)+pow(2,3)', { seed: 'test' });
    expect(calculated.total).toBe(10);
    expect(calculated.groups.some((group) => group.kind === 'function')).toBe(true);

    const special = rollRpgDice('1d%+1dF.1+1dF.2', { seed: 'test' });
    expect(special.dice.map((die) => die.sides)).toEqual([100, 'F', 'F']);
  });

  test('resolves every Fudge face branch deterministically', () => {
    const faces = new Set<number>();
    for (let index = 0; index < 40; index += 1) {
      faces.add(rollRpgDice('1dF.1', { seed: `fudge-${index}` }).dice[0]?.value ?? 99);
    }
    expect(faces).toEqual(new Set([-1, 0, 1]));
    expect(rollRpgDice('1dF.2', { seed: 'test' }).dice[0]?.value).toBeGreaterThanOrEqual(-1);
  });

  test('enforces hard runtime budgets independent of inspection estimates', () => {
    expect(() => createDiceEngine({ limits: { maxRandomCalls: 1 } })
      .roll('2d6', { seed: 'budget' }))
      .toThrow(expect.objectContaining({ code: 'RANDOM_BUDGET_EXCEEDED' }));

    expect(() => createDiceEngine({ limits: { maxGeneratedDice: 1 } })
      .roll('1d2!', { seed: 's12' }))
      .toThrow(expect.objectContaining({ code: 'GENERATED_DICE_LIMIT_EXCEEDED' }));

    expect(() => createDiceEngine({ limits: { maxEvents: 1 } })
      .roll('1d6', { seed: 'budget' }))
      .toThrow(expect.objectContaining({ code: 'EVENT_LIMIT_EXCEEDED' }));
  });

  test('bounds and promotes input/program LRU entries across compile, inspect, and verify', () => {
    const engine = createDiceEngine({
      limits: { maxInitialDice: 4 },
      cache: { maxInputEntries: 1, maxProgramEntries: 1, maxProgramNodes: 100 },
    });
    const first = engine.compile('1d6');
    expect(engine.compile('1d6')).toBe(first);
    expect(engine.inspect('1d6').plan).toBe(first);
    engine.compile('1d8');
    expect(engine.compile('1d6')).not.toBe(first);
    expect(engine.getCacheStats()).toMatchObject({
      inputEntries: 1,
      programEntries: 1,
    });
    expect(engine.getCacheStats().programNodes).toBeLessThanOrEqual(100);
    expect(engine.getCacheStats().evictions).toBeGreaterThan(0);

    expect(engine.inspect('invalid')).toMatchObject({ isValid: false, plan: null });
    expect(engine.verify('1d6')).toBe(true);
    expect(engine.verify('invalid')).toBe(false);
    expect(engine.normalize('d + f')).toBe('d20+4dF');
    expect(() => engine.compile('1d6', { limits: { maxInitialDice: 5 } }))
      .toThrow(expect.objectContaining({ code: 'INVALID_LIMIT' }));
    expect(() => createDiceEngine({ cache: { maxInputEntries: -1 } })).toThrow(RangeError);
    const uncached = createDiceEngine({ cache: false });
    expect(uncached.compile('1d6')).not.toBe(uncached.compile('1d6'));

    engine.clearCache();
    expect(engine.getCacheStats()).toEqual({
      inputEntries: 0, programEntries: 0, programNodes: 0,
      hits: 0, misses: 0, evictions: 0,
    });
  });

  test('shares a normalized program across input envelopes and limits its node weight', () => {
    const engine = createDiceEngine({
      cache: { maxInputEntries: 5, maxProgramEntries: 5, maxProgramNodes: 4 },
    });
    engine.compile('1d6 [first]');
    engine.compile(' 1d6 // second');
    expect(engine.getCacheStats()).toMatchObject({ inputEntries: 2, programEntries: 1 });

    engine.compile('1d6+1d8');
    expect(engine.getCacheStats().programNodes).toBeLessThanOrEqual(4);
  });

  test('freezes results and restores public plans after a JSON-safe clone', () => {
    const engine = createDiceEngine({ freezeResults: 'always' });
    const result = engine.roll('1d6', { seed: 'frozen' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.dice)).toBe(true);
    expect(Object.isFrozen(result.dice[0])).toBe(true);

    const plan = compileDicePlan('1d6', DEFAULT_DICE_LIMITS);
    const clonedPlan = structuredClone(plan);
    expect(engine.roll(clonedPlan, { seed: 'clone' }))
      .toEqual(engine.roll(plan, { seed: 'clone' }));
    expect(JSON.parse(JSON.stringify(clonedPlan))).toEqual(plan);
    expect(engine.roll({ ...plan, notation: '1d20', groups: [] }, { seed: 'clone' }))
      .toEqual(engine.roll(plan, { seed: 'clone' }));
    expect(() => engine.roll({ ...plan, planFingerprint: '0'.repeat(32) }, { seed: 'clone' }))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_NOTATION' }));
  });

  test('reads only the safe envelope of external plans and normalizes hostile access failures', () => {
    const engine = createDiceEngine();
    const plan = structuredClone(engine.compile('1d6'));
    Object.defineProperty(plan, 'groups', {
      get(): never {
        throw new Error('groups must not be read');
      },
    });
    expect(() => engine.roll(plan, { seed: 'external-plan' })).not.toThrow();

    const hostile = new Proxy(structuredClone(engine.compile('1d6')), {
      get(target, property): unknown {
        if (property === 'input') {
          throw new Error('hostile input getter');
        }
        if (property === 'type') {
          return target.type;
        }
        if (property === 'schemaVersion') {
          return target.schemaVersion;
        }
        if (property === 'compilerVersion') {
          return target.compilerVersion;
        }
        return undefined;
      },
    });
    expect(() => engine.roll(hostile, { seed: 'external-plan' }))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_NOTATION' }));
  });

  test('generates a crypto replay descriptor when no seed is supplied', () => {
    const result = createDiceEngine({ freezeResults: 'never' }).roll('1d6');
    expect(result.replay).toMatchObject({
      schemaVersion: 2, algorithm: 'mt19937', algorithmVersion: 1, origin: 'crypto',
    });
    expect(result.replay.seedMaterial).toMatch(/^[0-9a-f]{32}$/u);
    expect(rollRpgDice('1d6', { replay: result.replay })).toEqual(result);
  });

  test('validates JavaScript option boundaries and replay exclusivity', () => {
    const engine = createDiceEngine();
    const replay = engine.roll('1d6', { seed: 'boundary' }).replay;
    const unsafeRoll = engine.roll.bind(engine) as (input: string, options: unknown) => unknown;
    const unsafeSummary = engine.rollSummary.bind(engine) as (
      input: string,
      options: unknown,
    ) => unknown;
    const unsafeCreateEngine = createDiceEngine as (options: unknown) => unknown;
    expect(() => unsafeRoll('1d6', { replay, seed: 'conflict' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_REPLAY' }));
    expect(() => unsafeSummary('1d6', { randomAlgorithm: 'xoshiro128ss', replay }))
      .toThrow(expect.objectContaining({ code: 'INVALID_REPLAY' }));
    expect(() => unsafeRoll('1d6', null))
      .toThrow(expect.objectContaining({ code: 'INVALID_LIMIT' }));
    expect(() => unsafeCreateEngine(null))
      .toThrow(expect.objectContaining({ code: 'INVALID_LIMIT' }));
  });

  test('functional inspection and verification do not roll', () => {
    const inspection = inspectRpgDiceNotation('2d6');
    expect(inspection).toMatchObject({ isValid: true, cost: { staticDice: 2 } });
    expect(verifyRpgDiceNotation('2d6')).toBe(true);
    expect(verifyRpgDiceNotation('abc')).toBe(false);
  });
});
