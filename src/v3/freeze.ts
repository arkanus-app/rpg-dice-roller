import type {
  DiceEvent,
  DiceRollResult,
  DiceRollSummary,
  ResolvedDie,
  ResolvedGroup,
  ResolvedRoll,
  ResolvedRollSummary,
  RollPlan,
  RollPlanGroup,
} from './types.js';

function freezeDie(die: ResolvedDie): void {
  Object.freeze(die.states);
  Object.freeze(die);
}

function freezeEvent(event: DiceEvent): void {
  if (event.type === 'transform' && event.subject === 'group') {
    Object.freeze(event.from);
    Object.freeze(event.to);
  }
  Object.freeze(event);
}

function freezeGroup(group: ResolvedGroup): void {
  Object.freeze(group.span);
  Object.freeze(group.states);
  Object.freeze(group.childIds);
  Object.freeze(group);
}

function freezePool(pool: ResolvedRoll['pool']): void {
  if (pool !== null) {
    Object.freeze(pool);
  }
}

function freezeRoll(roll: ResolvedRoll): void {
  Object.freeze(roll.diceRange);
  Object.freeze(roll.groupRange);
  Object.freeze(roll.eventRange);
  freezePool(roll.pool);
  Object.freeze(roll);
}

function freezeRollSummary(roll: ResolvedRollSummary): void {
  freezePool(roll.pool);
  Object.freeze(roll);
}

function freezePlanGroup(group: RollPlanGroup): void {
  Object.freeze(group.span);
  Object.freeze(group.childIds);
  Object.freeze(group);
}

export function freezeRollPlan(plan: RollPlan): RollPlan {
  plan.groups.forEach(freezePlanGroup);
  Object.freeze(plan.groups);
  Object.freeze(plan.cost);
  return Object.freeze(plan);
}

export function freezeDiceRollResult(result: DiceRollResult): DiceRollResult {
  result.rolls.forEach(freezeRoll);
  result.dice.forEach(freezeDie);
  result.groups.forEach(freezeGroup);
  result.events.forEach(freezeEvent);
  Object.freeze(result.rolls);
  Object.freeze(result.dice);
  Object.freeze(result.groups);
  Object.freeze(result.events);
  Object.freeze(result.replay);
  Object.freeze(result.stats);
  freezePool(result.pool);
  return Object.freeze(result);
}

export function freezeDiceRollSummary(result: DiceRollSummary): DiceRollSummary {
  result.rolls.forEach(freezeRollSummary);
  Object.freeze(result.rolls);
  Object.freeze(result.replay);
  Object.freeze(result.stats);
  freezePool(result.pool);
  return Object.freeze(result);
}

export function shouldFreezeResults(mode: 'development' | 'always' | 'never'): boolean {
  if (mode === 'always') {
    return true;
  }
  if (mode === 'never') {
    return false;
  }
  const maybeProcess = globalThis as typeof globalThis & {
    readonly process?: { readonly env?: { readonly NODE_ENV?: string } };
  };
  return maybeProcess.process?.env?.NODE_ENV === 'development';
}
