import { DiceRollError, isDiceRollError, type SourceSpan } from './errors.js';
import { freezeRollPlan } from './freeze.js';
import { compareValues } from './math.js';
import { parseNormalizedDiceInput, type NormalizedDiceInput } from './normalization.js';
import { ExecutionBudget } from './runtime/budget.js';
import type { DiceLimits } from './runtime/limits.js';
import {
  createNodeId,
  parseDiceNotation,
  type ComparePointNode,
  type DiceNode,
  type ExpressionNode,
  type ModifierNode,
  type RuntimeModifierNode,
} from './syntax/index.js';
import type {
  DiceInspectionCost,
  DiceNotationInspection,
  DiceSides,
  RollPlan,
  RollPlanGroup,
} from './types.js';

export const DICE_COMPILER_VERSION = 1 as const;
const MAX_SAFE_COST = Number.MAX_SAFE_INTEGER;
const MAX_SEMANTIC_STATES = 4_096;
const MAX_SEMANTIC_TRANSITIONS = 1_000_000;
const MINIMUM_DICE_STEP_SIDE = 2;
const MAXIMUM_DICE_STEP_SIDE = 100;
const DICE_STEP_LADDER = Object.freeze([2, 4, 6, 8, 10, 12, 20, 100] as const);

interface CostAccumulator {
  readonly staticDice: number;
  readonly worstCaseGeneratedDice: number;
  readonly worstCaseRandomCalls: number;
}

interface NumericRange {
  readonly minimum: number;
  readonly maximum: number;
  readonly integersOnly: boolean;
}

interface SemanticAnalysisBudget {
  remainingTransitions: number;
}

type CountedProgramNode = ExpressionNode | ModifierNode | ComparePointNode;

export interface CompiledDiceSpec {
  readonly nodeId: string;
  readonly quantity: number;
  readonly sides: DiceSides;
  readonly minimum: number;
  readonly maximum: number;
  readonly possibleFaces: number;
  readonly modifiers: readonly RuntimeModifierNode[];
}

export interface CompiledDiceProgram {
  readonly compilerVersion: 1;
  readonly notation: string;
  readonly programFingerprint: string;
  readonly ast: ExpressionNode;
  readonly postOrder: readonly ExpressionNode[];
  readonly nodeCount: number;
  readonly maxDepth: number;
  readonly staticDice: number;
  readonly maximumSides: number;
  readonly diceSpecs: ReadonlyMap<string, CompiledDiceSpec>;
  readonly groupModifiers: ReadonlyMap<string, readonly RuntimeModifierNode[]>;
  readonly constants: ReadonlyMap<string, number>;
  readonly supportsFastSummary: boolean;
}

export interface PreparedDicePlanInput {
  readonly normalized: NormalizedDiceInput;
}

const PLAN_PROGRAM = new WeakMap<RollPlan, CompiledDiceProgram>();

function saturatingAdd(left: number, right: number): number {
  return left >= MAX_SAFE_COST - right ? MAX_SAFE_COST : left + right;
}

function saturatingMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }
  return left > Math.floor(MAX_SAFE_COST / right) ? MAX_SAFE_COST : left * right;
}

function ensureFiniteConstant(value: number, input: string, span: SourceSpan): number {
  if (!Number.isFinite(value)) {
    throw new DiceRollError('Dice argument produced a non-finite result', {
      code: 'NON_FINITE_RESULT',
      input,
      span,
      details: { value: String(value) },
    });
  }
  const normalized = Number.isSafeInteger(value) ? value : Number(value.toPrecision(12));
  return Object.is(normalized, -0) ? 0 : normalized;
}

function readDiceInteger(
  node: ExpressionNode,
  input: string,
  argument: 'quantity' | 'sides',
  constants: ReadonlyMap<string, number>,
): number {
  const value = constants.get(node.id);
  if (value === undefined) {
    throw new DiceRollError('Dice arguments must be constant expressions', {
      code: 'INVALID_NOTATION',
      input,
      span: node.span,
      details: { argument, nodeKind: node.kind },
    });
  }
  const minimum = argument === 'sides' ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new DiceRollError(`Dice ${argument} must be a ${minimum === 0 ? 'non-negative' : 'positive'} safe integer`, {
      code: 'INVALID_NOTATION',
      input,
      span: node.span,
      details: { argument, value },
    });
  }
  return value;
}

function modifierOrder(modifier: RuntimeModifierNode): number {
  switch (modifier.kind) {
    case 'min': return 1;
    case 'max': return 2;
    case 'explode': return 3;
    case 'reroll': return 4;
    case 'unique': return 5;
    case 'keep': return 6;
    case 'drop': return 7;
    case 'target': return 8;
    case 'critical-success': return 9;
    case 'critical-failure': return 10;
    case 'sort': return 11;
  }
}

/** Returns the V3 modifier pipeline (last duplicate wins) without per-roll sorting. */
export function orderCompiledModifiers(
  modifiers: readonly RuntimeModifierNode[],
): readonly RuntimeModifierNode[] {
  const kinds = new Set<RuntimeModifierNode['kind']>();
  const deduplicated: RuntimeModifierNode[] = [];
  for (let index = modifiers.length - 1; index >= 0; index -= 1) {
    const modifier = modifiers[index];
    if (modifier !== undefined && !kinds.has(modifier.kind)) {
      kinds.add(modifier.kind);
      deduplicated.push(modifier);
    }
  }
  deduplicated.reverse();
  deduplicated.sort((left, right) => modifierOrder(left) - modifierOrder(right));
  return Object.freeze(deduplicated);
}

interface ResolvedDicePool {
  readonly quantity: number;
  readonly modifiers: readonly RuntimeModifierNode[];
  readonly stepDelta: bigint;
  readonly stepSpan: SourceSpan | null;
}

