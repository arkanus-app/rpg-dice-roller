import DiceRoll from './DiceRoll.js';
import Parser from './parser/Parser.js';
import { engines, generator, type NumberGeneratorEngine } from './utilities/NumberGenerator.js';
import {
  cleanRpgDiceNotation,
  extractRpgDiceComment,
  normalizeRpgDiceNotation,
} from './rpg/normalization.js';
import {
  RpgDiceRollError,
  type RpgDiceRollErrorCode,
  type RpgDiceRollErrorDetails,
  type RpgDiceRollErrorOptions,
} from './rpg/errors.js';

const multiRollPattern = /^(\d+)#/;
const diceGroupPattern = /(\d*)d(\d+|%|F)/gi;

export const DEFAULT_MAX_TOTAL_DICE = 9999;
export const DEFAULT_MAX_MULTI_ROLLS = 100;

export interface RpgDiceRollOptions {
  maxDice?: number;
  maxRolls?: number;
  seed?: number | string;
}

export {
  cleanRpgDiceNotation,
  extractRpgDiceComment,
  normalizeRpgDiceNotation,
  RpgDiceRollError,
};
export type { RpgDiceRollErrorCode, RpgDiceRollErrorDetails, RpgDiceRollErrorOptions };

export interface RpgDiceInput {
  input: string;
  comment: string;
  cleanedNotation: string;
  normalizedNotation: string;
  notation: string;
  isMultiRoll: boolean;
  rollCount: number;
}

export interface RpgDiceGroup {
  index: number;
  qty: number;
  sides: number | 'F';
  notation: string;
}

export interface RpgDiceDetail {
  id: string;
  index: number;
  rollIndex: number;
  rollDieIndex: number;
  groupIndex: number | null;
  groupPath: number[];
  groupRollIndex: number | null;
  group: RpgDiceGroup | null;
  sides: number | 'F' | null;
  groupNotation: string | null;
  value: number;
  initialValue: number;
  calculationValue: number;
  modifierFlags: string;
  modifiers: string[];
  useInTotal: boolean;
  wasDropped: boolean;
  wasExploded: boolean;
  wasRerolled: boolean;
  wasCriticalSuccess: boolean;
  wasCriticalFailure: boolean;
  sourceId: string | null;
  modifierReasons: string[];
}

export type RpgDiceRollEventType =
  | 'roll'
  | 'explode'
  | 'reroll'
  | 'drop'
  | 'critical-success'
  | 'critical-failure';

export interface RpgDiceRollEvent {
  id: string;
  type: RpgDiceRollEventType;
  rollIndex: number;
  dieIndex: number;
  rollDieIndex: number;
  groupIndex: number | null;
  groupPath: number[];
  value: number;
  initialValue: number;
  useInTotal: boolean;
  modifiers: string[];
  reason: string | null;
}

export interface RpgDiceInspectionCost {
  staticDiceCount: number;
  worstCaseDiceCount: number;
  worstCaseRollAttempts: number;
  totalStaticDice: number;
  totalWorstCaseDice: number;
  totalWorstCaseRollAttempts: number;
}

export interface RpgDiceNotationInspection {
  type: 'rpg-dice-inspection';
  input: string;
  comment: string;
  notation: string;
  normalizedNotation: string;
  isMultiRoll: boolean;
  rollCount: number;
  groups: RpgDiceGroup[];
  cost: RpgDiceInspectionCost;
  isValid: boolean;
  error: RpgDiceRollError | null;
}

export interface RpgDiceRollSnapshot {
  notation: string;
  output: string;
  rolls: unknown[];
  total: number;
}

export interface RpgDiceRollEntry {
  index: number;
  notation: string;
  total: number;
  output: string;
  dice: RpgDiceDetail[];
  events: RpgDiceRollEvent[];
  roll: RpgDiceRollSnapshot;
}

export interface RpgDiceRollResult {
  type: 'rpg-dice-roll';
  input: string;
  comment: string;
  notation: string;
  normalizedNotation: string;
  total: number;
  output: string;
  isMultiRoll: boolean;
  rollCount: number;
  dice: RpgDiceDetail[];
  events: RpgDiceRollEvent[];
  rolls: RpgDiceRollEntry[];
}

