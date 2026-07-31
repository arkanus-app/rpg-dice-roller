import { describe, expect, test } from 'vitest';
import type { RollOptions } from '../types.js';
import {
  FATE_DF_PROFILE,
  rollFateDice,
  type FateRollInput,
} from './fate.js';

const unsafeRoll = rollFateDice as (
  input?: unknown,
  options?: RollOptions,
) => unknown;

describe('Fate system rolls', () => {
  test('maps every physical d6 face to the official Fate symbols', () => {
    const faces = new Map<number, {
      readonly faceKey: string;
      readonly symbols: readonly string[];
      readonly fateValue: number;
    }>();

    for (let index = 0; index < 40; index += 1) {
      const roll = rollFateDice({ dice: 1 }, { seed: `fate-face-${index}` });
      const die = roll.dice[0];
      expect(die).toBeDefined();
      if (die === undefined) {
        throw new Error('Expected one Fate die');
      }

      faces.set(die.rawValue, {
        faceKey: die.faceKey,
        symbols: [...die.symbols],
        fateValue: die.fateValue,
      });
      expect(die).toMatchObject({
        profileId: FATE_DF_PROFILE,
        dieKind: 'fate',
        sides: 6,
        value: die.rawValue,
      });
      expect(die.id).toBe(`${FATE_DF_PROFILE}:${die.sourceDieId}`);
      expect(roll.baseRoll.dice[0]?.id).toBe(die.sourceDieId);
    }

    expect(Object.fromEntries([...faces].sort(([left], [right]) => left - right)))
      .toEqual({
        1: { faceKey: 'minus', symbols: ['minus'], fateValue: -1 },
        2: { faceKey: 'minus', symbols: ['minus'], fateValue: -1 },
        3: { faceKey: 'blank', symbols: [], fateValue: 0 },
        4: { faceKey: 'blank', symbols: [], fateValue: 0 },
        5: { faceKey: 'plus', symbols: ['plus'], fateValue: 1 },
        6: { faceKey: 'plus', symbols: ['plus'], fateValue: 1 },
      });
  });

  test('defaults to four dice and totals semantic values', () => {
    const roll = rollFateDice(undefined, { seed: 'fate-default' });

    expect(roll).toMatchObject({
      type: 'fate-roll',
      schemaVersion: 1,
      system: 'fate',
      rulesVersion: 1,
      diceCount: 4,
    });
    expect(roll.baseRoll.notation).toBe('4d6');
    expect(roll.dice).toHaveLength(4);
    expect(roll.total).toBe(
      roll.dice.reduce((sum, die) => sum + die.fateValue, 0),
    );
    expect(roll.total).toBeGreaterThanOrEqual(-4);
    expect(roll.total).toBeLessThanOrEqual(4);

    expect(rollFateDice({}, { seed: 'fate-empty' }).diceCount).toBe(4);
    expect(rollFateDice({ dice: 2 }, { seed: 'fate-two' }).baseRoll.notation)
      .toBe('2d6');
  });

  test('replays physical faces and their semantic projection', () => {
    const input: FateRollInput = { dice: 7 };
    const first = rollFateDice(input, {
      seed: 'fate-replay',
      randomAlgorithm: 'xoshiro128ss',
    });
    const replayed = rollFateDice(input, { replay: first.baseRoll.replay });

    expect(replayed).toEqual(first);
  });

  test('validates inputs and delegates dice limits to the V3 engine', () => {
    for (const input of [
      null,
      [],
      { dice: 0 },
      { dice: -1 },
      { dice: 1.5 },
      { dice: '4' },
      { dice: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(() => unsafeRoll(input))
        .toThrow(expect.objectContaining({ code: 'INVALID_SYSTEM_INPUT' }));
    }

    expect(() => rollFateDice(
      { dice: 2 },
      { limits: { maxInitialDice: 1 } },
    )).toThrow(expect.objectContaining({ code: 'TOO_MANY_INITIAL_DICE' }));
  });
});