function invalidPoolTransformation(
  input: string,
  node: DiceNode,
  reason: 'conflicting-selection' | 'unsafe-pool-balance',
  details: Readonly<Record<string, number | string>>,
): never {
  throw new DiceRollError(
    reason === 'conflicting-selection'
      ? 'Pool advantage or disadvantage cannot be combined with keep or drop'
      : 'Pool transformation exceeds the safe dice quantity range',
    {
      code: 'UNSUPPORTED_NOTATION',
      input,
      span: node.span,
      details: { reason, ...details },
    },
  );
}

/**
 * Resolves structural pool conditions before the runtime modifier pipeline.
 *
 * Positive adjusted pools are physical dice quantities. Zero is the first
 * disadvantage level; each value below it adds another discarded high die.
 * Thus `0` rolls two dice and keeps the lowest one, `-1` rolls three, and so on.
 * Explicit `adv`/`dis` conditions add to the same signed selection balance.
 */
function resolveDicePool(node: DiceNode, baseQuantity: number, input: string): ResolvedDicePool {
  let adjustedPool = baseQuantity;
  let selectionBalance = 0;
  let structuralSpan: SourceSpan | null = null;
  let stepDelta = 0n;
  let stepSpan: SourceSpan | null = null;
  const runtimeModifiers: RuntimeModifierNode[] = [];

  for (const modifier of node.modifiers) {
    if (modifier.kind === 'pool-adjustment') {
      const nextPool = adjustedPool + modifier.delta;
      if (!Number.isSafeInteger(nextPool)) {
        return invalidPoolTransformation(input, node, 'unsafe-pool-balance', {
          baseQuantity,
          delta: modifier.delta,
        });
      }
      adjustedPool = nextPool;
      structuralSpan = modifier.span;
    } else if (modifier.kind === 'pool-selection') {
      selectionBalance += modifier.selection === 'highest' ? 1 : -1;
      structuralSpan = modifier.span;
    } else if (modifier.kind === 'dice-step') {
      stepDelta += BigInt(modifier.delta);
      stepSpan = stepSpan === null
        ? modifier.span
        : { start: stepSpan.start, end: modifier.span.end };
    } else {
      runtimeModifiers.push(modifier);
    }
  }

  const keptQuantity = Math.max(1, adjustedPool);
  const underflowDisadvantage = Math.min(0, adjustedPool - 1);
  const effectiveSelection = selectionBalance + underflowDisadvantage;
  const quantity = keptQuantity + Math.abs(effectiveSelection);
  if (!Number.isSafeInteger(quantity)) {
    return invalidPoolTransformation(input, node, 'unsafe-pool-balance', {
      adjustedPool,
      selectionBalance,
    });
  }

  if (effectiveSelection !== 0) {
    const conflicting = runtimeModifiers.find(
      (modifier) => modifier.kind === 'keep' || modifier.kind === 'drop',
    );
    if (conflicting !== undefined) {
      return invalidPoolTransformation(input, node, 'conflicting-selection', {
        modifier: conflicting.kind,
      });
    }
    const selectionSpan = structuralSpan as SourceSpan;
    runtimeModifiers.push({
      kind: 'keep',
      id: createNodeId('keep', selectionSpan),
      span: selectionSpan,
      selection: effectiveSelection > 0 ? 'highest' : 'lowest',
      quantity: keptQuantity,
    });
  }

  return { quantity, modifiers: runtimeModifiers, stepDelta, stepSpan };
}

function serializedStepDelta(delta: bigint): number | string {
  const numericDelta = Number(delta);
  return Number.isSafeInteger(numericDelta) ? numericDelta : delta.toString();
}

function invalidDiceStep(
  input: string,
  span: SourceSpan,
  reason: 'dice-step-out-of-range' | 'dice-step-non-standard-die',
  details: Readonly<Record<string, number | string>>,
): never {
  throw new DiceRollError(
    reason === 'dice-step-out-of-range'
      ? 'Dice step exceeds the supported side ladder'
      : 'Dice step requires a standard numeric die',
    {
      code: 'UNSUPPORTED_NOTATION',
      input,
      span,
      details: { reason, ...details },
    },
  );
}

function resolveSteppedSides(
  baseSides: number,
  delta: bigint,
  input: string,
  span: SourceSpan,
): number {
  if (delta === 0n) {
    return baseSides;
  }

  const candidates = delta > 0n
    ? DICE_STEP_LADDER.filter((sides) => sides > baseSides)
    : [...DICE_STEP_LADDER].reverse().filter((sides) => sides < baseSides);
  const distance = delta < 0n ? -delta : delta;
  if (distance > BigInt(candidates.length)) {
    return invalidDiceStep(input, span, 'dice-step-out-of-range', {
      baseSides,
      delta: serializedStepDelta(delta),
      ladderMinimum: MINIMUM_DICE_STEP_SIDE,
      ladderMaximum: MAXIMUM_DICE_STEP_SIDE,
    });
  }

  return candidates[Number(distance) - 1] as number;
}

function comparisonAlwaysMatchesRange(
  compare: ComparePointNode,
  minimum: number,
  maximum: number,
  integersOnly: boolean,
): boolean {
  switch (compare.operator) {
    case '=': return minimum === maximum && minimum === compare.value;
    case '!=':
    case '<>': return (integersOnly && !Number.isInteger(compare.value))
      || compare.value < minimum
      || compare.value > maximum;
    case '<': return maximum < compare.value;
    case '<=': return maximum <= compare.value;
    case '>': return minimum > compare.value;
    case '>=': return minimum >= compare.value;
  }
}

function comparisonCanMatchRange(
  compare: ComparePointNode,
  range: NumericRange,
): boolean {
  switch (compare.operator) {
    case '=': return (!range.integersOnly || Number.isInteger(compare.value))
      && compare.value >= range.minimum
      && compare.value <= range.maximum;
    case '!=':
    case '<>': return range.minimum !== range.maximum || range.minimum !== compare.value;
    case '<': return range.minimum < compare.value;
    case '<=': return range.minimum <= compare.value;
    case '>': return range.maximum > compare.value;
    case '>=': return range.maximum >= compare.value;
  }
}