interface DiceRollInstance {
  notation: string;
  output: string;
  rolls: unknown[];
  total: number;
}

interface RollResultLike {
  value: number;
  initialValue?: number;
  calculationValue?: number;
  modifierFlags?: string;
  modifiers?: unknown;
  useInTotal?: boolean;
}

/**
 * Parses raw RPG dice input into normalized notation and platform-neutral metadata.
 */
export function parseRpgDiceInput(input: string): RpgDiceInput {
  const originalInput = String(input ?? '');
  const normalizedNotation = normalizeRpgDiceNotation(originalInput);
  const multiRollMatch = multiRollPattern.exec(normalizedNotation);
  const rollCount = multiRollMatch ? Number.parseInt(multiRollMatch[1], 10) : 1;
  const notation = multiRollMatch
    ? normalizedNotation.replace(multiRollPattern, '')
    : normalizedNotation;

  return {
    input: originalInput,
    comment: extractRpgDiceComment(originalInput),
    cleanedNotation: cleanRpgDiceNotation(originalInput),
    normalizedNotation,
    notation,
    isMultiRoll: Boolean(multiRollMatch),
    rollCount,
  };
}

/**
 * Lists static dice groups in notation order.
 */
export function extractRpgDiceGroups(notation: string): RpgDiceGroup[] {
  const groups: RpgDiceGroup[] = [];
  const normalizedNotation = normalizeRpgDiceNotation(notation).replace(multiRollPattern, '');

  diceGroupPattern.lastIndex = 0;
  let match = diceGroupPattern.exec(normalizedNotation);

  while (match) {
    const qty = Math.max(0, Number.parseInt(match[1] || '1', 10));
    let sides: RpgDiceGroup['sides'];

    if (match[2] === '%') {
      sides = 100;
    } else if (match[2].toUpperCase() === 'F') {
      sides = 'F';
    } else {
      sides = Number.parseInt(match[2], 10);
    }

    groups.push({
      index: groups.length,
      qty,
      sides,
      notation: match[0],
    });

    match = diceGroupPattern.exec(normalizedNotation);
  }

  return groups;
}

/**
 * Counts static dice in a notation string.
 */
