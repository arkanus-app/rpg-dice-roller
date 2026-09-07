import { describe, expect, test } from 'vitest';
import {
  inspectRpgDiceNotation,
  rollRpgDice,
  rollRpgDiceDetails,
  rollRpgDiceSummary,
  verifyRpgDiceNotation,
} from './engine.js';
import { rollMixedDice } from './systems/mixed.js';

describe('zero pool adjustments', () => {
  test.each([
    ['2d20pool(0)', '2d20'],
    ['2d20pool(+0)', '2d20'],
    ['2d20pool(-0)', '2d20'],
    ['2d20+pool(0)', '2d20'],
    ['2d20-pool(0)', '2d20'],
    ['2d20 PULL(0)', '2d20'],
    ['2d20+5-pool(0)', '2d20+5'],
    ['2#2d20pool(0)+5', '2#2d20+5'],
    ['2d20pool(0)kh1', '2d20kh1'],
    ['2d20pool(0)adv', '2d20adv'],
    ['2d20dispool(0)', '2d20dis'],
    ['2d20pool(-3)pool(0)', '2d20pool(-3)'],
    ['2d20pool(0)pool(+1)pool(-0)', '2d20pool(+1)'],
    ['1d20pool(0)+1d6pool(-0)', '1d20+1d6'],
    ['1d20+1d6+3-pool(0)', '1d20+1d6+3'],
    ['0d20pool(0)', '0d20'],
    ['5pool(0)', '5'],
  ])('rolls %s without changing dice, totals or random consumption', (input, baseline) => {
    const options = { seed: 'zero-pool' };
    const expected = rollRpgDice(baseline, options);

    expect(verifyRpgDiceNotation(input)).toBe(true);
    expect(inspectRpgDiceNotation(input).isValid).toBe(true);
    const result = rollRpgDice(input, options);
    expect(result.total).toBe(expected.total);
    expect(result.dice.map(({ value, sides, included, contribution }) => (
      { value, sides, included, contribution }
    ))).toEqual(expected.dice.map(({ value, sides, included, contribution }) => (
      { value, sides, included, contribution }
    )));
    expect(result.stats).toEqual(expected.stats);
    expect(rollRpgDice(input, { replay: result.replay })).toEqual(result);
    expect(rollRpgDiceDetails(input, options).total).toBe(expected.total);
    expect(rollRpgDiceSummary(input, options).total).toBe(expected.total);
  });

  test('supports the compact mixed roller used by the app', () => {
    const result = rollMixedDice('2d1pool(0)+3; 1d1-pool(0)', { detail: 'compact' });
    expect(result.rolls.map((roll) => roll.kind === 'generic' ? roll.result.total : null))
      .toEqual([5, 1]);
    expect(result.dice).toHaveLength(3);
  });
});
