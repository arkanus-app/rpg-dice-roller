import { describe, expect, test } from 'vitest';
import { rollMixedDice, type MixedRollOptions } from './mixed.js';

describe('mixed notation boundaries', () => {
  test.each(['d6)', 'd6}', 'd6]', '(d6', '{d6', 'd6 [comment',
    'fate(1.5)', 'fate(9007199254740992)', 'fate(1,)', 'fate(=1)',
    'fate(dice=1,dice=2)', 'v5(pool=1)', 'v5(hunger=1)',
  ])('rejects %s', (input) => {
    expect(() => rollMixedDice(input, { seed: 'boundary' })).toThrow(expect.objectContaining({ code: 'INVALID_NOTATION' }));
  });

  test('accepts brackets inside a segment and omitted assimilation defaults', () => {
    expect(rollMixedDice('d1 [one; die]; d1', { seed: 'boundary' }).rolls).toHaveLength(2);
    expect(rollMixedDice('assim(d10=1)', { seed: 'boundary' }).notation).toBe('assim(d6=0,d10=1,d12=0,keep=1)');
  });

  test('rejects overlong input before parsing', () => {
    expect(() => rollMixedDice('d6;d6', { limits: { maxInputLength: 4 } })).toThrow(expect.objectContaining({ code: 'INPUT_TOO_LONG' }));
  });

  test('rejects blank notation with its original input', () => {
    expect(() => rollMixedDice('   ')).toThrow(expect.objectContaining({ code: 'DICE_NOTATION_REQUIRED', input: '   ' }));
  });

  test.each([null, undefined, 42, {}, []])('rejects non-string notation %j', (input) => {
    expect(() => rollMixedDice(input as string)).toThrow(expect.objectContaining({ code: 'DICE_NOTATION_REQUIRED', input: '' }));
  });

  test('checks both accumulated output and separator overhead', () => {
    for (const notation of ['fate(1)', 'd1;d1']) {
      const result = rollMixedDice(notation, { seed: 'boundary' });
      expect(() => rollMixedDice(notation, { seed: 'boundary', limits: { maxOutputLength: result.output.length - 1 } })).toThrow(expect.objectContaining({ code: 'OUTPUT_LIMIT_EXCEEDED' }));
    }
  });

  test('rejects malformed replay containers, entries and sparse arrays', () => {
    const result = rollMixedDice('d6', { seed: 'boundary' });
    const entry = result.replay.rolls[0];
    const hostile = new Proxy({}, { ownKeys() { throw new Error('private'); } });
    const replays = [null, [], hostile,
      ...[null, [], hostile, { ...entry, kind: 'fate' }, { ...entry, notation: 'd8' }, { ...entry, extra: true }].map((value) => ({ ...result.replay, rolls: [value] })),
      { ...result.replay, rolls: new Array<unknown>(1) },
    ];
    for (const replay of replays) {
      expect(() => rollMixedDice('d6', { replay } as MixedRollOptions)).toThrow(expect.objectContaining({ code: 'INVALID_REPLAY' }));
    }
    expect(rollMixedDice('d6', { replay: result.replay, detail: 'compact' }).dice).toHaveLength(1);
  });

  test('retains physical reroll faces and namespaces explosion parents', () => {
    const reroll = rollMixedDice('d1ro=1', { seed: 'boundary' });
    expect(reroll.dice[0]).toMatchObject({ physicalValue: 1 });
    const explosion = rollMixedDice('d1!1', { seed: 'boundary' });
    expect(explosion.dice).toHaveLength(2);
    expect(explosion.dice[1]).toMatchObject({ parentDieId: explosion.dice[0]?.id });
  });
});