function rangeCanMatch(
  range: NumericRange,
  compare: ComparePointNode | null,
  defaultValue: number,
): boolean {
  return compare === null
    ? defaultValue >= range.minimum
      && defaultValue <= range.maximum
      && (!range.integersOnly || Number.isInteger(defaultValue))
    : comparisonCanMatchRange(compare, range);
}

function rangeAlwaysMatches(
  range: NumericRange,
  compare: ComparePointNode | null,
  defaultValue: number,
): boolean {
  return compare === null
    ? range.minimum === range.maximum && range.minimum === defaultValue
    : comparisonAlwaysMatchesRange(
      compare,
      range.minimum,
      range.maximum,
      range.integersOnly,
    );
}

function applyLimitToRange(
  range: NumericRange,
  limit: number,
  clamp: (value: number, limit: number) => number,
): NumericRange {
  const minimum = clamp(range.minimum, limit);
  const maximum = clamp(range.maximum, limit);
  return minimum === range.minimum && maximum === range.maximum ? range : {
    minimum,
    maximum,
    integersOnly: range.integersOnly && Number.isInteger(limit),
  };
}

function valueMatches(
  value: number,
  compare: ComparePointNode | null,
  defaultValue: number,
): boolean {
  return compare === null
    ? value === defaultValue
    : compareValues(compare.operator, value, compare.value);
}

function enumerateFaceValues(
  minimum: number,
  maximum: number,
  possibleValues: number,
): ReadonlySet<number> | null {
  if (possibleValues > MAX_SEMANTIC_STATES) {
    return null;
  }
  const values = new Set<number>();
  for (let value = minimum; value <= maximum; value += 1) {
    values.add(value);
  }
  return values;
}

function mapValueSet(
  values: ReadonlySet<number> | null,
  transform: (value: number) => number,
): ReadonlySet<number> | null {
  if (values === null) {
    return null;
  }
  return new Set([...values].map(transform));
}

function unionValueSets(
  ...sets: ReadonlyArray<ReadonlySet<number> | null>
): ReadonlySet<number> | null {
  const result = new Set<number>();
  for (const values of sets) {
    if (values === null) {
      return null;
    }
    for (const value of values) {
      result.add(value);
      if (result.size > MAX_SEMANTIC_STATES) {
        return null;
      }
    }
  }
  return result;
}

function semanticAnalysisLimit(
  input: string,
  modifier: Extract<RuntimeModifierNode, { readonly kind: 'reroll' | 'unique' }>,
): never {
  throw new DiceRollError('Unsupported interaction', {
    code: 'UNSUPPORTED_NOTATION',
    input,
    span: modifier.span,
    details: { reason: 'semantic-analysis-limit' },
  });
}

function anyValueMatches(
  values: ReadonlySet<number>,
  compare: ComparePointNode | null,
  defaultValue: number,
): boolean {
  return [...values].some((value) => valueMatches(value, compare, defaultValue));
}

function everyValueMatches(
  values: ReadonlySet<number>,
  compare: ComparePointNode | null,
  defaultValue: number,
): boolean {
  return [...values].every((value) => valueMatches(value, compare, defaultValue));
}

function analyzeCompoundExplosionValues(
  rootValues: ReadonlySet<number> | null,
  rawValues: ReadonlySet<number> | null,
  modifier: Extract<RuntimeModifierNode, { readonly kind: 'explode' }>,
  maxExplosions: number,
  defaultMaximum: number,
  budget: SemanticAnalysisBudget,
): ReadonlySet<number> | null {
  if (rootValues === null || rawValues === null) {
    return null;
  }

  const outcomes = new Set<number>();
  let pending = new Set<number>();
  for (const rootValue of rootValues) {
    if (valueMatches(rootValue, modifier.compare, defaultMaximum)) {
      pending.add(rootValue);
    } else {
      outcomes.add(rootValue);
    }
  }
  for (let depth = 1; depth <= maxExplosions; depth += 1) {
    const nextPending = new Set<number>();
    for (const sum of pending) {
      for (const rawValue of rawValues) {
        budget.remainingTransitions -= 1;
        if (budget.remainingTransitions < 0) {
          return null;
        }
        const storedValue = modifier.penetrate ? rawValue - 1 : rawValue;
        const nextSum = sum + storedValue;
        if (
          depth === maxExplosions
          || !valueMatches(rawValue, modifier.compare, defaultMaximum)
        ) {
          outcomes.add(nextSum);
        } else {
          nextPending.add(nextSum);
        }
        if (outcomes.size + nextPending.size > MAX_SEMANTIC_STATES) {
          return null;
        }
      }
    }
    pending = nextPending;
    if (pending.size === 0) {
      break;
    }
  }

  return outcomes;
}

function validateGroupModifiers(node: Extract<ExpressionNode, { readonly kind: 'group' }>, input: string): void {
  for (const modifier of node.modifiers) {
    if (modifier.kind !== 'keep' && modifier.kind !== 'drop' && modifier.kind !== 'sort') {
      throw new DiceRollError(`Modifier ${modifier.kind} is not supported on roll groups`, {
        code: 'UNSUPPORTED_GROUP_MODIFIER',
        input,
        span: modifier.span,
        details: { modifier: modifier.kind },
      });
    }
  }
}

