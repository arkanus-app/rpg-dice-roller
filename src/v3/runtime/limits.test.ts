import { describe, expect, it } from 'vitest';
import { isDiceRollError, type DiceRollError } from '../errors.js';
import { ExecutionBudget } from './budget.js';
import {
  createDiceLimits,
  resolveDiceLimits,
  type DiceLimitOverrides,
} from './limits.js';

function expectErrorCode(action: () => void, code: DiceRollError['code']): void {
  try {
    action();
  } catch (error: unknown) {
    expect(isDiceRollError(error)).toBe(true);
    if (isDiceRollError(error)) {
      expect(error.code).toBe(code);
      expect(JSON.parse(JSON.stringify(error))).toEqual(error.toJSON());
    }
    return;
  }

  throw new Error(`Expected ${code}`);
}

describe('dice limits', () => {
  it('creates immutable engine limits and accepts lower per-call limits', () => {
    const engine = createDiceLimits({ maxRolls: 50, maxEvents: 500 });
    const call = resolveDiceLimits(engine, { maxRolls: 10 });

    expect(Object.isFrozen(engine)).toBe(true);
    expect(Object.isFrozen(call)).toBe(true);
    expect(call.maxRolls).toBe(10);
    expect(call.maxEvents).toBe(500);
  });

  it('rejects invalid limits and per-call cap increases', () => {
    expectErrorCode(() => createDiceLimits({ maxRolls: 0 }), 'INVALID_LIMIT');
    const engine = createDiceLimits({ maxRolls: 10 });
    expectErrorCode(() => resolveDiceLimits(engine, { maxRolls: 11 }), 'INVALID_LIMIT');
    const hostile: DiceLimitOverrides = Object.defineProperty({}, 'maxRolls', {
      get(): never {
        throw new Error('hostile');
      },
    });
    expectErrorCode(() => createDiceLimits(hostile), 'INVALID_LIMIT');
    expectErrorCode(() => createDiceLimits(null), 'INVALID_LIMIT');
    expectErrorCode(() => createDiceLimits([]), 'INVALID_LIMIT');
    expectErrorCode(() => createDiceLimits({ maxRolls: 'ten' }), 'INVALID_LIMIT');
    expectErrorCode(() => createDiceLimits({ maxRolls: 1.5 }), 'INVALID_LIMIT');
    expectErrorCode(() => createDiceLimits({ maxRolls: Number.NaN }), 'INVALID_LIMIT');

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expectErrorCode(() => createDiceLimits(revoked.proxy), 'INVALID_LIMIT');
  });
});

describe('ExecutionBudget', () => {
  const limits = createDiceLimits({
    maxInputLength: 2,
    maxAstDepth: 2,
    maxAstNodes: 1,
    maxRolls: 1,
    maxInitialDice: 1,
    maxGeneratedDice: 1,
    maxRandomCalls: 1,
    maxEvents: 1,
    maxSides: 1,
    maxSeedLength: 1,
    maxModifierSteps: 1,
    maxResolvedGroups: 1,
    maxResultItems: 1,
    maxOutputLength: 1,
  });

  it('enforces input, AST depth and AST node caps', () => {
    const budget = new ExecutionBudget(limits);
    expectErrorCode(() => budget.assertInputLength('1d6'), 'INPUT_TOO_LONG');
    expectErrorCode(() => budget.consumeAstNode(3), 'AST_TOO_DEEP');
    budget.consumeAstNode(1);
    expectErrorCode(() => budget.consumeAstNode(1), 'TOO_MANY_NODES');
    expectErrorCode(() => new ExecutionBudget(limits).consumeAstNode(0), 'ROLL_EXECUTION_LIMIT');
    expectErrorCode(() => new ExecutionBudget(limits).consumeAstNode(1.5), 'ROLL_EXECUTION_LIMIT');
  });

  it('enforces every execution counter without incrementing past its cap', () => {
    const budget = new ExecutionBudget(limits);
    budget.consumeRolls();
    expectErrorCode(() => budget.consumeRolls(), 'TOO_MANY_ROLLS');
    budget.consumeInitialDice();
    expectErrorCode(() => budget.consumeInitialDice(), 'TOO_MANY_INITIAL_DICE');
    budget.consumeGeneratedDice();
    expectErrorCode(
      () => budget.consumeGeneratedDice(),
      'GENERATED_DICE_LIMIT_EXCEEDED',
    );
    budget.consumeRandomCalls();
    expectErrorCode(() => budget.consumeRandomCalls(), 'RANDOM_BUDGET_EXCEEDED');
    budget.consumeEvents();
    expectErrorCode(() => budget.consumeEvents(), 'EVENT_LIMIT_EXCEEDED');
    budget.consumeModifierSteps();
    expectErrorCode(
      () => budget.consumeModifierSteps(),
      'MODIFIER_STEP_LIMIT_EXCEEDED',
    );
    budget.consumeResolvedGroups();
    expectErrorCode(
      () => budget.consumeResolvedGroups(),
      'RESOLVED_GROUP_LIMIT_EXCEEDED',
    );
    budget.consumeResultItems();
    expectErrorCode(() => budget.consumeResultItems(), 'RESULT_LIMIT_EXCEEDED');
    budget.assertOutputLength(1);
    expectErrorCode(() => budget.assertOutputLength(2), 'OUTPUT_LIMIT_EXCEEDED');

    expect(budget.snapshot()).toEqual({
      astNodes: 0,
      rolls: 1,
      initialDice: 1,
      generatedDice: 1,
      randomCalls: 1,
      modifierSteps: 1,
      events: 1,
      resolvedGroups: 1,
      resultItems: 1,
    });
    expect(budget.stats()).toEqual({
      rolls: 1,
      initialDice: 1,
      generatedDice: 1,
      randomCalls: 1,
      modifierSteps: 1,
      events: 1,
      resolvedGroups: 1,
      resultItems: 1,
    });

    expectErrorCode(() => new ExecutionBudget(limits).consumeRolls(-1), 'ROLL_EXECUTION_LIMIT');
    expectErrorCode(
      () => new ExecutionBudget(limits).consumeEvents(Number.POSITIVE_INFINITY),
      'ROLL_EXECUTION_LIMIT',
    );
  });

  it('provides all efficiency hardening defaults', () => {
    const limits = createDiceLimits();
    expect(limits.maxSides).toBe(0x1_0000_0000);
    expect(limits.maxSeedLength).toBe(1_024);
    expect(limits.maxModifierSteps).toBe(100_000);
    expect(limits.maxResolvedGroups).toBe(100_000);
    expect(limits.maxResultItems).toBe(250_000);
    expect(limits.maxOutputLength).toBe(1_000_000);
  });
});
