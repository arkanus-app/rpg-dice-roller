import { describe, expect, test } from 'vitest';
import {
  compatibilityCorpus,
  compatibilitySeeds,
  type CompatibilityRollGolden,
} from '../../tests/fixtures/v3-compatibility-corpus.js';
import { compileRpgDice, rollRpgDice as rollV3 } from './engine.js';
import { normalizeRpgDiceNotation as normalizeV3 } from './normalization.js';
import type { ReplayDescriptor } from './runtime/replay.js';
import type { DiceRollResult } from './types.js';

interface CompatibilityCaseResult {
  readonly caseName: string;
  readonly normalizedNotation: string;
  readonly result: CompatibilityRollGolden;
}

function replayForSeed(
  words: readonly number[],
  planFingerprint: string,
): ReplayDescriptor {
  const hexadecimal = words
    .map((word) => (word >>> 0).toString(16).padStart(8, '0'))
    .join('');

  return {
    schemaVersion: 2,
    algorithm: 'mt19937',
    algorithmVersion: 1,
    executionVersion: 1,
    mathProfile: 'decimal12-v1',
    origin: 'crypto',
    seedMaterial: hexadecimal,
    planFingerprint,
  };
}

function projectV3(result: DiceRollResult): CompatibilityRollGolden {
  return {
    total: result.total,
    rollTotals: result.rolls.map((roll) => roll.total),
    diceValuesByRoll: result.rolls.map((roll) => {
      const end = roll.diceRange.start + roll.diceRange.count;
      return result.dice
        .slice(roll.diceRange.start, end)
        .map((die) => die.value)
        .sort((left, right) => left - right);
    }),
    pool: result.pool,
  };
}

function expectedCases(): readonly CompatibilityCaseResult[] {
  return compatibilityCorpus.flatMap((entry) => (
    compatibilitySeeds.map((seed, index) => {
      const expected = entry.outcomes[index];
      if (expected === undefined) {
        throw new Error(`Incomplete compatibility fixture for ${entry.notation} at ${index}`);
      }
      return {
        caseName: `${entry.notation} / ${seed.name}`,
        normalizedNotation: entry.normalizedNotation,
        result: expected,
      };
    })
  ));
}

function executeV3Corpus(): readonly CompatibilityCaseResult[] {
  return compatibilityCorpus.flatMap((entry) => (
    compatibilitySeeds.map((seed) => {
      const plan = compileRpgDice(entry.notation);
      return {
        caseName: `${entry.notation} / ${seed.name}`,
        normalizedNotation: normalizeV3(entry.notation),
        result: projectV3(rollV3(plan, {
          replay: replayForSeed(seed.words, plan.planFingerprint),
        })),
      };
    })
  ));
}

describe('frozen migration compatibility corpus', () => {
  test('matches the normalization golden for every comparable notation', () => {
    for (const entry of compatibilityCorpus) {
      expect(normalizeV3(entry.notation), entry.notation).toBe(entry.normalizedNotation);
    }
  });

  test('matches controlled MT19937 results captured before legacy removal', () => {
    const expected = expectedCases();
    const v3 = executeV3Corpus();

    expect(v3, 'V3 compatibility corpus drifted from the golden').toEqual(expected);
  });
});
