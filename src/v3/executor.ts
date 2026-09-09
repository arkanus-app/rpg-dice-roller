import {
  getPlanProgram,
  type CompiledDiceProgram,
  type CompiledDiceSpec,
} from './compiler.js';
import { DiceRollError } from './errors.js';
import {
  compareValues,
  evaluateBinary,
  evaluateBinaryFunction,
  evaluateUnaryFunction,
  roundResult,
} from './math.js';
import { createExecutionContext, type ExecutionContext } from './runtime/context.js';
import type { DiceLimits } from './runtime/limits.js';
import type {
  RandomAlgorithm,
  SeedInput,
} from './runtime/replay.js';
import type {
  ComparePointNode,
  DiceNode,
  ExpressionNode,
  GroupNode,
  RuntimeModifierNode,
} from './syntax/index.js';
import type {
  DiceRollResult,
  DiceRollDetails,
  DiceRollSummary,
  DiceSides,
  DiceState,
  EntityRange,
  ExecutionStats,
  GroupState,
  PoolSummary,
  ResolvedDie,
  ResolvedGroup,
  ResolvedRoll,
  ResolvedRollSummary,
  RollPlan,
} from './types.js';

interface WorkingDie {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly parentDieId: string | null;
  readonly rollIndex: number;
  readonly groupId: string;
  readonly sides: DiceSides;
  readonly rawValue: number;
  value: number;
  contribution: number;
  included: boolean;
  active: boolean;
  readonly states: DiceState[];
}

interface Evaluation {
  readonly value: number;
  readonly rendered: string;
  readonly groupId: string;
  readonly diceRange: EntityRange;
}

interface GroupItem {
  readonly evaluation: Evaluation;
  value: number;
  included: boolean;
}

interface WorkingGroup {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly rollIndex: number;
  readonly kind: ResolvedGroup['kind'];
  readonly notation: string;
  readonly span: ResolvedGroup['span'];
  value: number;
  contribution: number;
  included: boolean;
  readonly states: GroupState[];
  readonly childIds: readonly string[];
}

interface RollState {
  readonly context: ExecutionContext;
  readonly plan: RollPlan;
  readonly program: CompiledDiceProgram;
  readonly rollIndex: number;
  readonly dice: WorkingDie[];
  readonly groups: WorkingGroup[];
  readonly groupById: Map<string, WorkingGroup>;
  readonly renderOutput: boolean;
  nextDieIndex: number;
}

export interface ExecuteRollPlanOptions {
  readonly limits: DiceLimits;
  readonly seed?: SeedInput;
  readonly replay?: unknown;
  readonly randomAlgorithm?: RandomAlgorithm;
}

type ExecutionMode = 'details' | 'full' | 'summary';

function resolvedGroupId(node: ExpressionNode, rollIndex: number): string {
  return `roll-${rollIndex}:group:${node.id}`;
}

function notationFor(state: RollState, node: ExpressionNode): string {
  return state.plan.notation.slice(node.span.start, node.span.end);
}

function appendState(die: WorkingDie, state: DiceState): void {
  if (!die.states.includes(state)) {
    die.states.push(state);
  }
}

function syncContribution(die: WorkingDie): void {
  die.contribution = die.active && die.included ? die.value : 0;
}

function compare(comparePoint: ComparePointNode, value: number): boolean {
  return compareValues(comparePoint.operator, value, comparePoint.value);
}

function rollFace(node: DiceNode, spec: CompiledDiceSpec, state: RollState): number {
  return rollCompiledFace(node, spec, state.context);
}

function rollCompiledFace(
  node: DiceNode,
  spec: CompiledDiceSpec,
  context: ExecutionContext,
): number {
  switch (node.diceKind) {
    case 'standard':
      return context.random.integer(spec.minimum, spec.maximum);
    case 'percentile':
      return context.random.integer(1, 100);
    case 'fudge':
      if (node.variant === 2) {
        return context.random.integer(1, 3) - 2;
      }
      {
        const value = context.random.integer(1, 6);
        return value === 1 ? -1 : value === 6 ? 1 : 0;
      }
  }
}

function createDie(
  node: DiceNode,
  spec: CompiledDiceSpec,
  state: RollState,
  parentDieId: string | null,
  generated: boolean,
): WorkingDie {
  if (generated) {
    state.context.budget.consumeGeneratedDice();
  } else {
    state.context.budget.consumeInitialDice();
  }
  state.context.budget.consumeResultItems();

  state.nextDieIndex += 1;
  const value = rollFace(node, spec, state);
  const die: WorkingDie = {
    id: `roll-${state.rollIndex}-die-${state.nextDieIndex}`,
    sourceNodeId: node.id,
    parentDieId,
    rollIndex: state.rollIndex,
    groupId: resolvedGroupId(node, state.rollIndex),
    sides: spec.sides,
    rawValue: value,
    value,
    contribution: value,
    included: true,
    active: true,
    states: [],
  };
  state.dice.push(die);
  state.context.journal.record({
    type: 'roll',
    subject: 'die',
    dieId: die.id,
    parentDieId,
    rollIndex: state.rollIndex,
    sourceNodeId: node.id,
    value,
  });
  return die;
}