function createDiceSpec(
  node: DiceNode,
  input: string,
  limits: DiceLimits,
  constants: ReadonlyMap<string, number>,
  semanticBudget: SemanticAnalysisBudget,
): CompiledDiceSpec {
  const baseQuantity = readDiceInteger(node.quantity, input, 'quantity', constants);
  const resolvedPool = resolveDicePool(node, baseQuantity, input);
  const quantity = resolvedPool.quantity;
  let sides: DiceSides;
  let minimum: number;
  let maximum: number;
  let possibleFaces: number;
  if (node.diceKind === 'standard') {
    const baseSides = readDiceInteger(node.sides, input, 'sides', constants);
    const resolvedSides = resolveSteppedSides(
      baseSides,
      resolvedPool.stepDelta,
      input,
      resolvedPool.stepSpan ?? node.sides.span,
    );
    if (resolvedSides > limits.maxSides) {
      throw new DiceRollError('Dice sides exceed the configured limit', {
        code: 'DICE_SIDES_LIMIT_EXCEEDED',
        input,
        span: node.sides.span,
        details: { sides: resolvedSides, limit: limits.maxSides },
      });
    }
    sides = resolvedSides;
    minimum = resolvedSides === 0 ? 0 : 1;
    maximum = resolvedSides;
    possibleFaces = Math.max(1, resolvedSides);
  } else if (node.diceKind === 'percentile') {
    if (resolvedPool.stepDelta !== 0n) {
      invalidDiceStep(
        input,
        resolvedPool.stepSpan as SourceSpan,
        'dice-step-non-standard-die',
        {
          diceKind: node.diceKind,
          delta: serializedStepDelta(resolvedPool.stepDelta),
        },
      );
    }
    sides = 100;
    minimum = 1;
    maximum = 100;
    possibleFaces = 100;
  } else {
    if (resolvedPool.stepDelta !== 0n) {
      invalidDiceStep(
        input,
        resolvedPool.stepSpan as SourceSpan,
        'dice-step-non-standard-die',
        {
          diceKind: node.diceKind,
          delta: serializedStepDelta(resolvedPool.stepDelta),
        },
      );
    }
    sides = 'F';
    minimum = -1;
    maximum = 1;
    possibleFaces = 3;
  }

  const modifiers = orderCompiledModifiers(resolvedPool.modifiers);
  const cappedExplosionModifier = modifiers.find((modifier): modifier is Extract<
    RuntimeModifierNode,
    { readonly kind: 'explode' }
  > => modifier.kind === 'explode' && modifier.maxExplosions !== null) ?? null;
  const needsCappedSemanticAnalysis = cappedExplosionModifier !== null
    && modifiers.some((modifier) => (
      modifier.kind === 'reroll' && !modifier.once
    ) || (
      modifier.kind === 'unique'
      && !modifier.once
      && (!cappedExplosionModifier.compound || quantity > 1)
    ));
  const rawValues = needsCappedSemanticAnalysis
    ? enumerateFaceValues(minimum, maximum, possibleFaces)
    : null;
  const rawRange: NumericRange = { minimum, maximum, integersOnly: true };
  let rootValues = rawValues;
  let childValues: ReadonlySet<number> | null = rawValues === null ? null : new Set<number>();
  let rootRange = rawRange;
  let guaranteedActiveDice = quantity;
  const cappedExplosionRequiresAnalysis = needsCappedSemanticAnalysis;
  let unchangedMinimum = minimum;
  let unchangedMaximum = maximum;
  for (const modifier of modifiers) {
    switch (modifier.kind) {
      case 'min': {
        unchangedMinimum = Math.max(unchangedMinimum, Math.ceil(modifier.value));
        rootValues = mapValueSet(rootValues, (value) => Math.max(value, modifier.value));
        rootRange = applyLimitToRange(rootRange, modifier.value, Math.max);
        break;
      }
      case 'max': {
        unchangedMaximum = Math.min(unchangedMaximum, Math.floor(modifier.value));
        rootValues = mapValueSet(rootValues, (value) => Math.min(value, modifier.value));
        rootRange = applyLimitToRange(rootRange, modifier.value, Math.min);
        break;
      }
      case 'explode': {
        const maxExplosions = modifier.maxExplosions;
        const rawAlwaysExplodes = rangeAlwaysMatches(rawRange, modifier.compare, maximum);
        if (maxExplosions === null && rawAlwaysExplodes) {
          throw new DiceRollError('Explode modifier cannot terminate for this die', {
            code: 'NON_TERMINATING_MODIFIER',
            input,
            span: modifier.span,
            details: { reason: 'non-terminating-explode', minimum, maximum },
          });
        }
        if (maxExplosions === null) {
          break;
        }

        const rootCanExplode = rootValues === null
          ? rangeCanMatch(rootRange, modifier.compare, maximum)
          : anyValueMatches(rootValues, modifier.compare, maximum);
        if (modifier.compound) {
          if (!rootCanExplode) {
            break;
          }
          rootValues = analyzeCompoundExplosionValues(
            rootValues,
            rawValues,
            modifier,
            maxExplosions,
            maximum,
            semanticBudget,
          );
          childValues = rootValues === null ? null : new Set<number>();
          if (
            unchangedMinimum <= unchangedMaximum
            && (modifier.compare === null
              ? unchangedMinimum === unchangedMaximum && unchangedMinimum === maximum
              : comparisonAlwaysMatchesRange(
                modifier.compare,
                unchangedMinimum,
                unchangedMaximum,
                true,
              ))
          ) {
            unchangedMinimum = unchangedMaximum + 1;
          }
        } else {
          const penetration = modifier.penetrate ? 1 : 0;
          childValues = rootCanExplode
            ? mapValueSet(rawValues, (value) => value - penetration)
            : rootValues === null ? null : new Set<number>();
          const rootAlwaysExplodes = rootValues === null
            ? rangeAlwaysMatches(rootRange, modifier.compare, maximum)
            : everyValueMatches(rootValues, modifier.compare, maximum);
          if (rootAlwaysExplodes) {
            const guaranteedExplosions = rawAlwaysExplodes ? maxExplosions : 1;
            guaranteedActiveDice = saturatingAdd(
              guaranteedActiveDice,
              saturatingMultiply(quantity, guaranteedExplosions),
            );
          }
        }
        break;
      }
      case 'reroll': {
        const rawAlwaysRerolls = rangeAlwaysMatches(rawRange, modifier.compare, minimum);
        const currentValues = unionValueSets(rootValues, childValues);
        const cappedCurrentCanReroll = currentValues !== null
          && anyValueMatches(currentValues, modifier.compare, minimum);
        const shouldReject = !modifier.once && rawAlwaysRerolls && (
          !cappedExplosionRequiresAnalysis
          || cappedCurrentCanReroll
          || unchangedMinimum <= unchangedMaximum
        );
        if (shouldReject) {
          throw new DiceRollError('Reroll modifier cannot terminate for this die', {
            code: 'NON_TERMINATING_MODIFIER',
            input,
            span: modifier.span,
            details: { reason: 'non-terminating-reroll', minimum, maximum },
          });
        }
        if (
          !modifier.once
          && rawAlwaysRerolls
          && cappedExplosionRequiresAnalysis
          && currentValues === null
        ) {
          semanticAnalysisLimit(input, modifier);
        }
        if (cappedExplosionRequiresAnalysis && rawValues !== null) {
          if (
            rootValues !== null
            && anyValueMatches(rootValues, modifier.compare, minimum)
          ) {
            rootValues = unionValueSets(rootValues, rawValues);
          }
          if (
            childValues !== null
            && anyValueMatches(childValues, modifier.compare, minimum)
          ) {
            childValues = unionValueSets(childValues, rawValues);
          }
        }
        break;
      }
      case 'unique': {
        let impossibleQuantity: number | null = null;
        let uniqueValueCount: number | null = null;
        if (!modifier.once && cappedExplosionRequiresAnalysis && guaranteedActiveDice > 1) {
          if (rawValues === null || rootValues === null || childValues === null) {
            semanticAnalysisLimit(input, modifier);
          }
          const rootUniqueValues = unionValueSets(rootValues, rawValues);
          const guaranteedChildren = Math.max(0, guaranteedActiveDice - quantity);
          const childUniqueValues = unionValueSets(childValues, rawValues);
          const allUniqueValues = unionValueSets(rootValues, childValues, rawValues);
          if (
            rootUniqueValues === null
            || childUniqueValues === null
            || allUniqueValues === null
          ) {
            semanticAnalysisLimit(input, modifier);
          }
          if (
            quantity > rootUniqueValues.size
            && (
              modifier.compare === null
              || everyValueMatches(rootUniqueValues, modifier.compare, minimum)
            )
          ) {
            impossibleQuantity = quantity;
            uniqueValueCount = rootUniqueValues.size;
          } else if (
            guaranteedChildren > childUniqueValues.size
            && (
              modifier.compare === null
              || everyValueMatches(childUniqueValues, modifier.compare, minimum)
            )
          ) {
            impossibleQuantity = guaranteedChildren;
            uniqueValueCount = childUniqueValues.size;
          } else if (
            guaranteedActiveDice > allUniqueValues.size
            && (
              modifier.compare === null
              || everyValueMatches(allUniqueValues, modifier.compare, minimum)
            )
          ) {
            impossibleQuantity = guaranteedActiveDice;
            uniqueValueCount = allUniqueValues.size;
          }
        } else if (
          !modifier.once
          && !cappedExplosionRequiresAnalysis
          && quantity > possibleFaces
          && (
            modifier.compare === null
            || comparisonAlwaysMatchesRange(modifier.compare, minimum, maximum, true)
          )
        ) {
          impossibleQuantity = quantity;
          uniqueValueCount = possibleFaces;
        }

        if (impossibleQuantity !== null && uniqueValueCount !== null) {
          throw new DiceRollError('Unique modifier cannot produce enough distinct faces', {
            code: 'IMPOSSIBLE_UNIQUE',
            input,
            span: modifier.span,
            details: {
              reason: 'impossible-unique',
              quantity: impossibleQuantity,
              possibleFaces: uniqueValueCount,
            },
          });
        }
        break;
      }
      case 'target':
      case 'drop':
      case 'keep':
      case 'critical-success':
      case 'critical-failure':
      case 'sort':
        break;
    }
  }

  return Object.freeze({
    nodeId: node.id,
    quantity,
    sides,
    minimum,
    maximum,
    possibleFaces,
    modifiers,
  });
}

