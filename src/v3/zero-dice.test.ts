import { describe, expect, test } from 'vitest';
import {
  inspectRpgDiceNotation,
  rollRpgDice,
  rollRpgDiceDetails,
  rollRpgDiceSummary,
  verifyRpgDiceNotation,
} from './engine.js';
import { rollMixedDice } from './systems/mixed.js';

describe('zero-sided dice', () => {
  test.each(['d0', 'D0', '1d0', '3D0', '2d(2-2)'])(
    'accepts %s and preserves dice with zero-valued faces',
    (input) => {
      expect(verifyRpgDiceNotation(input)).toBe(true);
      expect(inspectRpgDiceNotation(input).isValid).toBe(true);

      for (const randomAlgorithm of ['mt19937', 'xoshiro128ss'] as const) {
        const result = rollRpgDice(input, { seed: 'zero-dice', randomAlgorithm });
        expect(result.total).toBe(0);
        expect(result.dice.length).toBeGreaterThan(0);
        for (const die of result.dice) {
          expect(die).toMatchObject({
            sides: 0, rawValue: 0, value: 0, contribution: 0, included: true,
          });
        }
        expect(rollRpgDice(input, { replay: result.replay })).toEqual(result);
      }
    },
  );

  test('adds zero to a normal roll without replacing its dice or total', () => {
    const options = { seed: 'zero-addition' };
    const regular = rollRpgDice('12d20', options);
    const result = rollRpgDice('12d20+1d0', options);

    expect(result.total).toBe(regular.total);
    expect(result.dice).toHaveLength(13);
    expect(result.dice.slice(0, 12).map((die) => die.value))
      .toEqual(regular.dice.map((die) => die.value));
    expect(result.dice[12]).toMatchObject({ sides: 0, rawValue: 0, value: 0 });
    expect(result.output).toContain('1d0');
  });

  test.each([
    ['5+1d0', 5],
    ['5-1d0', 5],
    ['1d0-5', -5],
    ['5*1d0', 0],
    ['1d0/5', 0],
    ['1d0%5', 0],
    ['1d0^2', 0],
    ['2^1d0', 1],
    ['(1d0+2)*3', 6],
    ['max(1d0,5)', 5],
    ['{2d0,1d1}kh1', 1],
    ['3#2d0+1', 3],
    ['0d0', 0],
  ])('evaluates %s with normal arithmetic in all result modes', (input, total) => {
    const options = { seed: 'zero-arithmetic' };
    const result = rollRpgDice(input, options);

    expect(result.total).toBe(total);
    expect(rollRpgDiceDetails(input, options).total).toBe(total);
    expect(rollRpgDiceSummary(input, options).total).toBe(total);
  });

  test('supports the mixed roller used by the app', () => {
    const result = rollMixedDice('12d20+1d0', { seed: 'zero-mixed', detail: 'compact' });

    expect(result.rolls[0]?.kind).toBe('generic');
    expect(result.dice).toHaveLength(13);
    expect(result.dice[12]).toMatchObject({ sides: 0, rawValue: 0, value: 0 });
  });

  test.each(['d0u', '2d0kh1', 'd0ro', 'd0!2'])(
    'supports terminating modifiers in %s',
    (input) => {
      expect(rollRpgDice(input, { seed: 'zero-modifiers' }).total).toBe(0);
    },
  );

  test.each([
    ['d0!', 'NON_TERMINATING_MODIFIER'],
    ['d0r', 'NON_TERMINATING_MODIFIER'],
    ['2d0u', 'IMPOSSIBLE_UNIQUE'],
    ['5/d0', 'NON_FINITE_RESULT'],
    ['(1-1)d0', 'INVALID_NOTATION'],
    ['1d(-1)', 'INVALID_NOTATION'],
    ['1d(0.5)', 'INVALID_NOTATION'],
  ])('preserves the error for %s', (input, code) => {
    expect(() => rollRpgDice(input, { seed: 'zero-invalid' }))
      .toThrow(expect.objectContaining({ code }));
  });
});
