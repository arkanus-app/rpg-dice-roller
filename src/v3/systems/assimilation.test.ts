import { describe, expect, test } from 'vitest';
import type { RollOptions } from '../types.js';
import {
  ASSIMILATION_D6_PROFILE,
  ASSIMILATION_D10_PROFILE,
  ASSIMILATION_D12_PROFILE,
  evaluateAssimilationSelection,
  rollAssimilation,
  type AssimilationRollInput,
  type AssimilationRollResult,
} from './assimilation.js';

const unsafeRoll = rollAssimilation as (
  input: unknown,
  options?: RollOptions,
) => unknown;
const unsafeEvaluate = evaluateAssimilationSelection as (
  roll: AssimilationRollResult,
  selectedIds: unknown,
) => unknown;

const expectedFaces: Readonly<Record<number, {
  readonly faceKey: string;
  readonly symbols: readonly string[];
}>> = {
  1: { faceKey: 'blank', symbols: [] },
  2: { faceKey: 'blank', symbols: [] },
  3: { faceKey: 'pressure', symbols: ['pressure'] },
  4: { faceKey: 'pressure', symbols: ['pressure'] },
  5: { faceKey: 'adaptation-pressure', symbols: ['adaptation', 'pressure'] },
  6: { faceKey: 'success', symbols: ['success'] },
  7: { faceKey: 'double-success', symbols: ['success', 'success'] },
  8: { faceKey: 'success-adaptation', symbols: ['success', 'adaptation'] },
  9: {
    faceKey: 'success-adaptation-pressure',
    symbols: ['success', 'adaptation', 'pressure'],
  },
  10: {
    faceKey: 'double-success-pressure',
    symbols: ['success', 'success', 'pressure'],
  },
  11: {
    faceKey: 'success-double-adaptation-pressure',
    symbols: ['success', 'adaptation', 'adaptation', 'pressure'],
  },
  12: { faceKey: 'double-pressure', symbols: ['pressure', 'pressure'] },
};