export function countRpgDiceInNotation(notation: string): number {
  return extractRpgDiceGroups(notation)
    .reduce((total, group) => total + group.qty, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object') && (value !== null);
}

function resolveLimit(value: number | undefined, fallback: number): number {
  const numericValue = Number(value ?? fallback);

  if (!Number.isFinite(numericValue) || (numericValue < 0)) {
    return fallback;
  }

  return Math.floor(numericValue);
}

function getObjectNumber(value: unknown, property: string): number | null {
  if (!isRecord(value)) {
    return null;
  }

  const numericValue = value[property];
  return (typeof numericValue === 'number' && Number.isFinite(numericValue)) ? numericValue : null;
}

function getObjectModifiers(value: unknown): unknown[] {
  if (!isRecord(value) || !(value.modifiers instanceof Map)) {
    return [];
  }

  return [...value.modifiers.values()];
}

function getModifierName(modifier: unknown): string {
  return isRecord(modifier) && (typeof modifier.name === 'string') ? modifier.name : '';
}

function getModifierMaxIterations(modifier: unknown): number {
  const maxIterations = getObjectNumber(modifier, 'maxIterations');
  return maxIterations ?? 0;
}

function isExecutionModifier(modifierName: string): boolean {
  return ['explode', 're-roll', 'unique'].includes(modifierName);
}

function addCosts(
  left: RpgDiceInspectionCost,
  right: RpgDiceInspectionCost,
): RpgDiceInspectionCost {
  return {
    staticDiceCount: left.staticDiceCount + right.staticDiceCount,
    worstCaseDiceCount: left.worstCaseDiceCount + right.worstCaseDiceCount,
    worstCaseRollAttempts: left.worstCaseRollAttempts + right.worstCaseRollAttempts,
    totalStaticDice: left.totalStaticDice + right.totalStaticDice,
    totalWorstCaseDice: left.totalWorstCaseDice + right.totalWorstCaseDice,
    totalWorstCaseRollAttempts: left.totalWorstCaseRollAttempts + right.totalWorstCaseRollAttempts,
  };
}

function emptyCost(): RpgDiceInspectionCost {
  return {
    staticDiceCount: 0,
    worstCaseDiceCount: 0,
    worstCaseRollAttempts: 0,
    totalStaticDice: 0,
    totalWorstCaseDice: 0,
    totalWorstCaseRollAttempts: 0,
  };
}

function countParsedExpressionCost(expressions: unknown[]): RpgDiceInspectionCost {
  return expressions.reduce<RpgDiceInspectionCost>((total, expression) => {
    if (Array.isArray(expression)) {
      return addCosts(total, countParsedExpressionCost(expression));
    }

    const quantity = getObjectNumber(expression, 'qty');
    if (quantity !== null) {
      const modifiers = getObjectModifiers(expression);
      const explodeModifier = modifiers
        .find((modifier) => getModifierName(modifier) === 'explode');
      const explodeMultiplier = explodeModifier ? 1 + getModifierMaxIterations(explodeModifier) : 1;
      const executionMultiplier = modifiers
        .filter((modifier) => isExecutionModifier(getModifierName(modifier)))
        .reduce<number>(
          (multiplier, modifier) => multiplier + getModifierMaxIterations(modifier),
          1,
        );
      const safeQuantity = Math.max(0, quantity);

      return addCosts(total, {
        ...emptyCost(),
        staticDiceCount: safeQuantity,
        worstCaseDiceCount: safeQuantity * explodeMultiplier,
        worstCaseRollAttempts: safeQuantity * executionMultiplier,
      });
    }

    if (isRecord(expression) && Array.isArray(expression.expressions)) {
      return addCosts(total, countParsedExpressionCost(expression.expressions));
    }

    return total;
  }, emptyCost());
}

function multiplyCost(cost: RpgDiceInspectionCost, rollCount: number): RpgDiceInspectionCost {
  return {
    staticDiceCount: cost.staticDiceCount,
    worstCaseDiceCount: cost.worstCaseDiceCount,
    worstCaseRollAttempts: cost.worstCaseRollAttempts,
    totalStaticDice: cost.staticDiceCount * rollCount,
    totalWorstCaseDice: cost.worstCaseDiceCount * rollCount,
    totalWorstCaseRollAttempts: cost.worstCaseRollAttempts * rollCount,
  };
}

function parseNotationForValidation(notation: string): unknown[] {
  return Parser.parse(notation) as unknown[];
}

function createInvalidNotationError(parsedInput: RpgDiceInput, error: unknown): RpgDiceRollError {
  return new RpgDiceRollError('Invalid notation', {
    code: 'INVALID_NOTATION',
    input: parsedInput.input,
    notation: parsedInput.notation,
    normalizedNotation: parsedInput.normalizedNotation,
    details: {
      cause: error instanceof Error ? error.message : String(error),
    },
  });
}

function inspectParsedInput(
  parsedInput: RpgDiceInput,
  options: RpgDiceRollOptions,
): RpgDiceNotationInspection {
  const maxDice = resolveLimit(options.maxDice, DEFAULT_MAX_TOTAL_DICE);
  const maxRolls = resolveLimit(options.maxRolls, DEFAULT_MAX_MULTI_ROLLS);
  const groups = extractRpgDiceGroups(parsedInput.notation);

  let cost = multiplyCost(emptyCost(), parsedInput.rollCount);

  if (!parsedInput.notation) {
    throw new RpgDiceRollError('Dice notation is required', {
      code: 'DICE_NOTATION_REQUIRED',
      input: parsedInput.input,
      notation: parsedInput.notation,
      normalizedNotation: parsedInput.normalizedNotation,
    });
  }

  if (parsedInput.rollCount > maxRolls) {
    throw new RpgDiceRollError('Too many rolls', {
      code: 'TOO_MANY_ROLLS',
      input: parsedInput.input,
      notation: parsedInput.notation,
      normalizedNotation: parsedInput.normalizedNotation,
      limit: maxRolls,
      details: {
        rollCount: parsedInput.rollCount,
      },
    });
  }

  const staticDiceCount = countRpgDiceInNotation(parsedInput.notation);
  const totalStaticDice = staticDiceCount * parsedInput.rollCount;
  cost = {
    ...cost,
    staticDiceCount,
    totalStaticDice,
  };

  if (totalStaticDice > maxDice) {
    throw new RpgDiceRollError('Too many dice', {
      code: 'TOO_MANY_DICE',
      input: parsedInput.input,
      notation: parsedInput.notation,
      normalizedNotation: parsedInput.normalizedNotation,
      limit: maxDice,
      details: {
        rollCount: parsedInput.rollCount,
        staticDiceCount,
        totalStaticDice,
      },
    });
  }

  let parsedExpressions: unknown[];
  try {
    parsedExpressions = parseNotationForValidation(parsedInput.notation);
  } catch (error) {
    throw createInvalidNotationError(parsedInput, error);
  }

  cost = multiplyCost(countParsedExpressionCost(parsedExpressions), parsedInput.rollCount);

  if (cost.totalWorstCaseDice > maxDice) {
    throw new RpgDiceRollError('Too many dice', {
      code: 'TOO_MANY_DICE',
      input: parsedInput.input,
      notation: parsedInput.notation,
      normalizedNotation: parsedInput.normalizedNotation,
      limit: maxDice,
      details: {
        rollCount: parsedInput.rollCount,
        ...cost,
      },
    });
  }

  if (cost.totalWorstCaseRollAttempts > maxDice) {
    throw new RpgDiceRollError('Roll execution limit exceeded', {
      code: 'ROLL_EXECUTION_LIMIT',
      input: parsedInput.input,
      notation: parsedInput.notation,
      normalizedNotation: parsedInput.normalizedNotation,
      limit: maxDice,
      details: {
        rollCount: parsedInput.rollCount,
        ...cost,
      },
    });
  }

  return {
    type: 'rpg-dice-inspection',
    input: parsedInput.input,
    comment: parsedInput.comment,
    notation: parsedInput.notation,
    normalizedNotation: parsedInput.normalizedNotation,
    isMultiRoll: parsedInput.isMultiRoll,
    rollCount: parsedInput.rollCount,
    groups,
    cost,
    isValid: true,
    error: null,
  };
}

function ensureRpgDiceInputLimits(
  parsedInput: RpgDiceInput,
  options: RpgDiceRollOptions,
): RpgDiceNotationInspection {
  return inspectParsedInput(parsedInput, options);
}

export function inspectRpgDiceNotation(
  input: string,
  options: RpgDiceRollOptions = {},
): RpgDiceNotationInspection {
  const parsedInput = parseRpgDiceInput(input);

  try {
    return inspectParsedInput(parsedInput, options);
  } catch (error) {
    const inspectionError = error instanceof RpgDiceRollError
      ? error
      : createInvalidNotationError(parsedInput, error);

    return {
      type: 'rpg-dice-inspection',
      input: parsedInput.input,
      comment: parsedInput.comment,
      notation: parsedInput.notation,
      normalizedNotation: parsedInput.normalizedNotation,
      isMultiRoll: parsedInput.isMultiRoll,
      rollCount: parsedInput.rollCount,
      groups: extractRpgDiceGroups(parsedInput.notation),
      cost: multiplyCost(emptyCost(), parsedInput.rollCount),
      isValid: false,
      error: inspectionError,
    };
  }
}

function getRollChildren(value: unknown): unknown[] | null {
  if (!isRecord(value)) {
    return null;
  }

  if (Array.isArray(value.rolls)) {
    return value.rolls;
  }

  if (Array.isArray(value.results)) {
    return value.results;
  }

  return null;
}

function isRollResultLike(value: unknown): value is RollResultLike {
  return (
    isRecord(value)
    && !getRollChildren(value)
    && (typeof value.value === 'number')
    && Number.isFinite(value.value)
  );
}

function getModifierList(value: unknown): string[] {
  if (value instanceof Set) {
    return [...value].filter((modifier): modifier is string => typeof modifier === 'string');
  }

  if (Array.isArray(value)) {
    return value.filter((modifier): modifier is string => typeof modifier === 'string');
  }

  return [];
}

function hasModifier(modifiers: string[], modifierName: string): boolean {
  return modifiers.includes(modifierName);
}

function hasAnyModifier(modifiers: string[], modifierNames: string[]): boolean {
  return modifierNames.some((modifierName) => hasModifier(modifiers, modifierName));
}

function flattenRollDiceDetails(
  source: unknown,
  groups: RpgDiceGroup[],
  rollIndex: number,
  firstDieIndex: number,
): RpgDiceDetail[] {
  const dice: RpgDiceDetail[] = [];
  let nextGroupIndex = 0;

  const visit = (node: unknown, groupIndex: number | null, groupPath: number[]): void => {
    if (Array.isArray(node)) {
      node.forEach((child, childIndex) => visit(child, groupIndex, [...groupPath, childIndex]));
      return;
    }

    const children = getRollChildren(node);
    if (children) {
      const childGroupIndex = groupIndex ?? nextGroupIndex;

      if (groupIndex === null) {
        nextGroupIndex += 1;
      }

      children.forEach((child, childIndex) => {
        visit(child, childGroupIndex, [...groupPath, childIndex]);
      });
      return;
    }

    if (isRollResultLike(node)) {
      const group = (groupIndex === null) ? null : (groups[groupIndex] ?? null);
      const modifiers = getModifierList(node.modifiers);
      const rollDieIndex = dice.length + 1;
      const useInTotal = Boolean(node.useInTotal);

      dice.push({
        id: `roll-${rollIndex}-die-${rollDieIndex}`,
        index: firstDieIndex + dice.length,
        rollIndex,
        rollDieIndex,
        groupIndex,
        groupPath,
        groupRollIndex: groupIndex,
        group,
        sides: group?.sides ?? null,
        groupNotation: group?.notation ?? null,
        value: node.value,
        initialValue: (typeof node.initialValue === 'number') ? node.initialValue : node.value,
        calculationValue: (typeof node.calculationValue === 'number') ? node.calculationValue : node.value,
        modifierFlags: (typeof node.modifierFlags === 'string') ? node.modifierFlags : '',
        modifiers,
        useInTotal,
        wasDropped: hasModifier(modifiers, 'drop') || !useInTotal,
        wasExploded: hasModifier(modifiers, 'explode'),
        wasRerolled: hasAnyModifier(modifiers, ['re-roll', 're-roll-once', 'unique', 'unique-once']),
        wasCriticalSuccess: hasModifier(modifiers, 'critical-success'),
        wasCriticalFailure: hasModifier(modifiers, 'critical-failure'),
        sourceId: null,
        modifierReasons: modifiers,
      });
    }
  };

  visit(source, null, []);
  return dice;
}

function buildRollEvents(dice: RpgDiceDetail[]): RpgDiceRollEvent[] {
  return dice.flatMap((detail) => {
    const base = {
      rollIndex: detail.rollIndex,
      dieIndex: detail.index,
      rollDieIndex: detail.rollDieIndex,
      groupIndex: detail.groupIndex,
      groupPath: detail.groupPath,
      value: detail.value,
      initialValue: detail.initialValue,
      useInTotal: detail.useInTotal,
      modifiers: detail.modifiers,
    };
    const events: RpgDiceRollEvent[] = [{
      id: `${detail.id}-roll`,
      type: 'roll',
      ...base,
      reason: null,
    }];

    if (detail.wasExploded) {
      events.push({
        id: `${detail.id}-explode`,
        type: 'explode',
        ...base,
        reason: 'explode',
      });
    }

    if (detail.wasRerolled) {
      events.push({
        id: `${detail.id}-reroll`,
        type: 'reroll',
        ...base,
        reason: detail.modifiers.find((modifier) => ['re-roll', 're-roll-once', 'unique', 'unique-once'].includes(modifier)) ?? 'reroll',
      });
    }

    if (detail.wasDropped) {
      events.push({
        id: `${detail.id}-drop`,
        type: 'drop',
        ...base,
        reason: detail.useInTotal ? 'drop' : 'excluded-from-total',
      });
    }

    if (detail.wasCriticalSuccess) {
      events.push({
        id: `${detail.id}-critical-success`,
        type: 'critical-success',
        ...base,
        reason: 'critical-success',
      });
    }

    if (detail.wasCriticalFailure) {
      events.push({
        id: `${detail.id}-critical-failure`,
        type: 'critical-failure',
        ...base,
        reason: 'critical-failure',
      });
    }

    return events;
  });
}

function formatRollOutput(roll: DiceRollInstance, total: number): string {
  return `${roll.notation}: ${roll.rolls.join('')} = ${total}`;
}

function formatAggregateOutput(rolls: RpgDiceRollEntry[], total: number): string {
  if (rolls.length === 1) {
    return rolls[0].output;
  }

  const lines = rolls.map((roll) => `${roll.index}. ${roll.output}`);
  lines.push(`Total: ${total}`);

  return lines.join('\n');
}

function hashSeed(seed: string): number {
  let hash = 17;

  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash * 31) + seed.charCodeAt(index)) % 2147483647;
  }

  return hash;
}

