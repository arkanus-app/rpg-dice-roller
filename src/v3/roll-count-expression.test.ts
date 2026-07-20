import { describe, expect, test } from 'vitest';
import { resolveRollCountExpression } from './roll-count-expression.js';

describe('V3 computed roll count expressions', () => {
  test.each([
    ['', null],
    [' -1 + 3 ', 2],
    ['2*(1+1)', 4],
    ['2**2', 4],
    ['max(1,2)', 2],
    ['(2)+(1)', 3],
    ['([2))', null],
    ['((2)', null],
  ])('resolves %s without weakening grouping validation', (expression, expected) => {
    expect(resolveRollCountExpression(expression)).toBe(expected);
  });

  test.each([
    'dF',
    '2+{1}',
    '-(1d1)',
    '1d1+1',
    'max(1d1,2)',
    'max(2,1d1)',
  ])('rejects non-deterministic roll count %s', (expression) => {
    expect(resolveRollCountExpression(expression)).toBeNull();
  });
});
