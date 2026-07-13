import { DiceRollError, type DiceRollErrorCode, type JsonObject } from '../errors.js';
import type { DiceLimits } from './limits.js';

export interface ExecutionBudgetSnapshot {
  readonly astNodes: number;
  readonly rolls: number;
  readonly initialDice: number;
  readonly generatedDice: number;
  readonly randomCalls: number;
  readonly modifierSteps: number;
  readonly events: number;
  readonly resolvedGroups: number;
  readonly resultItems: number;
}

export interface ExecutionStats {
  readonly rolls: number;
  readonly initialDice: number;
  readonly generatedDice: number;
  readonly randomCalls: number;
  readonly modifierSteps: number;
  readonly events: number;
  readonly resolvedGroups: number;
  readonly resultItems: number;
}

export interface RandomCallBudget {
  consumeRandomCalls(count?: number): void;
}

export interface EventBudget {
  consumeEvents(count?: number): void;
  consumeResultItems(count?: number): void;
}

interface BudgetErrorDefinition {
  readonly code: DiceRollErrorCode;
  readonly message: string;
  readonly limitName: keyof DiceLimits;
}

function assertCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new DiceRollError('Budget consumption must be a non-negative safe integer', {
      code: 'ROLL_EXECUTION_LIMIT',
      details: { count: Number.isFinite(count) ? count : String(count) },
    });
  }
}

export class ExecutionBudget implements RandomCallBudget, EventBudget {
  readonly limits: DiceLimits;

  private astNodes = 0;

  private rolls = 0;

  private initialDice = 0;

  private generatedDice = 0;

  private randomCalls = 0;

  private modifierSteps = 0;

  private events = 0;

  private resolvedGroups = 0;

  private resultItems = 0;

  constructor(limits: DiceLimits) {
    this.limits = limits;
  }

  assertInputLength(input: string): void {
    if (input.length > this.limits.maxInputLength) {
      this.throwLimit(
        {
          code: 'INPUT_TOO_LONG',
          message: 'Dice input exceeds the maximum length',
          limitName: 'maxInputLength',
        },
        input.length,
        { inputLength: input.length },
        input,
      );
    }
  }

  consumeAstNode(depth: number): void {
    if (!Number.isSafeInteger(depth) || depth < 1) {
      throw new DiceRollError('AST depth must be a positive safe integer', {
        code: 'ROLL_EXECUTION_LIMIT',
        details: { depth },
      });
    }

    if (depth > this.limits.maxAstDepth) {
      this.throwLimit({
        code: 'AST_TOO_DEEP',
        message: 'AST exceeds the maximum depth',
        limitName: 'maxAstDepth',
      }, depth, { depth });
    }

    this.astNodes = this.consume(
      this.astNodes,
      1,
      {
        code: 'TOO_MANY_NODES',
        message: 'AST exceeds the maximum node count',
        limitName: 'maxAstNodes',
      },
    );
  }

  consumeRolls(count = 1): void {
    this.rolls = this.consume(this.rolls, count, {
      code: 'TOO_MANY_ROLLS',
      message: 'Roll count exceeds the execution limit',
      limitName: 'maxRolls',
    });
  }

  consumeInitialDice(count = 1): void {
    this.initialDice = this.consume(this.initialDice, count, {
      code: 'TOO_MANY_INITIAL_DICE',
      message: 'Initial dice count exceeds the execution limit',
      limitName: 'maxInitialDice',
    });
  }

  consumeGeneratedDice(count = 1): void {
    this.generatedDice = this.consume(this.generatedDice, count, {
      code: 'GENERATED_DICE_LIMIT_EXCEEDED',
      message: 'Generated dice count exceeds the execution limit',
      limitName: 'maxGeneratedDice',
    });
  }

  consumeRandomCalls(count = 1): void {
    this.randomCalls = this.consume(this.randomCalls, count, {
      code: 'RANDOM_BUDGET_EXCEEDED',
      message: 'Random call count exceeds the execution limit',
      limitName: 'maxRandomCalls',
    });
  }

  consumeEvents(count = 1): void {
    this.events = this.consume(this.events, count, {
      code: 'EVENT_LIMIT_EXCEEDED',
      message: 'Event count exceeds the execution limit',
      limitName: 'maxEvents',
    });
  }

  consumeModifierSteps(count = 1): void {
    this.modifierSteps = this.consume(this.modifierSteps, count, {
      code: 'MODIFIER_STEP_LIMIT_EXCEEDED',
      message: 'Modifier step count exceeds the execution limit',
      limitName: 'maxModifierSteps',
    });
  }

  consumeResolvedGroups(count = 1): void {
    this.resolvedGroups = this.consume(this.resolvedGroups, count, {
      code: 'RESOLVED_GROUP_LIMIT_EXCEEDED',
      message: 'Resolved group count exceeds the execution limit',
      limitName: 'maxResolvedGroups',
    });
  }

  consumeResultItems(count = 1): void {
    this.resultItems = this.consume(this.resultItems, count, {
      code: 'RESULT_LIMIT_EXCEEDED',
      message: 'Result item count exceeds the execution limit',
      limitName: 'maxResultItems',
    });
  }

  assertOutputLength(length: number): void {
    assertCount(length);
    if (length > this.limits.maxOutputLength) {
      this.throwLimit({
        code: 'OUTPUT_LIMIT_EXCEEDED',
        message: 'Output exceeds the maximum length',
        limitName: 'maxOutputLength',
      }, length, { outputLength: length });
    }
  }

  snapshot(): ExecutionBudgetSnapshot {
    return Object.freeze({
      astNodes: this.astNodes,
      rolls: this.rolls,
      initialDice: this.initialDice,
      generatedDice: this.generatedDice,
      randomCalls: this.randomCalls,
      modifierSteps: this.modifierSteps,
      events: this.events,
      resolvedGroups: this.resolvedGroups,
      resultItems: this.resultItems,
    });
  }

  stats(): ExecutionStats {
    return Object.freeze({
      rolls: this.rolls,
      initialDice: this.initialDice,
      generatedDice: this.generatedDice,
      randomCalls: this.randomCalls,
      modifierSteps: this.modifierSteps,
      events: this.events,
      resolvedGroups: this.resolvedGroups,
      resultItems: this.resultItems,
    });
  }

  private consume(
    current: number,
    count: number,
    error: BudgetErrorDefinition,
  ): number {
    assertCount(count);
    const next = current + count;
    const limit = this.limits[error.limitName];

    if (!Number.isSafeInteger(next) || next > limit) {
      this.throwLimit(error, next, { consumed: next });
    }

    return next;
  }

  private throwLimit(
    definition: BudgetErrorDefinition,
    actual: number,
    details: JsonObject,
    input = '',
  ): never {
    const limit = this.limits[definition.limitName];
    throw new DiceRollError(definition.message, {
      code: definition.code,
      input,
      details: {
        ...details,
        limitName: definition.limitName,
        limit,
        actual,
      },
    });
  }
}