function applyMinimum(dice: readonly WorkingDie[], minimum: number, state: RollState): void {
  for (const die of dice) {
    if (die.active && die.value < minimum) {
      const from = die.value;
      die.value = minimum;
      appendState(die, 'minimum');
      syncContribution(die);
      state.context.journal.record({
        type: 'transform',
        subject: 'die',
        dieId: die.id,
        parentDieId: die.parentDieId,
        rollIndex: state.rollIndex,
        sourceNodeId: die.sourceNodeId,
        from,
        to: die.value,
        reason: 'minimum',
      });
    }
  }
}

function applyMaximum(dice: readonly WorkingDie[], maximum: number, state: RollState): void {
  for (const die of dice) {
    if (die.active && die.value > maximum) {
      const from = die.value;
      die.value = maximum;
      appendState(die, 'maximum');
      syncContribution(die);
      state.context.journal.record({
        type: 'transform',
        subject: 'die',
        dieId: die.id,
        parentDieId: die.parentDieId,
        rollIndex: state.rollIndex,
        sourceNodeId: die.sourceNodeId,
        from,
        to: die.value,
        reason: 'maximum',
      });
    }
  }
}

function applyExplode(
  dice: WorkingDie[],
  modifier: Extract<RuntimeModifierNode, { readonly kind: 'explode' }>,
  node: DiceNode,
  spec: CompiledDiceSpec,
  state: RollState,
): void {
  const roots = dice.filter((die) => die.active);
  const defaultMaximum = spec.maximum;

  for (const root of roots) {
    let current = root;
    let compareValue = current.value;
    let explosionCount = 0;
    const chain: WorkingDie[] = [root];

    while (true) {
      if (modifier.maxExplosions !== null && explosionCount >= modifier.maxExplosions) {
        break;
      }
      const matches = modifier.compare === null
        ? compareValue === defaultMaximum
        : compare(modifier.compare, compareValue);
      if (!matches) {
        break;
      }
      state.context.budget.consumeModifierSteps();

      appendState(current, 'exploded');
      if (modifier.penetrate) {
        appendState(current, 'penetrated');
      }
      const child = createDie(node, spec, state, current.id, true);
      compareValue = child.value;
      if (modifier.penetrate) {
        const from = child.value;
        child.value -= 1;
        appendState(child, 'penetrated');
        syncContribution(child);
        state.context.journal.record({
          type: 'transform',
          subject: 'die',
          dieId: child.id,
          parentDieId: child.parentDieId,
          rollIndex: state.rollIndex,
          sourceNodeId: node.id,
          from,
          to: child.value,
          reason: 'penetrate',
        });
      }
      dice.push(child);
      chain.push(child);
      state.context.journal.record({
        type: 'explode',
        subject: 'die',
        dieId: current.id,
        parentDieId: current.parentDieId,
        rollIndex: state.rollIndex,
        sourceNodeId: node.id,
        childDieId: child.id,
        value: child.value,
        reason: modifier.penetrate ? 'penetrate' : modifier.compound ? 'compound' : 'explode',
      });
      current = child;
      explosionCount += 1;
    }

    if (modifier.compound && chain.length > 1) {
      const from = root.value;
      root.value = chain.reduce((total, die) => total + die.value, 0);
      appendState(root, 'compound');
      syncContribution(root);
      state.context.journal.record({
        type: 'transform',
        subject: 'die',
        dieId: root.id,
        parentDieId: root.parentDieId,
        rollIndex: state.rollIndex,
        sourceNodeId: node.id,
        from,
        to: root.value,
        reason: 'compound',
      });
      for (let index = 1; index < chain.length; index += 1) {
        const child = chain[index] as WorkingDie;
        child.active = false;
        child.included = false;
        syncContribution(child);
        state.context.journal.record({
          type: 'exclude',
          subject: 'die',
          dieId: child.id,
          parentDieId: child.parentDieId,
          rollIndex: state.rollIndex,
          sourceNodeId: node.id,
          reason: 'compound-absorbed',
        });
      }
    }
  }
}

function applyReroll(
  dice: readonly WorkingDie[],
  modifier: Extract<RuntimeModifierNode, { readonly kind: 'reroll' }>,
  node: DiceNode,
  spec: CompiledDiceSpec,
  state: RollState,
): void {
  const minimum = spec.minimum;

  for (const die of dice) {
    if (!die.active) {
      continue;
    }

    while (true) {
      const matches = modifier.compare === null
        ? die.value === minimum
        : compare(modifier.compare, die.value);
      if (!matches) {
        break;
      }
      state.context.budget.consumeModifierSteps();
      const from = die.value;
      const to = rollFace(node, spec, state);
      die.value = to;
      appendState(die, 'rerolled');
      syncContribution(die);
      state.context.journal.record({
        type: 'reroll',
        subject: 'die',
        dieId: die.id,
        parentDieId: die.parentDieId,
        rollIndex: state.rollIndex,
        sourceNodeId: node.id,
        from,
        to,
        reason: modifier.once ? 'reroll-once' : 'reroll',
      });
      if (modifier.once) {
        break;
      }
    }
  }
}

