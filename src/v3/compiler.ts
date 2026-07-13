import { DiceRollError, isDiceRollError, type SourceSpan } from './errors.js';
import { freezeRollPlan } from './freeze.js';
import { parseNormalizedDiceInput, type NormalizedDiceInput } from './normalization.js';
import { ExecutionBudget } from './runtime/budget.js';
import type { DiceLimits } from './runtime/limits.js';
import {
  parseDiceNotation,
  type ComparePointNode,
  type DiceNode,
  type ExpressionNode,
  type ModifierNode,
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

interface CostAccumulator {
  readonly staticDice: number;
  readonly worstCaseGeneratedDice: number;
  readonly worstCaseRandomCalls: number;
}

type CountedProgramNode = ExpressionNode | ModifierNode | ComparePointNode;

export interface CompiledDiceSpec {
  readonly nodeId: string;
  readonly quantity: number;
  readonly sides: DiceSides;
  readonly minimum: number;
  readonly maximum: number;
  readonly possibleFaces: number;
  readonly modifiers: readonly ModifierNode[];
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
  readonly constants: ReadonlyMap<string, number>;
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

function readPositiveInteger(
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
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DiceRollError(`Dice ${argument} must be a positive safe integer`, {
      code: 'INVALID_NOTATION',
      input,
      span: node.span,
      details: { argument, value: Number.isFinite(value) ? value : String(value) },
    });
  }
  return value;
}

function modifierOrder(modifier: ModifierNode): number {
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
export function orderCompiledModifiers(modifiers: readonly ModifierNode[]): readonly ModifierNode[] {
  const kinds = new Set<ModifierNode['kind']>();
  const deduplicated: ModifierNode[] = [];
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

function comparisonAlwaysMatches(compare: ComparePointNode, minimum: number, maximum: number): boolean {
  switch (compare.operator) {
    case '=': return minimum === maximum && minimum === compare.value;
    case '!=':
    case '<>': return compare.value < minimum || compare.value > maximum;
    case '<': return maximum < compare.value;
    case '<=': return maximum <= compare.value;
    case '>': return minimum > compare.value;
    case '>=': return minimum >= compare.value;
  }
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
): CompiledDiceSpec {
  const quantity = readPositiveInteger(node.quantity, input, 'quantity', constants);
  let sides: DiceSides;
  let minimum: number;
  let maximum: number;
  let possibleFaces: number;
  if (node.diceKind === 'standard') {
    const resolvedSides = readPositiveInteger(node.sides, input, 'sides', constants);
    if (resolvedSides > limits.maxSides) {
      throw new DiceRollError('Dice sides exceed the configured limit', {
        code: 'DICE_SIDES_LIMIT_EXCEEDED',
        input,
        span: node.sides.span,
        details: { sides: resolvedSides, limit: limits.maxSides },
      });
    }
    sides = resolvedSides;
    minimum = 1;
    maximum = resolvedSides;
    possibleFaces = resolvedSides;
  } else if (node.diceKind === 'percentile') {
    sides = 100;
    minimum = 1;
    maximum = 100;
    possibleFaces = 100;
  } else {
    sides = 'F';
    minimum = -1;
    maximum = 1;
    possibleFaces = 3;
  }

  const modifiers = orderCompiledModifiers(node.modifiers);
  for (const modifier of modifiers) {
    if (modifier.kind === 'explode' && (
      modifier.compare === null
        ? minimum === maximum
        : comparisonAlwaysMatches(modifier.compare, minimum, maximum)
    )) {
      throw new DiceRollError('Explode modifier cannot terminate for this die', {
        code: 'NON_TERMINATING_MODIFIER',
        input,
        span: modifier.span,
        details: { reason: 'non-terminating-explode', minimum, maximum },
      });
    }
    if (modifier.kind === 'reroll' && !modifier.once && (
      modifier.compare === null
        ? minimum === maximum
        : comparisonAlwaysMatches(modifier.compare, minimum, maximum)
    )) {
      throw new DiceRollError('Reroll modifier cannot terminate for this die', {
        code: 'NON_TERMINATING_MODIFIER',
        input,
        span: modifier.span,
        details: { reason: 'non-terminating-reroll', minimum, maximum },
      });
    }
    if (modifier.kind === 'unique' && !modifier.once && quantity > possibleFaces
      && (modifier.compare === null || comparisonAlwaysMatches(modifier.compare, minimum, maximum))) {
      throw new DiceRollError('Unique modifier cannot produce enough distinct faces', {
        code: 'IMPOSSIBLE_UNIQUE',
        input,
        span: modifier.span,
        details: { reason: 'impossible-unique', quantity, possibleFaces },
      });
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
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    maxDepth = Math.max(maxDepth, current.depth);
    if (current.visited) {
      output.push(current.node);
      continue;
    }
    pending.push({ node: current.node, depth: current.depth, visited: true });
    const children = expressionChildren(current.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push({ node: child, depth: current.depth + 1, visited: false });
      }
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
    case 'sort': return [];
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
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    nodeCount += 1;
    maxDepth = Math.max(maxDepth, current.depth);
    const children = countedProgramChildren(current.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push({ node: child, depth: current.depth + 1 });
      }
    }
  }
  return { nodeCount, maxDepth };
}

function foldConstant(
  node: ExpressionNode,
  constants: ReadonlyMap<string, number>,
  input: string,
): number | null {
  const read = (child: ExpressionNode): number | null => constants.get(child.id) ?? null;
  switch (node.kind) {
    case 'number': return node.value;
    case 'dice':
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
  const constants = new Map<string, number>();
  let staticDice = 0;
  let maximumSides = 0;
  for (const node of traversal.nodes) {
    if (node.kind === 'group') {
      validateGroupModifiers(node, sourceInput);
    }
    if (node.kind === 'dice') {
      const spec = createDiceSpec(node, sourceInput, limits, constants);
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
    constants,
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
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      break;
    }
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
      const child = children[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return groups;
}

function modifierIterations(modifier: ModifierNode, limits: DiceLimits): number {
  switch (modifier.kind) {
    case 'explode': return limits.maxModifierSteps;
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
    let generatedIterations = 0;
    let randomIterations = 1;
    for (const modifier of spec.modifiers) {
      const iterations = modifierIterations(modifier, limits);
      randomIterations = saturatingAdd(randomIterations, iterations);
      if (modifier.kind === 'explode') {
        generatedIterations = saturatingAdd(generatedIterations, iterations);
      }
    }
    cost = {
      staticDice: saturatingAdd(cost.staticDice, spec.quantity),
      worstCaseGeneratedDice: saturatingAdd(
        cost.worstCaseGeneratedDice,
        saturatingMultiply(spec.quantity, generatedIterations),
      ),
      worstCaseRandomCalls: saturatingAdd(
        cost.worstCaseRandomCalls,
        saturatingMultiply(spec.quantity, randomIterations),
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

/** Kept while the executor transitions from the AST to the compiled IR. */
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
