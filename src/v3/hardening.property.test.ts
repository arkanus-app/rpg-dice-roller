import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { createDiceEngine } from './engine.js';
import { isDiceRollError, type DiceRollErrorCode } from './errors.js';
import type { DiceNotationInspection } from './types.js';

const HARDENING_SEED = 0x5afe_2026;
const HOSTILE_LIMITS = {
  maxInputLength: 512,
  maxAstDepth: 24,
  maxAstNodes: 128,
  maxRolls: 8,
  maxInitialDice: 48,
  maxGeneratedDice: 24,
  maxRandomCalls: 96,
  maxEvents: 128,
};

const hostileFragment = fc.constantFrom(
  '', '\0', '\n', '\r', '\u2028', '(', ')', '{', '}', '[', ']', ',', '#', '/*', '*/', '//',
  '+', '-', '*', '/', '%', '^', '**', '!', '!!', '!p', '<', '>', '<=', '>=', '=', '!=',
  'd', 'F', 'F.1', 'F.2', 'r', 'ro', 'u', 'uo', 'kh', 'kl', 'dh', 'dl', 'min', 'max',
  'cs', 'cf', 'sa', 'sd', 'abs', 'pow', '00000000000000000000', '99999999999999999999',
  '\ud800', '\udfff', '🎲', 'λ', '@', '$', '?', '&', '_', '.',
);

type HostileModifier =
  | 'compound'
  | 'explode'
  | 'keep'
  | 'min-max'
  | 'none'
  | 'penetrate'
  | 'reroll'
  | 'reroll-once'
  | 'target'
  | 'unique'
  | 'unique-once';

function modifierNotation(kind: HostileModifier, quantity: number, sides: number): string {
  switch (kind) {
    case 'compound': return '!!>=1';
    case 'explode': return '!>=1';
    case 'keep': return `kh${Math.max(1, quantity - 1)}`;
    case 'min-max': return `min1max${sides}`;
    case 'none': return '';
    case 'penetrate': return '!p>=1';
    case 'reroll': return 'r>=1';
    case 'reroll-once': return 'ro>=1';
    case 'target': return `>=${Math.max(1, Math.ceil(sides * 0.7))}f=1`;
    case 'unique': return 'u';
    case 'unique-once': return 'uo';
  }
}

const executableNotation = fc.record({
  rollCount: fc.integer({ min: 1, max: 3 }),
  quantity: fc.integer({ min: 1, max: 12 }),
  sides: fc.integer({ min: 1, max: 20 }),
  modifier: fc.constantFrom<HostileModifier>(
    'compound', 'explode', 'keep', 'min-max', 'none', 'penetrate',
    'reroll', 'reroll-once', 'target', 'unique', 'unique-once',
  ),
}).map(({ rollCount, quantity, sides, modifier }) => {
  const prefix = rollCount === 1 ? '' : `${rollCount}#`;
  return `${prefix}${quantity}d${sides}${modifierNotation(modifier, quantity, sides)}`;
});

function expectInspectionCode(
  inspection: DiceNotationInspection,
  expectedCode: DiceRollErrorCode,
): void {
  expect(inspection.isValid).toBe(false);
  const error = inspection.error;
  if (error === null) {
    throw new Error(`Expected ${expectedCode}, received no error`);
  }
  expect(error.code).toBe(expectedCode);
  expect(() => JSON.stringify(error)).not.toThrow();
}

describe('V3 parser and limit properties', () => {
  test('turns arbitrary hostile token streams into bounded inspections', () => {
    const engine = createDiceEngine({ limits: HOSTILE_LIMITS, cache: false });
    const hostileInput = fc.array(hostileFragment, { maxLength: 128 })
      .map((fragments) => fragments.join(''));

    fc.assert(
      fc.property(hostileInput, (input) => {
        const inspection = engine.inspect(input);
        expect(inspection.input).toBe(input);
        expect(() => JSON.stringify(inspection)).not.toThrow();

        if (inspection.plan !== null) {
          expect(inspection.plan.rollCount).toBeLessThanOrEqual(HOSTILE_LIMITS.maxRolls);
          expect(inspection.plan.cost.totalStaticDice)
            .toBeLessThanOrEqual(HOSTILE_LIMITS.maxInitialDice);
          expect(inspection.plan.groups.length).toBeLessThanOrEqual(HOSTILE_LIMITS.maxAstNodes);
        } else {
          expect(inspection.error).not.toBeNull();
        }
      }),
      { seed: HARDENING_SEED, numRuns: 750 },
    );
  });

  test('never returns an execution that escaped generated-dice, RNG, or event caps', () => {
    const engine = createDiceEngine({ limits: HOSTILE_LIMITS, cache: false });

    fc.assert(
      fc.property(executableNotation, fc.integer(), (notation, seed) => {
        try {
          const result = engine.roll(notation, { seed });
          expect(result.rolls.length).toBeLessThanOrEqual(HOSTILE_LIMITS.maxRolls);
          expect(result.dice.length).toBeLessThanOrEqual(
            HOSTILE_LIMITS.maxInitialDice + HOSTILE_LIMITS.maxGeneratedDice,
          );
          expect(result.events.length).toBeLessThanOrEqual(HOSTILE_LIMITS.maxEvents);
          expect(() => JSON.stringify(result)).not.toThrow();
        } catch (error: unknown) {
          expect(isDiceRollError(error)).toBe(true);
          if (isDiceRollError(error)) {
            expect([
              'EVENT_LIMIT_EXCEEDED',
              'GENERATED_DICE_LIMIT_EXCEEDED',
              'IMPOSSIBLE_UNIQUE',
              'INVALID_NOTATION',
              'NON_TERMINATING_MODIFIER',
              'RANDOM_BUDGET_EXCEEDED',
            ]).toContain(error.code);
          }
        }
      }),
      { seed: HARDENING_SEED ^ 0x6e67, numRuns: 250 },
    );
  });

  test('rejects inputs immediately beyond each static boundary', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), (limit) => {
        expectInspectionCode(
          createDiceEngine({ limits: { maxInputLength: limit } }).inspect('1'.repeat(limit + 1)),
          'INPUT_TOO_LONG',
        );
        expectInspectionCode(
          createDiceEngine({ limits: { maxRolls: limit } }).inspect(`${limit + 1}#1d6`),
          'TOO_MANY_ROLLS',
        );
        expectInspectionCode(
          createDiceEngine({ limits: { maxInitialDice: limit } }).inspect(`${limit + 1}d6`),
          'TOO_MANY_INITIAL_DICE',
        );
      }),
      { seed: HARDENING_SEED ^ 0x57a7, numRuns: 100 },
    );
  });

  test('rejects AST depth and node counts beyond configured caps', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (limit) => {
        const nested = `${'('.repeat(limit)}1${')'.repeat(limit)}`;
        expectInspectionCode(
          createDiceEngine({ limits: { maxAstDepth: limit } }).inspect(nested),
          'AST_TOO_DEEP',
        );

        const terms = Math.floor(limit / 2) + 2;
        expectInspectionCode(
          createDiceEngine({ limits: { maxAstNodes: limit } })
            .inspect(Array.from({ length: terms }, () => '1').join('+')),
          'TOO_MANY_NODES',
        );
      }),
      { seed: HARDENING_SEED ^ 0xa57, numRuns: 100 },
    );
  });
});