function applyUnique(
  dice: readonly WorkingDie[],
  modifier: Extract<RuntimeModifierNode, { readonly kind: 'unique' }>,
  node: DiceNode,
  spec: CompiledDiceSpec,
  state: RollState,
): void {
  const active = dice.filter((die) => die.active);
  const seenValues = new Set<number>();

  for (const die of active) {

    while (true) {
      const duplicate = seenValues.has(die.value);
      const matchesCompare = modifier.compare === null || compare(modifier.compare, die.value);
      if (!duplicate || !matchesCompare) {
        break;
      }
      state.context.budget.consumeModifierSteps();
      const from = die.value;
      const to = rollFace(node, spec, state);
      die.value = to;
      appendState(die, 'unique-rerolled');
      syncContribution(die);
      state.context.journal.record({
        type: 'reroll',
        subject: 'die',
        dieId: die.id,
        parentDieId: die.parentDieId,
        rollIndex: state.rollIndex,
        sourceNodeId: node.id,
        from,
        to,
        reason: modifier.once ? 'unique-once' : 'unique',
      });
      if (modifier.once) {
        break;
      }
    }
    seenValues.add(die.value);
  }
}

function indexesToExclude(
  values: readonly { readonly value: number }[],
  kind: 'keep' | 'drop',
  selection: 'lowest' | 'highest',
  quantity: number,
): readonly number[] {
  const ranked = values
    .map((value, index) => ({ index, value: value.value }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const boundary = selection === 'lowest' ? quantity : Math.max(0, ranked.length - quantity);
  // Selection is a contiguous range in ranked order. Its complement is the
  // other range, so keep does not need a Set or another membership traversal.
  const excludePrefix = (selection === 'lowest') === (kind === 'drop');
  return (excludePrefix ? ranked.slice(0, boundary) : ranked.slice(boundary))
    .map((entry) => entry.index);
}

function applySelection(
  dice: readonly WorkingDie[],
  modifier: Extract<RuntimeModifierNode, { readonly kind: 'drop' | 'keep' }>,
  state: RollState,
): void {
  const active = dice.filter((die) => die.active);
  const excluded = indexesToExclude(
    active,
    modifier.kind,
    modifier.selection,
    modifier.quantity,
  );

  for (const index of excluded) {
    const die = active[index];
    if (die === undefined || !die.included) {
      continue;
    }
    die.included = false;
    appendState(die, 'dropped');
    syncContribution(die);
    state.context.journal.record({
      type: 'exclude',
      subject: 'die',
      dieId: die.id,
      parentDieId: die.parentDieId,
      rollIndex: state.rollIndex,
      sourceNodeId: die.sourceNodeId,
      reason: modifier.kind,
    });
  }
}

function applyTarget(
  dice: readonly WorkingDie[],
  modifier: Extract<RuntimeModifierNode, { readonly kind: 'target' }>,
  state: RollState,
): void {
  for (const die of dice) {
    if (!die.active) {
      continue;
    }
    let outcome: 'success' | 'failure' | 'neutral';
    if (compare(modifier.success, die.value)) {
      outcome = 'success';
      appendState(die, 'target-success');
      die.contribution = die.included ? 1 : 0;
    } else if (modifier.failure !== null && compare(modifier.failure, die.value)) {
      outcome = 'failure';
      appendState(die, 'target-failure');
      die.contribution = die.included ? -1 : 0;
    } else {
      outcome = 'neutral';
      appendState(die, 'target-neutral');
      die.contribution = 0;
    }
    state.context.journal.record({
      type: 'classify',
      subject: 'die',
      dieId: die.id,
      parentDieId: die.parentDieId,
      rollIndex: state.rollIndex,
      sourceNodeId: die.sourceNodeId,
      outcome,
    });
  }
}

function applyCritical(
  dice: readonly WorkingDie[],
  modifier: Extract<RuntimeModifierNode, {
    readonly kind: 'critical-success' | 'critical-failure';
  }>,
  spec: CompiledDiceSpec,
  state: RollState,
): void {
  const defaultValue = modifier.kind === 'critical-success'
    ? spec.maximum
    : spec.minimum;
  for (const die of dice) {
    if (
      die.active
      && (modifier.compare === null
        ? die.value === defaultValue
        : compare(modifier.compare, die.value))
    ) {
      appendState(die, modifier.kind);
      state.context.journal.record({
        type: 'classify',
        subject: 'die',
        dieId: die.id,
        parentDieId: die.parentDieId,
        rollIndex: state.rollIndex,
        sourceNodeId: die.sourceNodeId,
        outcome: modifier.kind,
      });
    }
  }
}

function applyDiceModifiers(
  dice: WorkingDie[],
  modifiers: readonly RuntimeModifierNode[],
  node: DiceNode,
  spec: CompiledDiceSpec,
  state: RollState,
): readonly WorkingDie[] {
  let displayOrder: readonly WorkingDie[] = dice;

  // Dice pipelines are deduplicated and ordered once by the compiler.
  for (const modifier of modifiers) {
    switch (modifier.kind) {
      case 'min':
        applyMinimum(dice, modifier.value, state);
        break;
      case 'max':
        applyMaximum(dice, modifier.value, state);
        break;
      case 'explode':
        applyExplode(dice, modifier, node, spec, state);
        break;
      case 'reroll':
        applyReroll(dice, modifier, node, spec, state);
        break;
      case 'unique':
        applyUnique(dice, modifier, node, spec, state);
        break;
      case 'keep':
      case 'drop':
        applySelection(dice, modifier, state);
        break;
      case 'target':
        applyTarget(dice, modifier, state);
        break;
      case 'critical-success':
      case 'critical-failure':
        applyCritical(dice, modifier, spec, state);
        break;
      case 'sort':
        displayOrder = dice.slice().sort((left, right) => (
          modifier.direction === 'ascending'
            ? left.value - right.value
            : right.value - left.value
        ));
        break;
    }
  }
  return displayOrder;
}

function addResolvedGroup(
  node: ExpressionNode,
  state: RollState,
  value: number,
  childIds: readonly string[],
  states: readonly GroupState[] = [],
): string {
  const id = resolvedGroupId(node, state.rollIndex);
  const kind: ResolvedGroup['kind'] = node.kind === 'dice'
    ? 'dice'
    : node.kind === 'function' ? 'function' : node.kind === 'group' ? 'group' : 'expression';
  const group: WorkingGroup = {
    id,
    sourceNodeId: node.id,
    rollIndex: state.rollIndex,
    kind,
    notation: notationFor(state, node),
    span: node.span,
    value,
    contribution: value,
    included: true,
    states: states.slice(),
    childIds,
  };
  state.context.budget.consumeResolvedGroups();
  state.context.budget.consumeResultItems();
  state.groups.push(group);
  state.groupById.set(id, group);
  return id;
}

function evaluateDice(node: DiceNode, state: RollState): Evaluation {
  const spec = state.program.diceSpecs.get(node.id);
  if (spec === undefined) {
    throw new DiceRollError('Compiled dice specification is missing', {
      code: 'UNSUPPORTED_NOTATION',
      input: state.plan.input,
      span: node.span,
      details: { nodeId: node.id },
    });
  }
  const start = state.dice.length;
  const dice: WorkingDie[] = [];
  for (let index = 0; index < spec.quantity; index += 1) {
    dice.push(createDie(node, spec, state, null, false));
  }
  const orderedDice = applyDiceModifiers(dice, spec.modifiers, node, spec, state);
  const value = roundResult(dice.reduce((total, die) => total + die.contribution, 0));
  const groupId = addResolvedGroup(node, state, value, orderedDice.map((die) => die.id));
  return {
    value,
    rendered: state.renderOutput ? `[${orderedDice.map((die) => die.value).join(', ')}]` : '',
    groupId,
    diceRange: { start, count: state.dice.length - start },
  };
}

function excludeGroupTree(groupId: string, state: RollState, reason: 'drop' | 'keep'): void {
  const group = state.groupById.get(groupId);
  if (group === undefined || !group.included) {
    return;
  }
  group.included = false;
  group.contribution = 0;
  group.states.push('dropped');
  state.context.journal.record({
    type: 'exclude',
    subject: 'group',
    groupId: group.id,
    rollIndex: state.rollIndex,
    sourceNodeId: group.sourceNodeId,
    reason,
    value: group.value,
  });
  for (const childId of group.childIds) {
    if (state.groupById.has(childId)) {
      excludeGroupTree(childId, state, reason);
    }
  }
}

function excludeEvaluationDice(item: GroupItem, state: RollState, reason: 'drop' | 'keep'): void {
  item.included = false;
  excludeGroupTree(item.evaluation.groupId, state, reason);
  const end = item.evaluation.diceRange.start + item.evaluation.diceRange.count;
  for (let index = item.evaluation.diceRange.start; index < end; index += 1) {
    const die = state.dice[index] as WorkingDie;
    if (!die.included) {
      continue;
    }
    die.included = false;
    appendState(die, 'dropped');
    syncContribution(die);
    state.context.journal.record({
      type: 'exclude',
      subject: 'die',
      dieId: die.id,
      parentDieId: die.parentDieId,
      rollIndex: state.rollIndex,
      sourceNodeId: die.sourceNodeId,
      reason,
    });
  }
}

function applyGroupModifiers(
  items: GroupItem[],
  modifiers: readonly RuntimeModifierNode[],
  state: RollState,
): readonly GroupItem[] {
  let displayOrder: readonly GroupItem[] = items;

  for (const modifier of modifiers) {
    switch (modifier.kind) {
      case 'keep':
      case 'drop': {
        const excluded = indexesToExclude(
          items,
          modifier.kind,
          modifier.selection,
          modifier.quantity,
        );
        for (const index of excluded) {
          const item = items[index];
          if (item !== undefined && item.included) {
            excludeEvaluationDice(item, state, modifier.kind);
          }
        }
        break;
      }
      case 'min':
      case 'max':
      case 'target':
      case 'critical-success':
      case 'critical-failure':
      case 'explode':
      case 'reroll':
      case 'unique':
        throw new DiceRollError(`Modifier ${modifier.kind} is not supported on roll groups`, {
          code: 'UNSUPPORTED_GROUP_MODIFIER',
          input: state.plan.input,
          span: modifier.span,
          details: { modifier: modifier.kind },
        });
      case 'sort':
        displayOrder = items.slice().sort((left, right) => (
          modifier.direction === 'ascending'
            ? left.value - right.value
            : right.value - left.value
        ));
        break;
    }
  }
  return displayOrder;
}

function evaluateGroup(node: GroupNode, state: RollState): Evaluation {
  const diceStart = state.dice.length;
  const items: GroupItem[] = node.expressions.map((expression) => {
    const evaluation = evaluateNode(expression, state);
    return { evaluation, value: evaluation.value, included: true };
  });
  const modifiers = state.program.groupModifiers.get(node.id);
  if (modifiers === undefined) {
    throw new DiceRollError('Compiled group modifier pipeline is missing', {
      code: 'UNSUPPORTED_NOTATION',
      input: state.plan.input,
      span: node.span,
      details: { nodeId: node.id },
    });
  }
  const orderedItems = applyGroupModifiers(items, modifiers, state);
  const value = roundResult(items.reduce(
    (total, item) => total + (item.included ? item.value : 0),
    0,
  ));
  const originalChildIds = items.map((item) => item.evaluation.groupId);
  const childIds = orderedItems.map((item) => item.evaluation.groupId);
  const sortModifier = modifiers.find((modifier) => modifier.kind === 'sort');
  const groupStates: readonly GroupState[] = sortModifier === undefined
    ? []
    : [sortModifier.direction === 'ascending' ? 'sorted-ascending' : 'sorted-descending'];
  const groupId = addResolvedGroup(node, state, value, childIds, groupStates);
  if (sortModifier !== undefined) {
    state.context.journal.record({
      type: 'transform',
      subject: 'group',
      groupId,
      rollIndex: state.rollIndex,
      sourceNodeId: node.id,
      from: originalChildIds,
      to: childIds,
      reason: sortModifier.direction === 'ascending' ? 'sort-ascending' : 'sort-descending',
    });
  }
  return {
    value,
    rendered: state.renderOutput
      ? `{${orderedItems.map((item) => item.evaluation.rendered).join(', ')}}`
      : '',
    groupId,
    diceRange: { start: diceStart, count: state.dice.length - diceStart },
  };
}

function evaluateNode(node: ExpressionNode, state: RollState): Evaluation {
  switch (node.kind) {
    case 'number': {
      const groupId = addResolvedGroup(node, state, node.value, []);
      return {
        value: node.value,
        rendered: state.renderOutput ? node.raw : '',
        groupId,
        diceRange: { start: state.dice.length, count: 0 },
      };
    }
    case 'unary': {
      const operand = evaluateNode(node.operand, state);
      const value = node.operator === '-' ? -operand.value : operand.value;
      const groupId = addResolvedGroup(
        node,
        state,
        value,
        [operand.groupId],
      );
      return {
        value,
        rendered: state.renderOutput ? `${node.operator}${operand.rendered}` : '',
        groupId,
        diceRange: operand.diceRange,
      };
    }
    case 'binary': {
      const left = evaluateNode(node.left, state);
      const right = evaluateNode(node.right, state);
      const value = evaluateBinary(
        node.operator === '**' ? '^' : node.operator,
        left.value,
        right.value,
        state.plan.input,
      );
      const childIds = [left.groupId, right.groupId];
      const groupId = addResolvedGroup(node, state, value, childIds);
      return {
        value,
        rendered: state.renderOutput ? `${left.rendered}${node.operator}${right.rendered}` : '',
        groupId,
        diceRange: {
          start: left.diceRange.start,
          count: left.diceRange.count + right.diceRange.count,
        },
      };
    }
    case 'parenthesized': {
      const expression = evaluateNode(node.expression, state);
      const groupId = addResolvedGroup(
        node,
        state,
        expression.value,
        [expression.groupId],
      );
      return {
        value: expression.value,
        rendered: state.renderOutput ? `(${expression.rendered})` : '',
        groupId,
        diceRange: expression.diceRange,
      };
    }
    case 'function': {
      if (node.functionKind === 'unary') {
        const argument = evaluateNode(node.arguments[0], state);
        const value = evaluateUnaryFunction(node.name, argument.value, state.plan.input);
        const groupId = addResolvedGroup(
          node,
          state,
          value,
          [argument.groupId],
        );
        return {
          value,
          rendered: state.renderOutput ? `${node.name}(${argument.rendered})` : '',
          groupId,
          diceRange: argument.diceRange,
        };
      }
      const left = evaluateNode(node.arguments[0], state);
      const right = evaluateNode(node.arguments[1], state);
      const value = evaluateBinaryFunction(node.name, left.value, right.value, state.plan.input);
      const childIds = [left.groupId, right.groupId];
      const groupId = addResolvedGroup(node, state, value, childIds);
      return {
        value,
        rendered: state.renderOutput ? `${node.name}(${left.rendered},${right.rendered})` : '',
        groupId,
        diceRange: {
          start: left.diceRange.start,
          count: left.diceRange.count + right.diceRange.count,
        },
      };
    }
    case 'dice':
      return evaluateDice(node, state);
    case 'group':
      return evaluateGroup(node, state);
  }
}

function finalizeDice(state: RollState, materialize: boolean): readonly ResolvedDie[] {
  const resolved: ResolvedDie[] = [];
  for (const [index, die] of state.dice.entries()) {
    if (die.active && die.included) {
      state.context.journal.record({
        type: 'include',
        subject: 'die',
        dieId: die.id,
        parentDieId: die.parentDieId,
        rollIndex: die.rollIndex,
        sourceNodeId: die.sourceNodeId,
        contribution: die.contribution,
      });
    }
    if (materialize) {
      resolved.push({
      id: die.id,
      sourceNodeId: die.sourceNodeId,
      parentDieId: die.parentDieId,
      rollIndex: die.rollIndex,
      rollDieIndex: index + 1,
      groupId: die.groupId,
      sides: die.sides,
      rawValue: die.rawValue,
      value: die.value,
      contribution: die.contribution,
      included: die.included && die.active,
      states: die.states.slice(),
      });
    }
  }
  return resolved;
}

function finalizeGroups(state: RollState, materialize: boolean): readonly ResolvedGroup[] {
  const resolved: ResolvedGroup[] = [];
  for (const group of state.groups) {
    if (group.included) {
      state.context.journal.record({
        type: 'include',
        subject: 'group',
        groupId: group.id,
        rollIndex: group.rollIndex,
        sourceNodeId: group.sourceNodeId,
        value: group.value,
        contribution: group.contribution,
      });
    }
    if (materialize) {
      resolved.push({
        id: group.id,
        sourceNodeId: group.sourceNodeId,
        rollIndex: group.rollIndex,
        kind: group.kind,
        notation: group.notation,
        span: group.span,
        value: group.value,
        contribution: group.contribution,
        included: group.included,
        states: group.states.slice(),
        childIds: group.childIds,
      });
    }
  }
  return resolved;
}

function buildPool(dice: readonly WorkingDie[]): PoolSummary | null {
  let targeted = false;
  let successes = 0;
  let failures = 0;
  for (const die of dice) {
    const success = die.states.includes('target-success');
    const failure = die.states.includes('target-failure');
    if (success || failure || die.states.includes('target-neutral')) {
      targeted = true;
    }
    if (die.active && die.included && success) {
      successes += 1;
    } else if (die.active && die.included && failure) {
      failures += 1;
    }
  }
  if (!targeted) {
    return null;
  }
  return { successes, failures, netSuccesses: successes - failures };
}

function aggregatePool(rolls: readonly { readonly pool: PoolSummary | null }[]): PoolSummary | null {
  let hasPool = false;
  let successes = 0;
  let failures = 0;
  for (const roll of rolls) {
    if (roll.pool !== null) {
      hasPool = true;
      successes += roll.pool.successes;
      failures += roll.pool.failures;
    }
  }
  if (!hasPool) {
    return null;
  }
  return { successes, failures, netSuccesses: successes - failures };
}

function formatAggregateOutput(
  outputs: readonly string[],
  total: number,
  context: ExecutionContext,
): string {
  if (outputs.length === 1) {
    const output = outputs[0] as string;
    context.budget.assertOutputLength(output.length);
    return output;
  }
  const totalLine = `Total: ${total}`;
  let outputLength = totalLine.length;
  for (const [index, output] of outputs.entries()) {
    outputLength += String(index + 1).length + 2 + output.length + 1;
  }
  context.budget.assertOutputLength(outputLength);
  return [
    ...outputs.map((output, index) => `${index + 1}. ${output}`),
    totalLine,
  ].join('\n');
}

function createContext(
  plan: RollPlan,
  options: ExecuteRollPlanOptions,
  materializeEvents: boolean,
): ExecutionContext {
  if (options.replay !== undefined) {
    return createExecutionContext({
      resolvedLimits: options.limits,
      replay: options.replay,
      planFingerprint: plan.planFingerprint,
      collectEvents: materializeEvents,
    });
  }
  if (options.seed !== undefined) {
    return createExecutionContext({
      resolvedLimits: options.limits,
      seed: options.seed,
      planFingerprint: plan.planFingerprint,
      ...(options.randomAlgorithm === undefined
        ? {}
        : { randomAlgorithm: options.randomAlgorithm }),
      collectEvents: materializeEvents,
    });
  }
  return createExecutionContext({
    resolvedLimits: options.limits,
    planFingerprint: plan.planFingerprint,
    ...(options.randomAlgorithm === undefined
      ? {}
      : { randomAlgorithm: options.randomAlgorithm }),
    collectEvents: materializeEvents,
  });
}

function toExecutionStats(context: ExecutionContext): ExecutionStats {
  const snapshot = context.budget.snapshot();
  return {
    rolls: snapshot.rolls,
    initialDice: snapshot.initialDice,
    generatedDice: snapshot.generatedDice,
    randomCalls: snapshot.randomCalls,
    modifierSteps: snapshot.modifierSteps,
    events: snapshot.events,
    resolvedGroups: snapshot.resolvedGroups,
    resultItems: snapshot.resultItems,
  };
}

function consumeSummaryEvent(context: ExecutionContext, count = 1): void {
  context.budget.consumeEvents(count);
  context.budget.consumeResultItems(count);
}

function finishSummaryGroup(context: ExecutionContext): void {
  context.budget.consumeResolvedGroups();
  context.budget.consumeResultItems();
  consumeSummaryEvent(context);
}

type SummaryModifier = Extract<RuntimeModifierNode, { readonly kind: 'keep' | 'drop' | 'min' | 'max' | 'target' }>;

function evaluateModifiedSummary(
  node: DiceNode,
  spec: CompiledDiceSpec,
  modifier: SummaryModifier,
  context: ExecutionContext,
): { readonly total: number; readonly pool: PoolSummary | null } {
  const values: number[] = [];
  for (let index = 0; index < spec.quantity; index += 1) {
    context.budget.consumeInitialDice();
    context.budget.consumeResultItems();
    values.push(rollCompiledFace(node, spec, context));
    consumeSummaryEvent(context);
  }
  let total = 0;
  let included = values.length;
  let pool: PoolSummary | null = null;
  if (modifier.kind === 'keep' || modifier.kind === 'drop') {
    const selected = Math.min(modifier.quantity, values.length);
    included = modifier.kind === 'keep' ? selected : values.length - selected;
    const sum = values.reduce((accumulator, value) => accumulator + value, 0);
    if (selected === values.length) {
      total = modifier.kind === 'keep' ? sum : 0;
    } else if (selected === 1) {
      // Only the extremum's value matters in summary mode, including ties.
      let extreme = values[0] as number;
      for (const value of values) {
        extreme = modifier.selection === 'highest'
          ? Math.max(extreme, value) : Math.min(extreme, value);
      }
      total = modifier.kind === 'keep' ? extreme : sum - extreme;
    } else {
      values.sort((left, right) => left - right);
      const start = modifier.selection === 'lowest' ? 0 : values.length - selected;
      let selectedTotal = 0;
      for (let index = start; index < start + selected; index += 1) {
        selectedTotal += values[index] as number;
      }
      total = modifier.kind === 'keep' ? selectedTotal : sum - selectedTotal;
    }
    for (let index = included; index < values.length; index += 1) {
      consumeSummaryEvent(context);
    }
  } else {
    let successes = 0;
    let failures = 0;
    for (const value of values) {
      if (modifier.kind === 'target') {
        if (compare(modifier.success, value)) {
          successes += 1;
        } else if (modifier.failure !== null && compare(modifier.failure, value)) {
          failures += 1;
        }
        consumeSummaryEvent(context);
      } else {
        const transformed = modifier.kind === 'min' ? Math.max(value, modifier.value)
          : Math.min(value, modifier.value);
        if (transformed !== value) {
          consumeSummaryEvent(context);
        }
        total += transformed;
      }
    }
    if (modifier.kind === 'target') {
      total = successes - failures;
      pool = { successes, failures, netSuccesses: total };
    }
  }
  // Match addResolvedGroup -> finalizeDice -> finalizeGroups, including the
  // first failing counter when several per-call budgets are exhausted.
  context.budget.consumeResolvedGroups();
  context.budget.consumeResultItems();
  for (let index = 0; index < included; index += 1) {
    consumeSummaryEvent(context);
  }
  consumeSummaryEvent(context);
  return { total: roundResult(total), pool };
}

function evaluateFastSummaryNode(
  node: ExpressionNode,
  program: CompiledDiceProgram,
  context: ExecutionContext,
  input: string,
): number {
  let value: number;
  switch (node.kind) {
    case 'number':
      value = node.value;
      break;
    case 'unary': {
      const operand = evaluateFastSummaryNode(node.operand, program, context, input);
      value = node.operator === '-' ? -operand : operand;
      break;
    }
    case 'binary':
      value = evaluateBinary(
        node.operator === '**' ? '^' : node.operator,
        evaluateFastSummaryNode(node.left, program, context, input),
        evaluateFastSummaryNode(node.right, program, context, input),
        input,
      );
      break;
    case 'parenthesized':
      value = evaluateFastSummaryNode(node.expression, program, context, input);
      break;
    case 'function':
      if (node.functionKind === 'unary') {
        value = evaluateUnaryFunction(
          node.name,
          evaluateFastSummaryNode(node.arguments[0], program, context, input),
          input,
        );
      } else {
        value = evaluateBinaryFunction(
          node.name,
          evaluateFastSummaryNode(node.arguments[0], program, context, input),
          evaluateFastSummaryNode(node.arguments[1], program, context, input),
          input,
        );
      }
      break;
    case 'dice': {
      const spec = program.diceSpecs.get(node.id);
      if (spec === undefined) {
        throw new DiceRollError('Compiled dice specification is missing', {
          code: 'UNSUPPORTED_NOTATION',
          input,
          span: node.span,
          details: { nodeId: node.id },
        });
      }
      let total = 0;
      for (let index = 0; index < spec.quantity; index += 1) {
        context.budget.consumeInitialDice();
        context.budget.consumeResultItems();
        total += rollCompiledFace(node, spec, context);
        // One roll and one final inclusion event per die.
        consumeSummaryEvent(context, 2);
      }
      value = roundResult(total);
      break;
    }
    case 'group': {
      let total = 0;
      for (const expression of node.expressions) {
        total += evaluateFastSummaryNode(expression, program, context, input);
      }
      value = roundResult(total);
      break;
    }
  }
  finishSummaryGroup(context);
  return value;
}

function executeFastSummary(
  plan: RollPlan,
  program: CompiledDiceProgram,
  options: ExecuteRollPlanOptions,
): DiceRollSummary {
  const context = createContext(plan, options, false);
  context.budget.consumeRolls(plan.rollCount);
  const rolls: ResolvedRollSummary[] = [];
  const spec = program.ast.kind === 'dice' ? program.diceSpecs.get(program.ast.id) : undefined;
  const modifier = spec?.modifiers[0];
  for (let rollIndex = 1; rollIndex <= plan.rollCount; rollIndex += 1) {
    context.budget.consumeResultItems();
    if (program.ast.kind === 'dice' && spec !== undefined && modifier !== undefined) {
      // The compiler certifies this pipeline when supportsFastSummary is true.
      const result = evaluateModifiedSummary(program.ast, spec, modifier as SummaryModifier, context);
      rolls.push({ index: rollIndex, ...result });
      continue;
    }
    rolls.push({
      index: rollIndex,
      total: roundResult(evaluateFastSummaryNode(
        program.ast,
        program,
        context,
        plan.input,
      )),
      pool: null,
    });
  }
  const summary: DiceRollSummary = {
    type: 'dice-roll-summary',
    schemaVersion: 3,
    input: plan.input,
    notation: plan.notation,
    normalizedNotation: plan.normalizedNotation,
    comment: plan.comment,
    total: roundResult(rolls.reduce((sum, roll) => sum + roll.total, 0)),
    replay: context.replay,
    stats: toExecutionStats(context),
    rolls,
    pool: aggregatePool(rolls),
  };
  if (modifier !== undefined) {
    // Preserve the general executor's JSON key order for existing replays.
    const { type, rolls: rollViews, pool, ...base } = summary;
    return { ...base, pool, type, rolls: rollViews };
  }
  return summary;
}

function execute(plan: RollPlan, options: ExecuteRollPlanOptions, mode: 'full'): DiceRollResult;
function execute(plan: RollPlan, options: ExecuteRollPlanOptions, mode: 'details'): DiceRollDetails;
function execute(plan: RollPlan, options: ExecuteRollPlanOptions, mode: 'summary'): DiceRollSummary;
function execute(
  plan: RollPlan,
  options: ExecuteRollPlanOptions,
  mode: ExecutionMode,
): DiceRollDetails | DiceRollResult | DiceRollSummary {
  const full = mode === 'full';
  const materializeDice = mode !== 'summary';
  const program = getPlanProgram(plan);
  if (mode === 'summary' && program.supportsFastSummary) {
    return executeFastSummary(plan, program, options);
  }
  const context = createContext(plan, options, full);
  context.budget.consumeRolls(plan.rollCount);
  const ast = program.ast;
  const dice: ResolvedDie[] = [];
  const groups: ResolvedGroup[] = [];
  const rolls: ResolvedRoll[] = [];
  const rollSummaries: ResolvedRollSummary[] = [];
  const outputs: string[] = [];

  for (let rollIndex = 1; rollIndex <= plan.rollCount; rollIndex += 1) {
    context.budget.consumeResultItems();
    const eventStart = context.journal.length;
    const diceStart = dice.length;
    const groupStart = groups.length;
    const state: RollState = {
      context,
      plan,
      program,
      rollIndex,
      dice: [],
      groups: [],
      groupById: new Map(),
      renderOutput: full,
      nextDieIndex: 0,
    };
    const evaluation = evaluateNode(ast, state);
    const total = roundResult(evaluation.value);
    const resolvedDice = finalizeDice(state, materializeDice);
    const resolvedGroups = finalizeGroups(state, full);
    const pool = buildPool(state.dice);
    if (materializeDice) {
      dice.push(...resolvedDice);
    }
    if (full) {
      groups.push(...resolvedGroups);
      const rollOutputLength = plan.notation.length + 2 + evaluation.rendered.length
        + 3 + String(total).length;
      context.budget.assertOutputLength(rollOutputLength);
      outputs.push(`${plan.notation}: ${evaluation.rendered} = ${total}`);
      rolls.push({
        index: rollIndex,
        total,
        pool,
        diceRange: { start: diceStart, count: resolvedDice.length },
        groupRange: { start: groupStart, count: resolvedGroups.length },
        eventRange: { start: eventStart, count: context.journal.length - eventStart },
      });
    } else {
      rollSummaries.push({ index: rollIndex, total, pool });
    }
  }

  const events = context.journal.toArray();
  const rollViews = full ? rolls : rollSummaries;
  const total = roundResult(rollViews.reduce((sum, roll) => sum + roll.total, 0));
  const base = {
    schemaVersion: 3 as const,
    input: plan.input,
    notation: plan.notation,
    normalizedNotation: plan.normalizedNotation,
    comment: plan.comment,
    total,
    replay: context.replay,
    stats: toExecutionStats(context),
    pool: aggregatePool(rollViews),
  };
  if (!full) {
    return mode === 'details'
      ? { ...base, type: 'dice-roll-details', rolls: rollSummaries, dice }
      : { ...base, type: 'dice-roll-summary', rolls: rollSummaries };
  }
  const output = formatAggregateOutput(outputs, total, context);
  return {
    ...base,
    type: 'dice-roll',
    output,
    rolls,
    groups,
    dice,
    events,
  };
}

export function executeRollPlanDetails(
  plan: RollPlan,
  options: ExecuteRollPlanOptions,
): DiceRollDetails {
  return execute(plan, options, 'details');
}

export function executeRollPlan(
  plan: RollPlan,
  options: ExecuteRollPlanOptions,
): DiceRollResult {
  return execute(plan, options, 'full');
}

export function executeRollPlanSummary(
  plan: RollPlan,
  options: ExecuteRollPlanOptions,
): DiceRollSummary {
  return execute(plan, options, 'summary');
}