function expressionChildren(node: ExpressionNode): readonly ExpressionNode[] {
  switch (node.kind) {
    case 'number': return [];
    case 'unary': return [node.operand];
    case 'binary': return [node.left, node.right];
    case 'parenthesized': return [node.expression];
    case 'function': return node.arguments;
    case 'dice': return node.diceKind === 'standard'
      ? [node.quantity, node.sides]
      : [node.quantity];
    case 'group': return node.expressions;
  }
}

function buildPostOrder(root: ExpressionNode): {
  readonly nodes: readonly ExpressionNode[];
  readonly maxDepth: number;
} {
  const output: ExpressionNode[] = [];
  const pending: Array<{ readonly node: ExpressionNode; readonly depth: number; readonly visited: boolean }> = [
    { node: root, depth: 1, visited: false },
  ];
  let maxDepth = 1;
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    maxDepth = Math.max(maxDepth, current.depth);
    if (current.visited) {
      output.push(current.node);
      continue;
    }
    pending.push({ node: current.node, depth: current.depth, visited: true });
    const children = expressionChildren(current.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index] as ExpressionNode;
      pending.push({ node: child, depth: current.depth + 1, visited: false });
    }
  }
  return { nodes: Object.freeze(output), maxDepth };
}

function countedProgramChildren(node: CountedProgramNode): readonly CountedProgramNode[] {
  switch (node.kind) {
    case 'number':
    case 'compare-point':
    case 'drop':
    case 'keep':
    case 'min':
    case 'max':
    case 'sort':
    case 'pool-adjustment':
    case 'pool-selection':
    case 'dice-step': return [];
    case 'unary': return [node.operand];
    case 'binary': return [node.left, node.right];
    case 'parenthesized': return [node.expression];
    case 'function': return node.arguments;
    case 'dice': return node.diceKind === 'standard'
      ? [node.quantity, node.sides, ...node.modifiers]
      : [node.quantity, ...node.modifiers];
    case 'group': return [...node.expressions, ...node.modifiers];
    case 'explode':
    case 'reroll':
    case 'unique':
    case 'critical-success':
    case 'critical-failure': return node.compare === null ? [] : [node.compare];
    case 'target': return node.failure === null
      ? [node.success]
      : [node.success, node.failure];
  }
}

