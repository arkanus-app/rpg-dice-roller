import { describe, expect, test } from 'vitest';
import type { RollOptions } from '../types.js';
import {
  VAMPIRE_V5_HUNGER_D10_PROFILE,
  VAMPIRE_V5_NORMAL_D10_PROFILE,
  rollVampireV5,
  type VampireV5RollInput,
} from './vampire-v5.js';

const unsafeRoll = rollVampireV5 as (
  input: unknown,
  options?: RollOptions,
) => unknown;

describe('Vampire V5 system rolls', () => {
  test('maps every normal and Hunger d10 face to stable semantic profiles', () => {
    const normalFaces = new Map<number, { readonly faceKey: string; readonly symbols: string[] }>();
    const hungerFaces = new Map<number, { readonly faceKey: string; readonly symbols: string[] }>();

    for (let index = 0; index < 40; index += 1) {
      const normal = rollVampireV5(
        { pool: 1, hunger: 0 },
        { seed: `faces-normal-${index}` },
      ).dice[0];
      const hunger = rollVampireV5(
        { pool: 1, hunger: 1 },
        { seed: `faces-hunger-${index}` },
      ).dice[0];
      if (normal !== undefined) {
        normalFaces.set(normal.rawValue, {
          faceKey: normal.faceKey,
          symbols: [...normal.symbols],
        });
        expect(normal).toMatchObject({
          profileId: VAMPIRE_V5_NORMAL_D10_PROFILE,
          dieKind: 'normal',
          sides: 10,
          value: normal.rawValue,
        });
        expect(normal.id).toContain(normal.sourceDieId);
      }
      if (hunger !== undefined) {
        hungerFaces.set(hunger.rawValue, {
          faceKey: hunger.faceKey,
          symbols: [...hunger.symbols],
        });
        expect(hunger).toMatchObject({
          profileId: VAMPIRE_V5_HUNGER_D10_PROFILE,
          dieKind: 'hunger',
          sides: 10,
          value: hunger.rawValue,
        });
        expect(hunger.id).toContain(hunger.sourceDieId);
      }
    }

    expect(Object.fromEntries([...normalFaces].sort(([left], [right]) => left - right)))
      .toEqual({
        1: { faceKey: 'blank', symbols: [] },
        2: { faceKey: 'blank', symbols: [] },
        3: { faceKey: 'blank', symbols: [] },
        4: { faceKey: 'blank', symbols: [] },
        5: { faceKey: 'blank', symbols: [] },
        6: { faceKey: 'success', symbols: ['success'] },
        7: { faceKey: 'success', symbols: ['success'] },
        8: { faceKey: 'success', symbols: ['success'] },
        9: { faceKey: 'success', symbols: ['success'] },
        10: { faceKey: 'critical', symbols: ['success', 'critical'] },
      });
    expect(Object.fromEntries([...hungerFaces].sort(([left], [right]) => left - right)))
      .toEqual({
        1: { faceKey: 'bestial-failure', symbols: ['bestial-failure'] },
        2: { faceKey: 'blank', symbols: [] },
        3: { faceKey: 'blank', symbols: [] },
        4: { faceKey: 'blank', symbols: [] },
        5: { faceKey: 'blank', symbols: [] },
        6: { faceKey: 'success', symbols: ['success'] },
        7: { faceKey: 'success', symbols: ['success'] },
        8: { faceKey: 'success', symbols: ['success'] },
        9: { faceKey: 'success', symbols: ['success'] },
        10: {
          faceKey: 'messy-critical',
          symbols: ['success', 'critical', 'messy-critical'],
        },
      });
  });

  test('replaces pool dice with Hunger dice and leaves outcome pending without difficulty', () => {
    const mixed = rollVampireV5({ pool: 5, hunger: 2 }, { seed: 'mixed' });
    expect(mixed).toMatchObject({
      type: 'vampire-v5-roll',
      schemaVersion: 1,
      system: 'vampire-v5',
      rulesVersion: 1,
      pool: 5,
      hunger: 2,
      difficulty: null,
      normalDice: 3,
      hungerDice: 2,
      outcome: 'pending',
    });
    expect(mixed.dice.map((die) => die.dieKind))
      .toEqual(['normal', 'normal', 'normal', 'hunger', 'hunger']);
    expect(mixed.baseRoll.notation).toBe('3d10+2d10');
    expect(new Set(mixed.dice.map((die) => die.id)).size).toBe(5);

    const capped = rollVampireV5({ pool: 2, hunger: 5 }, { seed: 'capped' });
    expect(capped).toMatchObject({ normalDice: 0, hungerDice: 2, hunger: 5 });
    expect(capped.dice.every((die) => die.dieKind === 'hunger')).toBe(true);
    expect(capped.baseRoll.notation).toBe('2d10');
  });

  test('counts critical pairs and resolves ordinary and messy critical victories', () => {
    const critical = rollVampireV5(
      { pool: 2, hunger: 0, difficulty: 1 },
      { seed: 'crit-55' },
    );
    expect(critical.dice.map((die) => die.rawValue)).toEqual([10, 10]);
    expect(critical).toMatchObject({
      successes: 4,
      criticalPairs: 1,
      outcome: 'critical-success',
    });

    const messy = rollVampireV5(
      { pool: 2, hunger: 1, difficulty: 1 },
      { seed: 'messy-1' },
    );
    expect(messy.dice.map((die) => die.rawValue)).toEqual([10, 10]);
    expect(messy).toMatchObject({
      successes: 4,
      criticalPairs: 1,
      outcome: 'messy-critical',
    });

    const triple = rollVampireV5(
      { pool: 3, hunger: 0, difficulty: 1 },
      { seed: 'triple-51' },
    );
    expect(triple.dice.map((die) => die.rawValue)).toEqual([10, 10, 10]);
    expect(triple).toMatchObject({
      successes: 5,
      criticalPairs: 1,
      outcome: 'critical-success',
    });
  });

  test('only applies messy and bestial outcomes when the roll wins or fails respectively', () => {
    const failedMessyFaces = rollVampireV5(
      { pool: 2, hunger: 1, difficulty: 5 },
      { seed: 'messy-1' },
    );
    expect(failedMessyFaces).toMatchObject({
      successes: 4,
      criticalPairs: 1,
      outcome: 'failure',
    });

    const bestial = rollVampireV5(
      { pool: 1, hunger: 1, difficulty: 1 },
      { seed: 'bestial-21' },
    );
    expect(bestial.dice[0]).toMatchObject({ rawValue: 1, dieKind: 'hunger' });
    expect(bestial).toMatchObject({ successes: 0, outcome: 'bestial-failure' });

    const rescued = rollVampireV5(
      { pool: 2, hunger: 1, difficulty: 1 },
      { seed: 'saved-38' },
    );
    expect(rescued.dice.map((die) => die.rawValue)).toEqual([8, 1]);
    expect(rescued).toMatchObject({ successes: 1, outcome: 'success' });

    expect(rollVampireV5(
      { pool: 1, hunger: 0, difficulty: 1 },
      { seed: 'fail-0' },
    )).toMatchObject({ successes: 0, outcome: 'failure' });
  });

  test('replays the same system faces and outcome', () => {
    const input: VampireV5RollInput = { pool: 7, hunger: 3, difficulty: 4 };
    const first = rollVampireV5(input, {
      seed: 'vampire-replay',
      randomAlgorithm: 'xoshiro128ss',
    });
    const replayed = rollVampireV5(input, { replay: first.baseRoll.replay });

    expect(replayed).toEqual(first);
  });

  test('validates V5 inputs and delegates dice limits to the V3 engine', () => {
    for (const input of [
      null,
      [],
      {},
      { pool: 0, hunger: 0 },
      { pool: 1.5, hunger: 0 },
      { pool: '1', hunger: 0 },
      { pool: Number.MAX_SAFE_INTEGER + 1, hunger: 0 },
      { pool: 1 },
      { pool: 1, hunger: -1 },
      { pool: 1, hunger: 6 },
      { pool: 1, hunger: 0, difficulty: -1 },
      { pool: 1, hunger: 0, difficulty: 1.5 },
    ]) {
      expect(() => unsafeRoll(input))
        .toThrow(expect.objectContaining({ code: 'INVALID_SYSTEM_INPUT' }));
    }

    expect(() => rollVampireV5(
      { pool: 2, hunger: 1 },
      { limits: { maxInitialDice: 1 } },
    )).toThrow(expect.objectContaining({ code: 'TOO_MANY_INITIAL_DICE' }));
  });
});