describe('Assimilation system rolls', () => {
  test('maps every confirmed d6, d10, and d12 face', () => {
    const seen = new Map<number, Set<number>>([
      [6, new Set()],
      [10, new Set()],
      [12, new Set()],
    ]);

    for (let index = 0; index < 30; index += 1) {
      const roll = rollAssimilation(
        { d6: 1, d10: 1, d12: 1, keep: 3 },
        { seed: `map-${index}` },
      );
      for (const die of roll.dice) {
        seen.get(die.sides)?.add(die.rawValue);
        expect({
          faceKey: die.faceKey,
          symbols: die.symbols,
        }).toEqual(expectedFaces[die.rawValue]);
        expect(die.value).toBe(die.rawValue);
        expect(die.id).toContain(die.sourceDieId);

        if (die.sides === 6) {
          expect(die).toMatchObject({
            profileId: ASSIMILATION_D6_PROFILE,
            dieKind: 'd6',
          });
        } else if (die.sides === 10) {
          expect(die).toMatchObject({
            profileId: ASSIMILATION_D10_PROFILE,
            dieKind: 'd10',
          });
        } else {
          expect(die).toMatchObject({
            profileId: ASSIMILATION_D12_PROFILE,
            dieKind: 'd12',
          });
        }
      }
    }

    expect([...seen.get(6) ?? []].sort((left, right) => left - right))
      .toEqual([1, 2, 3, 4, 5, 6]);
    expect([...seen.get(10) ?? []].sort((left, right) => left - right))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect([...seen.get(12) ?? []].sort((left, right) => left - right))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test('rolls mixed or single-size pools and never selects automatically', () => {
    const mixed = rollAssimilation(
      { d6: 2, d10: 1, d12: 3, keep: 2 },
      { seed: 'mixed-assimilation' },
    );
    expect(mixed).toMatchObject({
      type: 'assimilation-roll',
      schemaVersion: 1,
      system: 'assimilation',
      rulesVersion: 1,
      d6: 2,
      d10: 1,
      d12: 3,
      totalDice: 6,
      keep: 2,
    });
    expect(mixed.dice.map((die) => die.dieKind))
      .toEqual(['d6', 'd6', 'd10', 'd12', 'd12', 'd12']);
    expect(mixed.baseRoll.notation).toBe('2d6+1d10+3d12');
    expect(mixed).not.toHaveProperty('selectedIds');
    expect(mixed).not.toHaveProperty('success');

    expect(rollAssimilation({ d6: 1 }, { seed: 'only-d6' }).baseRoll.notation).toBe('1d6');
    expect(rollAssimilation({ d10: 1 }, { seed: 'only-d10' }).baseRoll.notation).toBe('1d10');
    expect(rollAssimilation({ d12: 1 }, { seed: 'only-d12' }).baseRoll.notation).toBe('1d12');
    expect(rollAssimilation({ d6: 1 }, { seed: 'default-keep' }).keep).toBe(1);
  });

  test('selects by unique IDs, preserves order, and aggregates repeated symbols', () => {
    const roll = rollAssimilation(
      { d6: 1, d10: 1, d12: 1, keep: 3 },
      { seed: 'map-4' },
    );
    expect(roll.dice.map((die) => [die.dieKind, die.rawValue])).toEqual([
      ['d6', 3],
      ['d10', 8],
      ['d12', 11],
    ]);
    const d10 = roll.dice[1];
    const d12 = roll.dice[2];
    expect(d10).toBeDefined();
    expect(d12).toBeDefined();
    if (d10 === undefined || d12 === undefined) {
      throw new Error('Expected deterministic Assimilation dice');
    }

    const selection = evaluateAssimilationSelection(roll, [d12.id, d10.id]);
    expect(selection).toEqual({
      type: 'assimilation-selection',
      schemaVersion: 1,
      system: 'assimilation',
      selectedIds: [d12.id, d10.id],
      dice: [d12, d10],
      success: 2,
      adaptation: 3,
      pressure: 1,
    });

    expect(evaluateAssimilationSelection(roll, [])).toMatchObject({
      selectedIds: [],
      dice: [],
      success: 0,
      adaptation: 0,
      pressure: 0,
    });
  });

  test('replays every symbolic face without changing the pending choice', () => {
    const input: AssimilationRollInput = { d6: 2, d10: 2, d12: 2, keep: 2 };
    const first = rollAssimilation(input, {
      seed: 'assimilation-replay',
      randomAlgorithm: 'xoshiro128ss',
    });
    const replayed = rollAssimilation(input, { replay: first.baseRoll.replay });

    expect(replayed).toEqual(first);
  });

  test('rejects invalid pools and delegates runtime caps to the V3 engine', () => {
    for (const input of [
      null,
      [],
      {},
      { d6: 0, d10: 0, d12: 0 },
      { d6: -1 },
      { d10: 1.5 },
      { d12: '1' },
      { d6: Number.MAX_SAFE_INTEGER + 1 },
      { d6: Number.MAX_SAFE_INTEGER, d10: Number.MAX_SAFE_INTEGER },
      { d6: 1, keep: 0 },
      { d6: 1, keep: 2 },
      { d6: 2, keep: 1.5 },
    ]) {
      expect(() => unsafeRoll(input))
        .toThrow(expect.objectContaining({ code: 'INVALID_SYSTEM_INPUT' }));
    }

    expect(() => rollAssimilation(
      { d6: 1, d10: 1 },
      { limits: { maxInitialDice: 1 } },
    )).toThrow(expect.objectContaining({ code: 'TOO_MANY_INITIAL_DICE' }));
  });

  test('rejects oversized, duplicate, malformed, and unknown selections', () => {
    const keepOne = rollAssimilation({ d6: 2, keep: 1 }, { seed: 'selection-one' });
    expect(() => evaluateAssimilationSelection(
      keepOne,
      keepOne.dice.map((die) => die.id),
    )).toThrow(expect.objectContaining({ code: 'INVALID_SYSTEM_INPUT' }));

    const keepTwo = rollAssimilation({ d6: 2, keep: 2 }, { seed: 'selection-two' });
    const firstId = keepTwo.dice[0]?.id;
    expect(firstId).toBeDefined();
    if (firstId === undefined) {
      throw new Error('Expected an Assimilation die');
    }
    expect(() => evaluateAssimilationSelection(keepTwo, [firstId, firstId]))
      .toThrow(expect.objectContaining({ code: 'INVALID_SYSTEM_INPUT' }));
    expect(() => evaluateAssimilationSelection(keepTwo, ['missing']))
      .toThrow(expect.objectContaining({ code: 'INVALID_SYSTEM_INPUT' }));
    expect(() => unsafeEvaluate(keepTwo, null))
      .toThrow(expect.objectContaining({ code: 'INVALID_SYSTEM_INPUT' }));
    expect(() => unsafeEvaluate(keepTwo, ['']))
      .toThrow(expect.objectContaining({ code: 'INVALID_SYSTEM_INPUT' }));
    expect(() => unsafeEvaluate(keepTwo, [1]))
      .toThrow(expect.objectContaining({ code: 'INVALID_SYSTEM_INPUT' }));
  });
});