function measureProgram(root: ExpressionNode): { readonly nodeCount: number; readonly maxDepth: number } {
  const pending: Array<{ readonly node: CountedProgramNode; readonly depth: number }> = [
    { node: root, depth: 1 },
  ];
  let nodeCount = 0;
  let maxDepth = 1;
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    nodeCount += 1;
    maxDepth = Math.max(maxDepth, current.depth);
    const children = countedProgramChildren(current.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index] as CountedProgramNode;
      pending.push({ node: child, depth: current.depth + 1 });
    }
  }
  return { nodeCount, maxDepth };
}

function foldConstant(
  node: Exclude<ExpressionNode, DiceNode>,
  constants: ReadonlyMap<string, number>,
  input: string,
): number | null {
  const read = (child: ExpressionNode): number | null => constants.get(child.id) ?? null;
  switch (node.kind) {
    case 'number': return node.value;
    case 'group': return null;
    case 'unary': {
      const value = read(node.operand);
      return value === null ? null : node.operator === '-' ? -value : value;
    }
    case 'parenthesized': return read(node.expression);
    case 'binary': {
      const left = read(node.left);
      const right = read(node.right);
      if (left === null || right === null) {
        return null;
      }
      let result: number;
      switch (node.operator) {
        case '+': result = left + right; break;
        case '-': result = left - right; break;
        case '*': result = left * right; break;
        case '/': result = left / right; break;
        case '%': result = left % right; break;
        case '^':
        case '**': result = left ** right; break;
      }
      return ensureFiniteConstant(result, input, node.span);
    }
    case 'function': {
      const first = read(node.arguments[0]);
      if (first === null) {
        return null;
      }
      if (node.functionKind === 'unary') {
        let result: number;
        switch (node.name) {
          case 'abs': result = Math.abs(first); break;
          case 'ceil': result = Math.ceil(first); break;
          case 'cos': result = Math.cos(first); break;
          case 'exp': result = Math.exp(first); break;
          case 'floor': result = Math.floor(first); break;
          case 'log': result = Math.log(first); break;
          case 'round': result = Math.round(first); break;
          case 'sign': result = Math.sign(first); break;
          case 'sin': result = Math.sin(first); break;
          case 'sqrt': result = Math.sqrt(first); break;
          case 'tan': result = Math.tan(first); break;
        }
        return ensureFiniteConstant(result, input, node.span);
      }
      const second = read(node.arguments[1]);
      if (second === null) {
        return null;
      }
      let result: number;
      switch (node.name) {
        case 'max': result = Math.max(first, second); break;
        case 'min': result = Math.min(first, second); break;
        case 'pow': result = Math.pow(first, second); break;
      }
      return ensureFiniteConstant(result, input, node.span);
    }
  }
}

function hash32(value: string, seed: number): number {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

/** Stable 128-bit compiler fingerprint encoded as 32 lowercase hex characters. */
export function fingerprintDicePlan(value: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35] as const;
  return seeds.map((seed) => hash32(`dicecore:${DICE_COMPILER_VERSION}:${value}`, seed)
    .toString(16).padStart(8, '0')).join('');
}

function normalizeCompilerError(error: unknown, input: string): DiceRollError {
  if (isDiceRollError(error)) {
    if (error.input === input) {
      return error;
    }
    return new DiceRollError(error.message, {
      code: error.code,
      input,
      span: error.span,
      details: error.details,
    });
  }
  return new DiceRollError('Invalid dice notation', {
    code: 'INVALID_NOTATION',
    input,
    details: { cause: error instanceof Error ? error.message : 'Unknown parser error' },
  });
}

function validateNormalizedInput(parsed: NormalizedDiceInput, limits: DiceLimits): void {
  if (parsed.notation.length === 0) {
    throw new DiceRollError('Dice notation is required', {
      code: 'DICE_NOTATION_REQUIRED',
      input: parsed.input,
    });
  }
  if (!Number.isSafeInteger(parsed.rollCount) || parsed.rollCount < 1) {
    throw new DiceRollError('Roll count must be a positive safe integer', {
      code: 'INVALID_NOTATION',
      input: parsed.input,
      details: { rollCount: Number.isFinite(parsed.rollCount) ? parsed.rollCount : String(parsed.rollCount) },
    });
  }
  if (parsed.rollCount > limits.maxRolls) {
    throw new DiceRollError('Roll count exceeds the execution limit', {
      code: 'TOO_MANY_ROLLS',
      input: parsed.input,
      details: { rollCount: parsed.rollCount, limit: limits.maxRolls },
    });
  }
}

/** Normalizes and validates the input envelope before a program-cache lookup. */
export function prepareDicePlanInput(input: string, limits: DiceLimits): PreparedDicePlanInput {
  if (typeof input !== 'string') {
    throw new DiceRollError('Dice input must be a string', {
      code: 'INVALID_NOTATION',
      details: { receivedType: typeof input },
    });
  }
  const budget = new ExecutionBudget(limits);
  budget.assertInputLength(input);
  const normalized = parseNormalizedDiceInput(input);
  validateNormalizedInput(normalized, limits);
  return { normalized };
}

