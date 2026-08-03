import { describe, expect, test } from 'vitest';
import type { RollOptions } from '../types.js';
import {
  DAGGERHEART_FEAR_D12_PROFILE,
  DAGGERHEART_HOPE_D12_PROFILE,
  rollDaggerheart,
  type DaggerheartRollInput,
  type DaggerheartRollResult,
} from './daggerheart.js';

const unsafeRoll = rollDaggerheart as (
  input: unknown,
  options?: RollOptions,
) => unknown;

const findRoll = (
  input: DaggerheartRollInput,
  predicate: (roll: DaggerheartRollResult) => boolean,
): DaggerheartRollResult => {
  for (let index = 0; index < 1_000; index += 1) {
    const roll = rollDaggerheart(input, { seed: `daggerheart-outcome-${index}` });
    if (predicate(roll)) {
      return roll;
    }
  }
  throw new Error('Expected a deterministic Daggerheart roll matching the predicate.');
};

describe('Daggerheart Duality Dice', () => {
  test('keeps Hope and Fear as separate, auditable d12 results', () => {
    const roll = rollDaggerheart({ modifier: -2, difficulty: 12 }, { seed: 'roles' });

    expect(roll).toMatchObject({
      type: 'daggerheart-roll',
      schemaVersion: 1,
      system: 'daggerheart',
      rulesVersion: 1,
      modifier: -2,
      difficulty: 12,
    });
    expect(roll.baseRoll.notation).toBe('1d12+1d12');
    expect(roll.dualityTotal).toBe(roll.hopeDie.rawValue + roll.fearDie.rawValue);
    expect(roll.total).toBe(roll.dualityTotal - 2);
    expect(roll.dice).toEqual([roll.hopeDie, roll.fearDie]);
    expect(roll.hopeDie).toMatchObject({
      profileId: DAGGERHEART_HOPE_D12_PROFILE,
      dieKind: 'hope',
      faceKey: 'hope',
      symbols: ['hope'],
      sides: 12,
    });
    expect(roll.fearDie).toMatchObject({
      profileId: DAGGERHEART_FEAR_D12_PROFILE,
      dieKind: 'fear',
      faceKey: 'fear',
      symbols: ['fear'],
      sides: 12,
    });
  });

  test('resolves every non-critical success and failure with Hope or Fear', () => {
    const successWithHope = findRoll(
      { difficulty: 0 },
      (roll) => roll.duality === 'hope',
    );
    const successWithFear = findRoll(
      { difficulty: 0 },
      (roll) => roll.duality === 'fear',
    );
    const failureWithHope = findRoll(
      { difficulty: 99 },
      (roll) => roll.duality === 'hope',
    );
    const failureWithFear = findRoll(
      { difficulty: 99 },
      (roll) => roll.duality === 'fear',
    );

    expect(successWithHope).toMatchObject({ succeeds: true, outcome: 'success-with-hope' });
    expect(successWithFear).toMatchObject({ succeeds: true, outcome: 'success-with-fear' });
    expect(failureWithHope).toMatchObject({ succeeds: false, outcome: 'failure-with-hope' });
    expect(failureWithFear).toMatchObject({ succeeds: false, outcome: 'failure-with-fear' });
  });

  test('treats matching Dice as an automatic Critical Success', () => {
    const roll = findRoll(
      { modifier: -10, difficulty: 99 },
      (candidate) => candidate.hopeDie.rawValue === candidate.fearDie.rawValue,
    );

    expect(roll).toMatchObject({
      duality: 'critical',
      succeeds: true,
      outcome: 'critical-success',
    });
  });

  test('reports Hope or Fear without resolving an omitted secret Difficulty', () => {
    const roll = findRoll({}, (candidate) => candidate.duality === 'fear');

    expect(roll).toMatchObject({
      difficulty: null,
      duality: 'fear',
      succeeds: null,
      outcome: 'pending-with-fear',
    });
  });

  test('is deterministic with replay descriptors', () => {
    const input: DaggerheartRollInput = { modifier: -1, difficulty: 13 };
    const first = rollDaggerheart(input, {
      seed: 'daggerheart-replay',
      randomAlgorithm: 'xoshiro128ss',
    });
    const replayed = rollDaggerheart(input, { replay: first.baseRoll.replay });

    expect(replayed).toEqual(first);
  });

  test('validates modifier and Difficulty values and preserves engine limits', () => {
    for (const input of [
      null,
      [],
      { modifier: 1.5 },
      { modifier: Number.MAX_SAFE_INTEGER },
      { difficulty: -1 },
      { difficulty: 1.5 },
      { difficulty: '12' },
    ]) {
      expect(() => unsafeRoll(input))
        .toThrow(expect.objectContaining({ code: 'INVALID_SYSTEM_INPUT' }));
    }

    expect(() => rollDaggerheart({}, { limits: { maxInitialDice: 1 } }))
      .toThrow(expect.objectContaining({ code: 'TOO_MANY_INITIAL_DICE' }));
  });
});
