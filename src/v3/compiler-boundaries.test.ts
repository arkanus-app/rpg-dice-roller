import { describe, expect, test } from 'vitest';
import { compileDicePlan } from './compiler.js';
import { createDiceLimits } from './runtime/limits.js';

describe('bounded semantic analysis', () => {
  test.each(['1d6!!1r=1', '1d6!p1r=0', '2d6!!1>=3u', '2d6!!p1u',
    '1d4097!1=2uo', '1d4097!1!=2uo', '1d4097!1<>2uo', '1d4097!1<=2uo', '1d4097!1>2uo',
    '1d4097!1=0uo', '1d4097!1=5000uo', '1d4097!1=1.5uo',
    '1d4097min1.5!1=1.5uo', '1d4097min5000!1!=5000uo',
    '1d4097min5000!1<>2uo', '1d4097min5000!1=5000uo',
    'max(1,d6)', 'sign(-0)', '(+2)#d1',
  ])('compiles terminating notation %s', (notation) => {
    const plan = compileDicePlan(notation, createDiceLimits());
    expect(plan.type).toBe('roll-plan');
    expect(Number.isSafeInteger(plan.cost.totalWorstCaseRandomCalls)).toBe(true);
  });

  test.each(['3d1!!1u>=1', '1d2!2>=1u>=1', '1d2!3>=1u>=1', '3d2!p1u>=0', '4d2u>=1'])('proves impossible uniqueness for %s', (notation) => {
    expect(() => compileDicePlan(notation, createDiceLimits())).toThrow(expect.objectContaining({ code: 'IMPOSSIBLE_UNIQUE' }));
  });

  test.each(['2d4097!!1u', '2d6!!1000u', '2d256!!64>=1u'])('fails closed on analysis limits for %s', (notation) => {
    expect(() => compileDicePlan(notation, createDiceLimits())).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_NOTATION', details: { reason: 'semantic-analysis-limit' } }));
  });

  test('bounds transitions shared by all dice nodes', () => {
    const notation = Array.from({ length: 40 }, () => '2d256!!2>=1u').join('+');
    expect(() => compileDicePlan(notation, createDiceLimits())).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_NOTATION', details: { reason: 'semantic-analysis-limit' } }));
  });

  test('saturates inspection costs without losing integer precision', () => {
    const limits = createDiceLimits({ maxModifierSteps: Number.MAX_SAFE_INTEGER });
    const plan = compileDicePlan('2#2d6!r=1', limits);
    expect(plan.cost.totalWorstCaseGeneratedDice).toBe(Number.MAX_SAFE_INTEGER);
    expect(plan.cost.totalWorstCaseRandomCalls).toBe(Number.MAX_SAFE_INTEGER);
  });

  test('rejects an unrepresentable roll count', () => {
    expect(() => compileDicePlan(`${'9'.repeat(400)}#d6`, createDiceLimits())).toThrow(expect.objectContaining({ code: 'INVALID_NOTATION', details: { rollCount: 'Infinity' } }));
  });
});
