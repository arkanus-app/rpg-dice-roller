import { describe, expect, test } from 'vitest';
import {
  compareValues,
  evaluateBinary,
  evaluateBinaryFunction,
  evaluateUnaryFunction,
  MATH_PROFILE,
  normalizeMathValue,
  roundResult,
} from './math.js';

describe('V3 math', () => {
  test('evaluates every binary operator', () => {
    expect(evaluateBinary('+', 7, 2, '')).toBe(9);
    expect(evaluateBinary('-', 7, 2, '')).toBe(5);
    expect(evaluateBinary('*', 7, 2, '')).toBe(14);
    expect(evaluateBinary('/', 7, 2, '')).toBe(3.5);
    expect(evaluateBinary('%', 7, 2, '')).toBe(1);
    expect(evaluateBinary('^', 7, 2, '')).toBe(49);
    expect(() => evaluateBinary('/', 1, 0, '1/0')).toThrow('non-finite');
  });

  test('evaluates every supported function', () => {
    expect(evaluateUnaryFunction('abs', -2, '')).toBe(2);
    expect(evaluateUnaryFunction('ceil', 1.2, '')).toBe(2);
    expect(evaluateUnaryFunction('cos', 0, '')).toBe(1);
    expect(evaluateUnaryFunction('exp', 0, '')).toBe(1);
    expect(evaluateUnaryFunction('floor', 1.8, '')).toBe(1);
    expect(evaluateUnaryFunction('log', 1, '')).toBe(0);
    expect(evaluateUnaryFunction('round', 1.6, '')).toBe(2);
    expect(evaluateUnaryFunction('sign', -4, '')).toBe(-1);
    expect(evaluateUnaryFunction('sin', 0, '')).toBe(0);
    expect(evaluateUnaryFunction('sqrt', 9, '')).toBe(3);
    expect(evaluateUnaryFunction('tan', 0, '')).toBe(0);
    expect(() => evaluateUnaryFunction('sqrt', -1, 'sqrt(-1)')).toThrow('non-finite');
    expect(evaluateBinaryFunction('max', 2, 8, '')).toBe(8);
    expect(evaluateBinaryFunction('min', 2, 8, '')).toBe(2);
    expect(evaluateBinaryFunction('pow', 2, 8, '')).toBe(256);
  });

  test('compares values and rounds public totals', () => {
    expect(compareValues('=', 2, 2)).toBe(true);
    expect(compareValues('!=', 2, 3)).toBe(true);
    expect(compareValues('<>', 2, 3)).toBe(true);
    expect(compareValues('<', 2, 3)).toBe(true);
    expect(compareValues('>', 3, 2)).toBe(true);
    expect(compareValues('<=', 2, 2)).toBe(true);
    expect(compareValues('>=', 2, 2)).toBe(true);
    expect(roundResult(1.234)).toBe(1.23);
    expect(roundResult(-0.001)).toBe(0);
  });

  test('applies decimal12-v1 after every operation and normalizes negative zero', () => {
    expect(MATH_PROFILE).toBe('decimal12-v1');
    expect(evaluateBinary('/', 1, 3, '')).toBe(0.333333333333);
    expect(evaluateBinary('+', 0.1, 0.2, '')).toBe(0.3);
    expect(normalizeMathValue(1.23456789012345e25, '')).toBe(1.23456789012e25);
    expect(normalizeMathValue(Number.MAX_SAFE_INTEGER, '')).toBe(Number.MAX_SAFE_INTEGER);
    expect(normalizeMathValue(-0, '')).toBe(0);
    expect(Object.is(normalizeMathValue(-0, ''), -0)).toBe(false);
  });
});
