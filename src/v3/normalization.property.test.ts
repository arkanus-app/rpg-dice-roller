import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { normalizeRpgDiceNotation, parseNormalizedDiceInput } from './normalization.js';

const NORMALIZATION_SEED = 0x3eed_2026;

describe('V3 normalization properties', () => {
  test('is idempotent for arbitrary Unicode and control-character input', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', maxLength: 512 }),
        (input) => {
          const normalized = normalizeRpgDiceNotation(input);

          expect(normalizeRpgDiceNotation(normalized)).toBe(normalized);
          expect(parseNormalizedDiceInput(normalized)).toMatchObject({
            input: normalized,
            comment: '',
            normalizedNotation: normalized,
          });
        },
      ),
      { seed: NORMALIZATION_SEED, numRuns: 1_000 },
    );
  });

  test('has linear output growth even for alias-heavy input', () => {
    const aliasUnit = fc.constantFrom('d', 'f', 'df', 'ei', 'km', 'kh', 'kl', '+', '-', ' ', '/*x*/');

    fc.assert(
      fc.property(
        fc.array(aliasUnit, { maxLength: 512 }).map((tokens) => tokens.join('')),
        (input) => {
          const normalized = normalizeRpgDiceNotation(input);
          expect(normalized.length).toBeLessThanOrEqual((input.length * 3) + 2);
          expect(normalizeRpgDiceNotation(normalized)).toBe(normalized);
        },
      ),
      { seed: NORMALIZATION_SEED ^ 0x51a5, numRuns: 500 },
    );
  });
});
