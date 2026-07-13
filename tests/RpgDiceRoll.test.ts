import { afterEach, describe, expect, test, vi } from 'vitest';
import { StandardDice } from '../src/dice/index.js';
import * as DiceCore from '../src/index.ts';
import {
  cleanRpgDiceNotation,
  countRpgDiceInNotation,
  extractRpgDiceComment,
  extractRpgDiceGroups,
  inspectRpgDiceNotation,
  normalizeRpgDiceNotation,
  parseRpgDiceInput,
  RpgDiceRollError,
  rollRpgDice,
  verifyRpgDiceNotation,
} from '../src/RpgDiceRoll.ts';

describe('RPG dice facade', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('input normalization', () => {
    test('normalizes Kraken aliases without message formatting concerns', () => {
      expect(normalizeRpgDiceNotation(' d + 2d + f + 2f + df + 2d6ei6 + 4d6km + 4d6kh + 4d6k '))
        .toBe('d20+2d20+4dF+2dF+dF+2d6!>=6+4d6kl1+4d6kh1+4d6k1');
    });

    test('normalizes each supported friendly alias explicitly', () => {
      expect(normalizeRpgDiceNotation('d')).toBe('d20');
      expect(normalizeRpgDiceNotation('2d')).toBe('2d20');
      expect(normalizeRpgDiceNotation('f')).toBe('4dF');
      expect(normalizeRpgDiceNotation('2f')).toBe('2dF');
      expect(normalizeRpgDiceNotation('df')).toBe('dF');
      expect(normalizeRpgDiceNotation('1d6ei6')).toBe('1d6!>=6');
      expect(normalizeRpgDiceNotation('4d6km')).toBe('4d6kl1');
      expect(normalizeRpgDiceNotation('4d6kl')).toBe('4d6kl1');
      expect(normalizeRpgDiceNotation('4d6kh')).toBe('4d6kh1');
      expect(normalizeRpgDiceNotation('4d6k')).toBe('4d6k1');
      expect(normalizeRpgDiceNotation('1d20+-2--1++3')).toBe('1d20-2+1+3');
    });

    test('does not corrupt native math functions while normalizing aliases', () => {
      expect(normalizeRpgDiceNotation('floor(1d6/2)+ceil(1d6/2)+round(1d6/2)+min(1d6,2)+max(1d6,2)'))
        .toBe('floor(1d6/2)+ceil(1d6/2)+round(1d6/2)+min(1d6,2)+max(1d6,2)');
    });

    test('does not corrupt target failure compare points while normalizing aliases', () => {
      expect(normalizeRpgDiceNotation('5d10>=8f=1')).toBe('5d10>=8f=1');
    });

    test('extracts comments separately from cleaned notation', () => {
      const input = '2d6 + 3 // ataque furtivo';

      expect(extractRpgDiceComment(input)).toBe('ataque furtivo');
      expect(cleanRpgDiceNotation(input)).toBe('2d6+3');
      expect(parseRpgDiceInput(input)).toMatchObject({
        comment: 'ataque furtivo',
        cleanedNotation: '2d6+3',
        notation: '2d6+3',
        normalizedNotation: '2d6+3',
      });
    });

    test('reports dice groups and static dice count', () => {
      expect(extractRpgDiceGroups('2d6+1d%+4dF')).toEqual([
        {
          index: 0,
          notation: '2d6',
          qty: 2,
          sides: 6,
        },
        {
          index: 1,
          notation: '1d%',
          qty: 1,
          sides: 100,
        },
        {
          index: 2,
          notation: '4dF',
          qty: 4,
          sides: 'F',
        },
      ]);
      expect(countRpgDiceInNotation('2d6+1d%+4dF')).toBe(7);
    });
  });

  describe('rolling', () => {
    test('rolls multi-roll notation as structured plain data', () => {
      vi.spyOn(StandardDice.prototype, 'rollOnce')
        .mockImplementationOnce(() => 3)
        .mockImplementationOnce(() => 4)
        .mockImplementationOnce(() => 5);

      const result = rollRpgDice('3#1d6 // vantagem');

      expect(result).toMatchObject({
        comment: 'vantagem',
        isMultiRoll: true,
        notation: '1d6',
        normalizedNotation: '3#1d6',
        rollCount: 3,
        total: 12,
        type: 'rpg-dice-roll',
      });
      expect(result.dice).toHaveLength(3);
      expect(result.dice.map((die) => die.rollIndex)).toEqual([1, 2, 3]);
      expect(result.dice.map((die) => die.index)).toEqual([1, 2, 3]);
      expect(result.output).toBe([
        '1. 1d6: [3] = 3',
        '2. 1d6: [4] = 4',
        '3. 1d6: [5] = 5',
        'Total: 12',
      ].join('\n'));
      expect(result.output).not.toContain(String.fromCharCode(27));
      expect(result.output).not.toMatch(/```|<@|discord/i);
      expect(result.rolls.map((roll) => roll.dice[0].group?.sides)).toEqual([6, 6, 6]);
    });

    test('rolls grouped formulas with # as independent entries', () => {
      vi.spyOn(StandardDice.prototype, 'rollOnce')
        .mockImplementationOnce(() => 2)
        .mockImplementationOnce(() => 3)
        .mockImplementationOnce(() => 4)
        .mockImplementationOnce(() => 5);

      const result = rollRpgDice('2#2d6+3');

      expect(result).toMatchObject({
        isMultiRoll: true,
        notation: '2d6+3',
        normalizedNotation: '2#2d6+3',
        rollCount: 2,
        total: 20,
      });
      expect(result.rolls.map((roll) => roll.total)).toEqual([8, 12]);
      expect(result.dice.map((die) => die.rollIndex)).toEqual([1, 1, 2, 2]);
      expect(result.output).toBe([
        '1. 2d6+3: [2, 3]+3 = 8',
        '2. 2d6+3: [4, 5]+3 = 12',
        'Total: 20',
      ].join('\n'));
    });

    test('keeps floor and ceil as normal dice notation instead of facade options', () => {
      vi.spyOn(StandardDice.prototype, 'rollOnce')
        .mockImplementationOnce(() => 5)
        .mockImplementationOnce(() => 5);

      const ceilResult = rollRpgDice('ceil(1d6/2)');
      const floorResult = rollRpgDice('floor(1d6/2)');

      expect(ceilResult.notation).toBe('ceil(1d6/2)');
      expect(ceilResult.total).toBe(3);
      expect(ceilResult.output).toBe('ceil(1d6/2): ceil([5]/2) = 3');
      expect(floorResult.notation).toBe('floor(1d6/2)');
      expect(floorResult.total).toBe(2);
      expect(floorResult.output).toBe('floor(1d6/2): floor([5]/2) = 2');
    });

    test('enforces shared roll and dice limits', () => {
      expect(() => rollRpgDice('')).toThrow('Dice notation is required');
      expect(() => rollRpgDice('101#1d6')).toThrow('Too many rolls');
      expect(() => rollRpgDice('10000d6')).toThrow('Too many dice');
      expect(() => rollRpgDice('3#2d6', { maxRolls: 2 })).toThrow('Too many rolls');
      expect(() => rollRpgDice('3#2d6', { maxDice: 5 })).toThrow('Too many dice');

      try {
        rollRpgDice('101#1d6');
      } catch (error) {
        expect(error).toBeInstanceOf(RpgDiceRollError);
        expect(error).toMatchObject({
          code: 'TOO_MANY_ROLLS',
          limit: 100,
          message: 'Too many rolls',
          notation: '1d6',
          normalizedNotation: '101#1d6',
        });
      }
    });

    test('rejects explosive notation whose worst case exceeds the dice budget before rolling', () => {
      const rollSpy = vi.spyOn(StandardDice.prototype, 'rollOnce');

      expect(() => rollRpgDice('1d6!', { maxDice: 1000 })).toThrow('Too many dice');
      expect(rollSpy).not.toHaveBeenCalled();
    });

    test('rejects reroll and unique execution cost before rolling', () => {
      const rollSpy = vi.spyOn(StandardDice.prototype, 'rollOnce');

      expect(() => rollRpgDice('1d6r=1', { maxDice: 1000 })).toThrow('Roll execution limit exceeded');
      expect(() => rollRpgDice('2d6u', { maxDice: 1000 })).toThrow('Roll execution limit exceeded');
      expect(rollSpy).not.toHaveBeenCalled();
    });

    test('allows common reroll expressions with the default execution budget', () => {
      const inspection = inspectRpgDiceNotation('6d12r<3+6d12r<3');
      const result = rollRpgDice('6d12r<3+6d12r<3', { seed: 'reroll-budget-default' });

      expect(inspection).toMatchObject({
        isValid: true,
        cost: expect.objectContaining({
          totalWorstCaseRollAttempts: 12012,
        }),
      });
      expect(result).toMatchObject({
        notation: '6d12r<3+6d12r<3',
        normalizedNotation: '6d12r<3+6d12r<3',
        rollCount: 1,
      });
      expect(result.dice).toHaveLength(12);
    });

    test('validates notation through the pure facade without rolling', () => {
      const rollSpy = vi.spyOn(StandardDice.prototype, 'rollOnce');

      expect(verifyRpgDiceNotation('1d20')).toBe(true);
      expect(verifyRpgDiceNotation('1d')).toBe(true);
      expect(verifyRpgDiceNotation('abc')).toBe(false);
      expect(rollSpy).not.toHaveBeenCalled();
    });

    test('inspects notation without rolling and returns structured errors', () => {
      const rollSpy = vi.spyOn(StandardDice.prototype, 'rollOnce');
      const valid = inspectRpgDiceNotation('2#1d6!');
      const invalid = inspectRpgDiceNotation('abc');

      expect(valid).toMatchObject({
        isValid: true,
        notation: '1d6!',
        rollCount: 2,
        cost: {
          staticDiceCount: 1,
          totalStaticDice: 2,
          worstCaseDiceCount: 1001,
          totalWorstCaseDice: 2002,
        },
      });
      expect(invalid).toMatchObject({
        isValid: false,
        error: expect.objectContaining({
          code: 'INVALID_NOTATION',
          message: 'Invalid notation',
        }),
      });
      expect(rollSpy).not.toHaveBeenCalled();
    });

    test('supports deterministic replay with a seed', () => {
      const first = rollRpgDice('2#2d6', { seed: 'combat-42' });
      const second = rollRpgDice('2#2d6', { seed: 'combat-42' });
      const third = rollRpgDice('2#2d6', { seed: 'combat-43' });

      expect(first.dice.map((die) => die.value)).toEqual(second.dice.map((die) => die.value));
      expect(first.total).toBe(second.total);
      expect(first.dice.map((die) => die.value)).not.toEqual(third.dice.map((die) => die.value));
    });

    test('exposes stable UI and 3D dice metadata on each die result', () => {
      vi.spyOn(StandardDice.prototype, 'rollOnce')
        .mockImplementationOnce(() => 1)
        .mockImplementationOnce(() => 6);

      const result = rollRpgDice('2d6cs=6cf=1');

      expect(result.dice).toEqual([
        expect.objectContaining({
          id: 'roll-1-die-1',
          sides: 6,
          groupNotation: '2d6',
          wasCriticalFailure: true,
          wasCriticalSuccess: false,
          wasTargetFailure: false,
          wasTargetNeutral: false,
          wasTargetSuccess: false,
          wasDropped: false,
          wasExploded: false,
          wasRerolled: false,
          groupPath: expect.any(Array),
          groupRollIndex: 0,
          modifierReasons: expect.any(Array),
        }),
        expect.objectContaining({
          id: 'roll-1-die-2',
          sides: 6,
          groupNotation: '2d6',
          wasCriticalFailure: false,
          wasCriticalSuccess: true,
          wasTargetFailure: false,
          wasTargetNeutral: false,
          wasTargetSuccess: false,
          wasDropped: false,
          wasExploded: false,
          wasRerolled: false,
          groupPath: expect.any(Array),
          groupRollIndex: 0,
          modifierReasons: expect.any(Array),
        }),
      ]);
      expect(result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'roll',
          dieIndex: 1,
          rollIndex: 1,
        }),
        expect.objectContaining({
          type: 'critical-failure',
          reason: 'critical-failure',
        }),
        expect.objectContaining({
          type: 'critical-success',
          reason: 'critical-success',
        }),
      ]));
    });

    test('summarizes target dice pools for success-based systems', () => {
      vi.spyOn(StandardDice.prototype, 'rollOnce')
        .mockImplementationOnce(() => 1)
        .mockImplementationOnce(() => 8)
        .mockImplementationOnce(() => 7)
        .mockImplementationOnce(() => 10)
        .mockImplementationOnce(() => 1);

      const result = rollRpgDice('5d10>=8f=1');

      expect(result.pool).toEqual({
        failures: 2,
        hasTarget: true,
        netSuccesses: 0,
        successes: 2,
      });
      expect(result.rolls[0].pool).toEqual(result.pool);
      expect(result.dice.map((die) => ({
        value: die.value,
        success: die.wasTargetSuccess,
        failure: die.wasTargetFailure,
        neutral: die.wasTargetNeutral,
      }))).toEqual([
        {
          failure: true,
          neutral: false,
          success: false,
          value: 1,
        },
        {
          failure: false,
          neutral: false,
          success: true,
          value: 8,
        },
        {
          failure: false,
          neutral: true,
          success: false,
          value: 7,
        },
        {
          failure: false,
          neutral: false,
          success: true,
          value: 10,
        },
        {
          failure: true,
          neutral: false,
          success: false,
          value: 1,
        },
      ]);
    });

    test('aggregates target pool summaries across multi-roll notation', () => {
      vi.spyOn(StandardDice.prototype, 'rollOnce')
        .mockImplementationOnce(() => 6)
        .mockImplementationOnce(() => 4)
        .mockImplementationOnce(() => 6)
        .mockImplementationOnce(() => 1);

      const result = rollRpgDice('2#2d6=6');

      expect(result.pool).toEqual({
        failures: 0,
        hasTarget: true,
        netSuccesses: 2,
        successes: 2,
      });
      expect(result.rolls.map((roll) => roll.pool)).toEqual([
        {
          failures: 0,
          hasTarget: true,
          netSuccesses: 1,
          successes: 1,
        },
        {
          failures: 0,
          hasTarget: true,
          netSuccesses: 1,
          successes: 1,
        },
      ]);
    });

    test('returns an empty pool summary for non-target notation', () => {
      vi.spyOn(StandardDice.prototype, 'rollOnce')
        .mockImplementationOnce(() => 3)
        .mockImplementationOnce(() => 4);

      const result = rollRpgDice('2d6');

      expect(result.pool).toEqual({
        failures: 0,
        hasTarget: false,
        netSuccesses: 0,
        successes: 0,
      });
      expect(result.dice.every((die) => !die.wasTargetNeutral)).toBe(true);
    });
  });

  describe('public package entry', () => {
    test('exports only the ERPG dice V3 facade contract', () => {
      expect(Object.keys(DiceCore).sort()).toEqual([
        'DEFAULT_DICE_LIMITS',
        'DiceRollError',
        'compileRpgDice',
        'createDiceEngine',
        'inspectRpgDiceNotation',
        'isDiceRollError',
        'isDiceRollErrorData',
        'normalizeRpgDiceNotation',
        'rollRpgDice',
        'rollRpgDiceSummary',
        'verifyRpgDiceNotation',
      ].sort());
      expect(DiceCore.DiceRoll).toBeUndefined();
      expect(DiceCore.DiceRoller).toBeUndefined();
      expect(DiceCore.Parser).toBeUndefined();
    });
  });
});
