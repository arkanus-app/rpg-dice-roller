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

  test('does not reinterpret adjacent modifier quantities as friendly dice', () => {
    expect(normalizeRpgDiceNotation('4d6kh3dl1')).toBe('4d6kh3dl1');
    expect(normalizeRpgDiceNotation('4d6kh3dis')).toBe('4d6kh3dis');
  });

  test.each([
    ['2d20-pool(1)', '2d20pool(-1)'],
    ['2d20+pool(2)', '2d20pool(+2)'],
    ['2d20-pull(3)', '2d20pool(-3)'],
    ['2d20+PULL(4)', '2d20pool(+4)'],
    ['2d20pull(-1)', '2d20pool(-1)'],
    ['d20ADVpull(-1)', 'd20advpool(-1)'],
    ['1d20+2-pool(1)', '1d20+2pool(-1)'],
    ['1d20+2-pull(1)adv', '1d20+2pool(-1)adv'],
    ['d20ADV', 'd20adv'],
    ['d20DIS', 'd20dis'],
  ])('normalizes structural pool alias %s', (input, expected) => {
    expect(normalizeRpgDiceNotation(input)).toBe(expected);
    expect(normalizeRpgDiceNotation(expected)).toBe(expected);
  });

  test.each([
    ['1d5-step(1)', '1d5step(-1)'],
    ['1d5+step(2)', '1d5step(+2)'],
    ['1d5-STEP(3)', '1d5step(-3)'],
    ['1d5-STREP(1)', '1d5step(-1)'],
    ['1d5strep(+2)', '1d5step(+2)'],
    ['1d5+2-step(1)', '1d5+2step(-1)'],
  ])('normalizes structural dice-step alias %s', (input, expected) => {
    expect(normalizeRpgDiceNotation(input)).toBe(expected);
    expect(normalizeRpgDiceNotation(expected)).toBe(expected);
  });
});