/** Compiles one normalized formula into a cacheable, input-comment-independent program. */
export function compileDiceProgram(
  notation: string,
  sourceInput: string,
  limits: DiceLimits,
): CompiledDiceProgram {
  let ast: ExpressionNode;
  try {
    ast = parseDiceNotation(notation, {
      maxDepth: limits.maxAstDepth,
      maxNodes: limits.maxAstNodes,
    });
  } catch (error: unknown) {
    throw normalizeCompilerError(error, sourceInput);
  }
  const traversal = buildPostOrder(ast);
  const metrics = measureProgram(ast);
  const diceSpecs = new Map<string, CompiledDiceSpec>();
  const groupModifiers = new Map<string, readonly RuntimeModifierNode[]>();
  const constants = new Map<string, number>();
  const semanticBudget: SemanticAnalysisBudget = {
    remainingTransitions: MAX_SEMANTIC_TRANSITIONS,
  };
  let staticDice = 0;
  let maximumSides = 0;
  let supportsFastSummary = true;
  for (const node of traversal.nodes) {
    if (node.kind === 'group') {
      supportsFastSummary &&= node.modifiers.length === 0;
      validateGroupModifiers(node, sourceInput);
      groupModifiers.set(
        node.id,
        orderCompiledModifiers(node.modifiers as readonly RuntimeModifierNode[]),
      );
    }
    if (node.kind === 'dice') {
      const spec = createDiceSpec(node, sourceInput, limits, constants, semanticBudget);
      // Modified pools must be the root to retain causal budget ordering.
      supportsFastSummary &&= spec.modifiers.length === 0 || (node === ast
        && spec.modifiers.length === 1
        && spec.modifiers.every(({ kind }) => ['min', 'max', 'keep', 'drop', 'target'].includes(kind)));
      diceSpecs.set(node.id, spec);
      staticDice = saturatingAdd(staticDice, spec.quantity);
      if (typeof spec.sides === 'number') {
        maximumSides = Math.max(maximumSides, spec.sides);
      }
    } else {
      const value = foldConstant(node, constants, sourceInput);
      if (value !== null) {
        constants.set(node.id, value);
      }
    }
  }
  return Object.freeze({
    compilerVersion: DICE_COMPILER_VERSION,
    notation,
    programFingerprint: fingerprintDicePlan(notation),
    ast,
    postOrder: traversal.nodes,
    nodeCount: metrics.nodeCount,
    maxDepth: metrics.maxDepth,
    staticDice,
    maximumSides,
    diceSpecs,
    groupModifiers,
    constants,
    supportsFastSummary,
  });
}

function validateProgramCaps(
  input: string,
  notation: string,
  rollCount: number,
  program: CompiledDiceProgram,
  limits: DiceLimits,
): void {
  if (program.notation !== notation) {
    throw new DiceRollError('Compiled program does not match normalized notation', {
      code: 'UNSUPPORTED_NOTATION',
      input,
    });
  }
  if (program.nodeCount > limits.maxAstNodes) {
    throw new DiceRollError('AST node count exceeds the execution limit', {
      code: 'TOO_MANY_NODES', input,
      details: { actual: program.nodeCount, limit: limits.maxAstNodes },
    });
  }
  if (program.maxDepth > limits.maxAstDepth) {
    throw new DiceRollError('AST depth exceeds the execution limit', {
      code: 'AST_TOO_DEEP', input,
      details: { actual: program.maxDepth, limit: limits.maxAstDepth },
    });
  }
  if (program.maximumSides > limits.maxSides) {
    throw new DiceRollError('Dice sides exceed the configured limit', {
      code: 'DICE_SIDES_LIMIT_EXCEEDED', input,
      details: { sides: program.maximumSides, limit: limits.maxSides },
    });
  }
  const totalInitialDice = saturatingMultiply(program.staticDice, rollCount);
  if (totalInitialDice > limits.maxInitialDice) {
    throw new DiceRollError('Initial dice count exceeds the execution limit', {
      code: 'TOO_MANY_INITIAL_DICE', input,
      details: { quantity: program.staticDice, rollCount, limit: limits.maxInitialDice },
    });
  }
}

function semanticChildren(node: ExpressionNode): readonly ExpressionNode[] {
  switch (node.kind) {
    case 'number':
    case 'dice': return [];
    case 'unary': return [node.operand];
    case 'binary': return [node.left, node.right];
    case 'parenthesized': return [node.expression];
    case 'function': return node.arguments;
    case 'group': return node.expressions;
  }
}

function planGroupKind(node: ExpressionNode): RollPlanGroup['kind'] {
  switch (node.kind) {
    case 'dice': return 'dice';
    case 'function': return 'function';
    case 'group': return 'group';
    case 'number':
    case 'unary':
    case 'binary':
    case 'parenthesized': return 'expression';
  }
}

function groupId(node: ExpressionNode): string {
  return `group:${node.id}`;
}

function createPlanGroups(root: ExpressionNode, notation: string): readonly RollPlanGroup[] {
  const groups: RollPlanGroup[] = [];
  const pending: ExpressionNode[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const children = semanticChildren(node);
    groups.push({
      id: groupId(node),
      sourceNodeId: node.id,
      kind: planGroupKind(node),
      notation: notation.slice(node.span.start, node.span.end),
      span: node.span,
      childIds: children.map(groupId),
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index] as ExpressionNode);
    }
  }
  return groups;
}

function modifierIterations(modifier: RuntimeModifierNode, limits: DiceLimits): number {
  switch (modifier.kind) {
    case 'explode': return modifier.maxExplosions === null
      ? limits.maxModifierSteps
      : Math.min(modifier.maxExplosions, limits.maxModifierSteps);
    case 'reroll':
    case 'unique': return modifier.once ? 1 : limits.maxModifierSteps;
    case 'target':
    case 'drop':
    case 'keep':
    case 'min':
    case 'max':
    case 'critical-success':
    case 'critical-failure':
    case 'sort': return 0;
  }
}

