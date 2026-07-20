import { describe, expect, test } from 'vitest';
import { normalizeRpgDiceNotation, parseNormalizedDiceInput } from './normalization.js';

describe('V3 notation normalization', () => {
  test('normalizes the ERPG friendly aliases without changing functions', () => {
    expect(normalizeRpgDiceNotation('d + 2d + f + 2f + df + 2d6ei6 + 4d6km'))
      .toBe('d20+2d20+4dF+2dF+dF+2d6!>=6+4d6kl1');
    expect(normalizeRpgDiceNotation('floor(1d6/2)+max(1d6,2)'))
      .toBe('floor(1d6/2)+max(1d6,2)');
  });

  test('extracts all descriptions while retaining a multi-roll marker', () => {
    expect(parseNormalizedDiceInput(' 2 # 1d6 [ataque] // vantagem')).toEqual({
      input: ' 2 # 1d6 [ataque] // vantagem',
      comment: 'ataque vantagem',
      notation: '1d6',
      normalizedNotation: '2#1d6',
      rollCount: 2,
      isMultiRoll: true,
    });
  });

  test.each(['3-1#1d6', '(3-1)#1d6', '{3-1}#1d6', '[3-1]#1d6'])(
    'resolves the computed multi-roll count in %s',
    (input) => {
      expect(parseNormalizedDiceInput(input)).toMatchObject({
        input,
        notation: '1d6',
        normalizedNotation: '2#1d6',
        rollCount: 2,
        isMultiRoll: true,
      });
    },
  );

  test('supports deterministic functions in a computed multi-roll count', () => {
    expect(parseNormalizedDiceInput('ceil(3/2)#1d6')).toMatchObject({
      notation: '1d6',
      normalizedNotation: '2#1d6',
      rollCount: 2,
      isMultiRoll: true,
    });
  });

  test('treats a non-prefix hash as an inline description', () => {
    expect(parseNormalizedDiceInput('1d20 # iniciativa')).toMatchObject({
      comment: 'iniciativa',
      notation: '1d20',
      rollCount: 1,
    });
    expect(parseNormalizedDiceInput('[ataque] # iniciativa')).toMatchObject({
      comment: 'ataque iniciativa',
      isMultiRoll: false,
    });
  });

  test('handles multiline, bracket, unterminated, and multi-line comments', () => {
    expect(parseNormalizedDiceInput('1d6/* a */+1 [b]\n// c\n+2# d')).toMatchObject({
      notation: '1d6+1+2',
      comment: 'a b c d',
    });
    expect(parseNormalizedDiceInput('1d6 /* open')).toMatchObject({
      notation: '1d6',
      comment: 'open',
    });
    expect(parseNormalizedDiceInput('1d6 [open')).toMatchObject({
      notation: '1d6',
      comment: 'open',
    });
  });

  test('preserves parenthesized quantities and sides', () => {
    expect(normalizeRpgDiceNotation('(2+1)d(3+3)')).toBe('(2+1)d(3+3)');
  });
});
