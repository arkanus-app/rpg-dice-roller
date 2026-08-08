import { describe, expect, test } from 'vitest';
import { createDiceEngine } from '../engine.js';
import { createSystemRoller } from './system-roller.js';

describe('configured system roller', () => {
  test('rejects values that are not complete dice engines', () => {
    for (const invalid of [null, {}, { roll() {} }, { roll() {}, rollDetails() {} }]) {
      expect(() => createSystemRoller(invalid as never)).toThrow(
        new TypeError('createSystemRoller requires a DiceEngine'),
      );
    }
  });

  test('uses compact system projections without duplicating the complete base roll', () => {
    const systems = createSystemRoller(createDiceEngine({ randomAlgorithm: 'xoshiro128ss' }));
    const full = systems.rollFateDice({ dice: 100 }, { seed: 'compact-system' });
    const compact = systems.rollFateDice(
      { dice: 100 },
      { detail: 'compact', replay: full.baseRoll.replay },
    );

    expect(compact.dice).toEqual(full.dice);
    expect(compact.total).toBe(full.total);
    expect(compact.baseRoll.type).toBe('dice-roll-summary');
    expect('dice' in compact.baseRoll).toBe(false);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length / 2);
  });

  test('inherits engine limits and random algorithm across generic and system rolls', () => {
    const systems = createSystemRoller(createDiceEngine({
      randomAlgorithm: 'xoshiro128ss',
      limits: { maxInitialDice: 5 },
    }));

    expect(systems.rollDaggerheart(undefined, { detail: 'compact', seed: 1 })
      .baseRoll.replay.algorithm).toBe('xoshiro128ss');
    expect(() => systems.rollFateDice({ dice: 6 }, { detail: 'compact', seed: 1 }))
      .toThrow(expect.objectContaining({ code: 'TOO_MANY_INITIAL_DICE' }));
    expect(() => systems.rollMixedDice('3d6; fate(3)', { detail: 'compact', seed: 1 }))
      .toThrow(expect.objectContaining({ code: 'TOO_MANY_INITIAL_DICE' }));
  });

  test('keeps generic mixed items full while compacting system base rolls', () => {
    const systems = createSystemRoller(createDiceEngine());
    const result = systems.rollMixedDice('2d6; fate(4); dh()', {
      detail: 'compact',
      seed: 'compact-mixed',
    });

    expect(result.rolls[0]?.kind).toBe('generic');
    if (result.rolls[0]?.kind === 'generic') {
      expect(result.rolls[0].result.type).toBe('dice-roll');
    }
    for (const item of result.rolls.slice(1)) {
      if (item.kind !== 'generic') {
        expect(item.result.baseRoll.type).toBe('dice-roll-summary');
      }
    }
  });

  test('binds every system adapter and preserves the full default', () => {
    const systems = createSystemRoller(createDiceEngine());

    expect(systems.rollAssimilation(
      { d6: 1, keep: 1 },
      { detail: 'compact', seed: 'bound-assimilation' },
    ).baseRoll.type).toBe('dice-roll-summary');
    expect(systems.rollVampireV5(
      { pool: 2, hunger: 1 },
      { detail: 'compact', seed: 'bound-vampire' },
    ).baseRoll.type).toBe('dice-roll-summary');
    expect(systems.rollDaggerheart(undefined, { seed: 'bound-daggerheart' }).baseRoll.type)
      .toBe('dice-roll');
    expect(systems.rollFateDice(undefined, { seed: 'bound-fate' }).baseRoll.type)
      .toBe('dice-roll');
    expect(systems.rollMixedDice('1d6', { seed: 'bound-mixed' }).rolls[0]?.kind)
      .toBe('generic');
  });
});