function createInspectionCost(program: CompiledDiceProgram, rollCount: number, limits: DiceLimits): DiceInspectionCost {
  let cost: CostAccumulator = { staticDice: 0, worstCaseGeneratedDice: 0, worstCaseRandomCalls: 0 };
  for (const spec of program.diceSpecs.values()) {
    let generatedDice = 0;
    let activeDice = spec.quantity;
    let randomCalls = spec.quantity;
    for (const modifier of spec.modifiers) {
      const iterations = modifierIterations(modifier, limits);
      if (modifier.kind === 'explode') {
        const generatedByExplosion = saturatingMultiply(spec.quantity, iterations);
        generatedDice = saturatingAdd(generatedDice, generatedByExplosion);
        randomCalls = saturatingAdd(randomCalls, generatedByExplosion);
        if (!modifier.compound) {
          activeDice = saturatingAdd(activeDice, generatedByExplosion);
        }
      } else if (modifier.kind === 'reroll') {
        randomCalls = saturatingAdd(
          randomCalls,
          saturatingMultiply(activeDice, iterations),
        );
      } else if (modifier.kind === 'unique') {
        randomCalls = saturatingAdd(
          randomCalls,
          saturatingMultiply(Math.max(0, activeDice - 1), iterations),
        );
      }
    }
    cost = {
      staticDice: saturatingAdd(cost.staticDice, spec.quantity),
      worstCaseGeneratedDice: saturatingAdd(
        cost.worstCaseGeneratedDice,
        generatedDice,
      ),
      worstCaseRandomCalls: saturatingAdd(
        cost.worstCaseRandomCalls,
        randomCalls,
      ),
    };
  }
  return {
    ...cost,
    totalStaticDice: saturatingMultiply(cost.staticDice, rollCount),
    totalWorstCaseGeneratedDice: saturatingMultiply(cost.worstCaseGeneratedDice, rollCount),
    totalWorstCaseRandomCalls: saturatingMultiply(cost.worstCaseRandomCalls, rollCount),
  };
}

/** Builds a public immutable plan around a known compiled program. */
export function compilePreparedDicePlan(
  prepared: PreparedDicePlanInput,
  limits: DiceLimits,
  program?: CompiledDiceProgram,
): RollPlan {
  const actualProgram = program ?? compileDiceProgram(
    prepared.normalized.notation,
    prepared.normalized.input,
    limits,
  );
  validateProgramCaps(
    prepared.normalized.input,
    prepared.normalized.notation,
    prepared.normalized.rollCount,
    actualProgram,
    limits,
  );
  const normalized = prepared.normalized;
  const plan = freezeRollPlan({
    type: 'roll-plan',
    schemaVersion: 3,
    compilerVersion: DICE_COMPILER_VERSION,
    planFingerprint: fingerprintDicePlan(normalized.normalizedNotation),
    input: normalized.input,
    comment: normalized.comment,
    notation: normalized.notation,
    normalizedNotation: normalized.normalizedNotation,
    isMultiRoll: normalized.isMultiRoll,
    rollCount: normalized.rollCount,
    groups: createPlanGroups(actualProgram.ast, normalized.notation),
    cost: createInspectionCost(actualProgram, normalized.rollCount, limits),
  });
  PLAN_PROGRAM.set(plan, actualProgram);
  return plan;
}

/** Compiles normalized dice notation exactly once into a validated, immutable V3 plan. */
export function compileDicePlan(input: string, limits: DiceLimits): RollPlan {
  try {
    const prepared = prepareDicePlanInput(input, limits);
    return compilePreparedDicePlan(prepared, limits);
  } catch (error: unknown) {
    throw normalizeCompilerError(error, typeof input === 'string' ? input : '');
  }
}

export function getPlanProgram(plan: RollPlan): CompiledDiceProgram {
  const program = PLAN_PROGRAM.get(plan);
  if (program === undefined) {
    throw new DiceRollError('Roll plan was not created by this compiler instance', {
      code: 'UNSUPPORTED_NOTATION',
      input: plan.input,
      details: { schemaVersion: plan.schemaVersion },
    });
  }
  return program;
}

export function hasPlanProgram(plan: RollPlan): boolean {
  return PLAN_PROGRAM.has(plan);
}

/** Revalidates a known immutable plan against lower per-call caps without recompiling it. */
export function validateKnownPlan(plan: RollPlan, limits: DiceLimits): void {
  const budget = new ExecutionBudget(limits);
  budget.assertInputLength(plan.input);
  if (plan.rollCount > limits.maxRolls) {
    throw new DiceRollError('Roll count exceeds the execution limit', {
      code: 'TOO_MANY_ROLLS', input: plan.input,
      details: { rollCount: plan.rollCount, limit: limits.maxRolls },
    });
  }
  validateProgramCaps(plan.input, plan.notation, plan.rollCount, getPlanProgram(plan), limits);
}

/** Returns the executable root associated with the compiled post-order IR. */
export function getPlanAst(plan: RollPlan): ExpressionNode {
  return getPlanProgram(plan).ast;
}

/** Inspects notation without throwing for ordinary validation failures. */
export function inspectDicePlan(input: string, limits: DiceLimits): DiceNotationInspection {
  try {
    const plan = compileDicePlan(input, limits);
    return {
      type: 'dice-notation-inspection', input, notation: plan.notation,
      normalizedNotation: plan.normalizedNotation, comment: plan.comment,
      isValid: true, plan, groups: plan.groups, cost: plan.cost, error: null,
    };
  } catch (error: unknown) {
    const safeInput = typeof input === 'string' ? input : '';
    let normalized: NormalizedDiceInput;
    try {
      normalized = parseNormalizedDiceInput(safeInput);
    } catch {
      normalized = {
        input: safeInput, comment: '', notation: '', normalizedNotation: '',
        rollCount: 1, isMultiRoll: false,
      };
    }
    return {
      type: 'dice-notation-inspection', input: safeInput,
      notation: normalized.notation, normalizedNotation: normalized.normalizedNotation,
      comment: normalized.comment, isValid: false, plan: null, groups: [], cost: null,
      error: normalizeCompilerError(error, safeInput),
    };
  }
}
