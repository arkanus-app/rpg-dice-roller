import { describe, expect, test } from 'vitest';
import { rollMixedDice, type MixedRollOptions } from './mixed.js';

const unsafeRoll = rollMixedDice as (
  input: unknown,
  options?: MixedRollOptions,
) => unknown;

describe('mixed dice notation', () => {
  test('rolls generic, Vampire V5, Fate, and Assimilation dice together', () => {
    const result = rollMixedDice(
      '2d6+1; v5(pool=5,hunger=2,difficulty=3); fate(4); '
        + 'assim(d6=1,d10=1,d12=1,keep=2)',
      { seed: 'mixed-all-systems' },
    );

    expect(result).toMatchObject({
      type: 'mixed-roll',
      schemaVersion: 1,
      notation: '2d6+1; v5(pool=5,hunger=2,difficulty=3); '
        + 'fate(dice=4); assim(d6=1,d10=1,d12=1,keep=2)',
    });
    expect(result.rolls.map((roll) => roll.kind)).toEqual([
      'generic',
      'vampire-v5',
      'fate',
      'assimilation',
    ]);
    expect(result.dice).toHaveLength(14);
    expect(new Set(result.dice.map((die) => die.id)).size).toBe(14);
    expect(result.stats.initialDice).toBe(14);

    const profileIds = result.dice.flatMap((die) => (
      'profileId' in die ? [die.profileId] : []
    ));
    expect(profileIds).toEqual([
      'vampire-v5-normal-d10',
      'vampire-v5-normal-d10',
      'vampire-v5-normal-d10',
      'vampire-v5-hunger-d10',
      'vampire-v5-hunger-d10',
      'fate-df',
      'fate-df',
      'fate-df',
      'fate-df',
      'assimilation-d6',
      'assimilation-d10',
      'assimilation-d12',
    ]);
    expect(result.output).toContain('successes');
    expect(result.output).toContain('fate(dice=4)');
    expect(result.output).toContain('keep 2');
  });

  test('supports concise positional calls and Portuguese aliases', () => {
    const result = rollMixedDice(
      'vampiro(5,2,3); fatedice(); AS(1,1,1,2)',
      { seed: 'mixed-aliases' },
    );

    expect(result.notation).toBe(
      'v5(pool=5,hunger=2,difficulty=3); '
        + 'fate(dice=4); assim(d6=1,d10=1,d12=1,keep=2)',
    );
    expect(result.rolls.map((roll) => roll.kind)).toEqual([
      'vampire-v5',
      'fate',
      'assimilation',
    ]);

    const named = rollMixedDice(
      'v5(pool=4,fome=1,dificuldade=2); '
        + 'fate(dados=3); assim(d6=2,manter=1)',
      { seed: 'mixed-portuguese-args' },
    );
    expect(named.notation).toBe(
      'v5(pool=4,hunger=1,difficulty=2); '
        + 'fate(dice=3); assim(d6=2,d10=0,d12=0,keep=1)',
    );

    const shortNamed = rollMixedDice('as(d6=2,d10=1,d12=1,keep=2)', {
      seed: 'mixed-assimilation-short-named',
    });
    expect(shortNamed.notation).toBe(
      'assim(d6=2,d10=1,d12=1,keep=2)',
    );
    expect(shortNamed.rolls[0]?.kind).toBe('assimilation');
  });

  test('keeps ordinary functions and grouped generic notation intact', () => {
    const result = rollMixedDice(
      'ceil(1d6/2); {1d6,1d8}kh1; max(2,3)',
      { seed: 'mixed-generic' },
    );

    expect(result.rolls.map((roll) => roll.kind)).toEqual([
      'generic',
      'generic',
      'generic',
    ]);
    expect(result.dice).toHaveLength(3);

    const commented = rollMixedDice('1d6; fate(1) // ataque misto', {
      seed: 'mixed-comment',
    });
    expect(commented.rolls.map((roll) => roll.kind)).toEqual(['generic', 'fate']);
  });

  test('preserves the physical face separately from semantic transforms', () => {
    let found = false;
    for (let index = 0; index < 20; index += 1) {
      const result = rollMixedDice('1d6min6; fate(1)', {
        seed: `mixed-physical-${index}`,
      });
      const generic = result.dice.find((die) => !('profileId' in die));
      if (generic !== undefined && generic.rawValue !== generic.value) {
        expect(generic.value).toBe(6);
        expect(generic.physicalValue).toBe(generic.rawValue);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test('is deterministic and replays every sub-roll without correlated seeds', () => {
    const notation = '1d6; fate(1); v5(2,1)';
    const first = rollMixedDice(notation, {
      seed: 'mixed-replay',
      randomAlgorithm: 'xoshiro128ss',
    });
    const second = rollMixedDice(notation, {
      seed: 'mixed-replay',
      randomAlgorithm: 'xoshiro128ss',
    });
    const replayed = rollMixedDice(notation, { replay: first.replay });

    expect(second).toEqual(first);
    expect(replayed).toEqual(first);
    expect(new Set(first.replay.rolls.map((roll) => roll.replay.seedMaterial)).size)
      .toBe(first.rolls.length);
  });

  test('rejects malformed calls, empty segments, and aggregate limit bypasses', () => {
    for (const input of [
      '',
      '1d6;',
      ';1d6',
      'v5(5)',
      'v5(pool=5,2)',
      'v5(pool=5,hunger=1,fome=2)',
      'fate(1,2)',
      'assim()',
      'assim(d20=1)',
    ]) {
      expect(() => unsafeRoll(input)).toThrow();
    }

    expect(() => rollMixedDice('3d6;3d6', {
      limits: { maxInitialDice: 5 },
    })).toThrow(expect.objectContaining({ code: 'TOO_MANY_INITIAL_DICE' }));
    expect(() => rollMixedDice('2#1d6;2#1d6', {
      limits: { maxRolls: 3 },
    })).toThrow(expect.objectContaining({ code: 'TOO_MANY_ROLLS' }));
  });

  test('rejects replay descriptors from another mixed notation', () => {
    const first = rollMixedDice('1d6; fate(1)', { seed: 'mixed-mismatch' });
    expect(() => rollMixedDice('1d8; fate(1)', { replay: first.replay }))
      .toThrow(expect.objectContaining({ code: 'INVALID_REPLAY' }));
  });
});