function createSeededEngine(seed: string | number | undefined): NumberGeneratorEngine | null {
  if (typeof seed === 'undefined') {
    return null;
  }

  const numericSeed = (typeof seed === 'number')
    ? Math.trunc(seed)
    : hashSeed(seed);

  return engines.MersenneTwister19937.seed(numericSeed) as NumberGeneratorEngine;
}

function runWithOptionalSeed<T>(seed: string | number | undefined, callback: () => T): T {
  const engine = createSeededEngine(seed);

  if (!engine) {
    return callback();
  }

  const previousEngine = generator.engine;
  generator.engine = engine;

  try {
    return callback();
  } finally {
    generator.engine = previousEngine;
  }
}

/**
 * Rolls an RPG dice notation with ERPG/Kraken aliases and a platform-neutral result shape.
 */
export function rollRpgDice(input: string, options: RpgDiceRollOptions = {}): RpgDiceRollResult {
  const parsedInput = parseRpgDiceInput(input);
  ensureRpgDiceInputLimits(parsedInput, options);

  return runWithOptionalSeed(options.seed, () => {
    const groups = extractRpgDiceGroups(parsedInput.notation);
    const rolls: RpgDiceRollEntry[] = [];
    const dice: RpgDiceDetail[] = [];
    const events: RpgDiceRollEvent[] = [];
    let total = 0;

    for (let index = 0; index < parsedInput.rollCount; index += 1) {
      const roll = new DiceRoll(parsedInput.notation) as DiceRollInstance;
      const rollTotal = roll.total;
      const rollIndex = index + 1;
      const rollDice = flattenRollDiceDetails(roll.rolls, groups, rollIndex, dice.length + 1);
      const rollEvents = buildRollEvents(rollDice);

      total += rollTotal;
      dice.push(...rollDice);
      events.push(...rollEvents);

      rolls.push({
        index: rollIndex,
        notation: roll.notation,
        total: rollTotal,
        output: formatRollOutput(roll, rollTotal),
        dice: rollDice,
        events: rollEvents,
        roll: {
          notation: roll.notation,
          output: formatRollOutput(roll, rollTotal),
          rolls: roll.rolls,
          total: rollTotal,
        },
      });
    }

    return {
      type: 'rpg-dice-roll',
      input: parsedInput.input,
      comment: parsedInput.comment,
      notation: parsedInput.notation,
      normalizedNotation: parsedInput.normalizedNotation,
      total,
      output: formatAggregateOutput(rolls, total),
      isMultiRoll: parsedInput.isMultiRoll,
      rollCount: parsedInput.rollCount,
      dice,
      events,
      rolls,
    };
  });
}

/**
 * Checks whether an input can be resolved by the RPG dice facade.
 */
export function verifyRpgDiceNotation(input: string, options: RpgDiceRollOptions = {}): boolean {
  return inspectRpgDiceNotation(input, options).isValid;
}
