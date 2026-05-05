import DiceRoll from './DiceRoll.js';
import Parser from './parser/Parser.js';

const blockCommentPattern = /\/\*([\s\S]*?)\*\//g;
const lineCommentPattern = /\/\/([^\n\r]*)/g;
const multiRollPattern = /^(\d+)#/;
const whitespacePattern = /\s+/g;
const diceGroupPattern = /(\d*)d(\d+|%|F)/gi;

export const DEFAULT_MAX_TOTAL_DICE = 9999;
export const DEFAULT_MAX_MULTI_ROLLS = 100;

export interface RpgDiceRollOptions {
  maxDice?: number;
  maxRolls?: number;
}

export type RpgDiceRollErrorCode = 'DICE_NOTATION_REQUIRED' | 'TOO_MANY_ROLLS' | 'TOO_MANY_DICE';

export interface RpgDiceRollErrorDetails {
  [key: string]: unknown;
}

export interface RpgDiceRollErrorOptions {
  code: RpgDiceRollErrorCode;
  input?: string;
  notation?: string;
  normalizedNotation?: string;
  limit?: number;
  details?: RpgDiceRollErrorDetails;
}

export class RpgDiceRollError extends Error {
  code: RpgDiceRollErrorCode;

  input?: string;

  notation?: string;

  normalizedNotation?: string;

  limit?: number;

  details: RpgDiceRollErrorDetails;

  constructor(message: string, options: RpgDiceRollErrorOptions) {
    super(message);
    this.name = 'RpgDiceRollError';
    this.code = options.code;
    this.input = options.input;
    this.notation = options.notation;
    this.normalizedNotation = options.normalizedNotation;
    this.limit = options.limit;
    this.details = options.details ?? {};
  }
}

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

interface NormalizationRule {
  name: string;
  apply: (notation: string) => string;
}

function isDigit(value: string): boolean {
  return /^\d$/.test(value);
}

function isAlpha(value: string): boolean {
  return /^[a-z]$/i.test(value);
}

function isIdentifierBoundary(value: string | undefined): boolean {
  return !value || !/[a-z0-9_]/i.test(value);
}

function readWhile(
  source: string,
  start: number,
  matcher: (value: string) => boolean,
): [string, number] {
  let cursor = start;

  while (cursor < source.length && matcher(source[cursor])) {
    cursor += 1;
  }

  return [source.slice(start, cursor), cursor];
}

function readDiceSides(source: string, start: number): [string, number] {
  const current = source[start];

  if (current === '%') {
    return ['%', start + 1];
  }

  if (current && current.toUpperCase() === 'F') {
    return ['F', start + 1];
  }

  if (current && isDigit(current)) {
    return readWhile(source, start, isDigit);
  }

  return ['20', start];
}

function normalizeAlphaToken(token: string, next: string | undefined): string {
  const lowerToken = token.toLowerCase();

  if (lowerToken === 'f' && isIdentifierBoundary(next)) {
    return '4dF';
  }

  if (
    (lowerToken === 'ei')
    && (isDigit(next ?? '') || ['<', '>', '=', '!', undefined].includes(next))
  ) {
    return isDigit(next ?? '') ? '!>=' : '!';
  }

  if (lowerToken === 'km') {
    return isDigit(next ?? '') ? 'kl' : 'kl1';
  }

  if ((lowerToken === 'kh') || (lowerToken === 'kl')) {
    return isDigit(next ?? '') ? lowerToken : `${lowerToken}1`;
  }

  if (lowerToken === 'k') {
    return isDigit(next ?? '') ? 'k' : 'k1';
  }

  return token;
}

/* eslint-disable no-continue */
function normalizeFriendlyTokens(notation: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < notation.length) {
    const char = notation[cursor];

    if (isDigit(char)) {
      const [quantity, afterQuantity] = readWhile(notation, cursor, isDigit);
      const marker = notation[afterQuantity];

      if (marker && marker.toLowerCase() === 'd') {
        const [sides, afterSides] = readDiceSides(notation, afterQuantity + 1);
        output += (Number(quantity) === 0) ? '0' : `${quantity}d${sides}`;
        cursor = afterSides;
        continue;
      }

      if (
        marker
        && marker.toLowerCase() === 'f'
        && isIdentifierBoundary(notation[afterQuantity + 1])
      ) {
        output += `${quantity}dF`;
        cursor = afterQuantity + 1;
        continue;
      }

      output += quantity;
      cursor = afterQuantity;
      continue;
    }

    if (char.toLowerCase() === 'd') {
      const next = notation[cursor + 1];

      if (next && next.toLowerCase() === 'f') {
        output += 'dF';
        cursor += 2;
        continue;
      }

      if (
        !next
        || isIdentifierBoundary(next)
        || isDigit(next)
        || next === '%'
        || next.toLowerCase() === 'f'
      ) {
        const [sides, afterSides] = readDiceSides(notation, cursor + 1);
        output += `d${sides}`;
        cursor = afterSides;
        continue;
      }
    }

    if (isAlpha(char)) {
      const [token, afterToken] = readWhile(notation, cursor, isAlpha);
      output += normalizeAlphaToken(token, notation[afterToken]);
      cursor = afterToken;
      continue;
    }

    output += char;
    cursor += 1;
  }

  return output;
}
/* eslint-enable no-continue */

function normalizeSimpleOperators(notation: string): string {
  let normalized = notation;
  let previous: string;

  do {
    previous = normalized;
    normalized = normalized
      .replace(/\+-/g, '-')
      .replace(/-\+/g, '-')
      .replace(/\+\+/g, '+')
      .replace(/--/g, '+');
  } while (normalized !== previous);

  return normalized.replace(/[+-]{3,}/g, '+').replace(/^[+-]/, '');
}

const notationNormalizationRules: NormalizationRule[] = [
  {
    name: 'friendly-token-scanner',
    apply: normalizeFriendlyTokens,
  },
  {
    name: 'simple-operators',
    apply: normalizeSimpleOperators,
  },
];

/**
 * Extracts user-facing comments without coupling the dice engine to a chat platform.
 */
export function extractRpgDiceComment(input: string): string {
  const source = String(input ?? '');
  const comments: string[] = [];

  source.replace(blockCommentPattern, (_match, comment: string) => {
    comments.push(comment.trim());
    return _match;
  });

  source.replace(lineCommentPattern, (_match, comment: string) => {
    comments.push(comment.trim());
    return _match;
  });

  return comments
    .filter(Boolean)
    .join(' ')
    .replace(/\{[^}]+\}/g, '')
    .trim();
}

/**
 * Removes comments and whitespace from notation while preserving dice semantics.
 */
export function cleanRpgDiceNotation(input: string): string {
  return String(input ?? '')
    .replace(blockCommentPattern, '')
    .replace(lineCommentPattern, '')
    .replace(whitespacePattern, '');
}

/**
 * Applies ERPG/Kraken-friendly notation aliases before handing the formula to the parser.
 */
export function normalizeRpgDiceNotation(input: string): string {
  return notationNormalizationRules
    .reduce((notation, rule) => rule.apply(notation), cleanRpgDiceNotation(input));
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

function countWorstCaseDiceExpressions(expressions: unknown[]): number {
  return expressions.reduce<number>((total, expression) => {
    if (Array.isArray(expression)) {
      return total + countWorstCaseDiceExpressions(expression);
    }

    const quantity = getObjectNumber(expression, 'qty');
    if (quantity !== null) {
      const explodeModifier = getObjectModifiers(expression)
        .find((modifier) => getModifierName(modifier) === 'explode');
      const explodeMultiplier = explodeModifier ? 1 + getModifierMaxIterations(explodeModifier) : 1;

      return total + (Math.max(0, quantity) * explodeMultiplier);
    }

    if (isRecord(expression) && Array.isArray(expression.expressions)) {
      return total + countWorstCaseDiceExpressions(expression.expressions);
    }

    return total;
  }, 0);
}

function parseNotationForValidation(notation: string): unknown[] {
  return Parser.parse(notation) as unknown[];
}

function ensureRpgDiceInputLimits(
  parsedInput: RpgDiceInput,
  options: RpgDiceRollOptions,
): void {
  const maxDice = resolveLimit(options.maxDice, DEFAULT_MAX_TOTAL_DICE);
  const maxRolls = resolveLimit(options.maxRolls, DEFAULT_MAX_MULTI_ROLLS);

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

  const parsedExpressions = parseNotationForValidation(parsedInput.notation);
  const worstCaseDiceCount = countWorstCaseDiceExpressions(parsedExpressions);
  const totalWorstCaseDice = worstCaseDiceCount * parsedInput.rollCount;

  if (totalWorstCaseDice > maxDice) {
    throw new RpgDiceRollError('Too many dice', {
      code: 'TOO_MANY_DICE',
      input: parsedInput.input,
      notation: parsedInput.notation,
      normalizedNotation: parsedInput.normalizedNotation,
      limit: maxDice,
      details: {
        rollCount: parsedInput.rollCount,
        staticDiceCount,
        worstCaseDiceCount,
        totalStaticDice,
        totalWorstCaseDice,
      },
    });
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

  const visit = (node: unknown, groupIndex: number | null): void => {
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, groupIndex));
      return;
    }

    const children = getRollChildren(node);
    if (children) {
      const childGroupIndex = groupIndex ?? nextGroupIndex;

      if (groupIndex === null) {
        nextGroupIndex += 1;
      }

      children.forEach((child) => visit(child, childGroupIndex));
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
      });
    }
  };

  visit(source, null);
  return dice;
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

/**
 * Rolls an RPG dice notation with ERPG/Kraken aliases and a platform-neutral result shape.
 */
export function rollRpgDice(input: string, options: RpgDiceRollOptions = {}): RpgDiceRollResult {
  const parsedInput = parseRpgDiceInput(input);
  ensureRpgDiceInputLimits(parsedInput, options);

  const groups = extractRpgDiceGroups(parsedInput.notation);
  const rolls: RpgDiceRollEntry[] = [];
  const dice: RpgDiceDetail[] = [];
  let total = 0;

  for (let index = 0; index < parsedInput.rollCount; index += 1) {
    const roll = new DiceRoll(parsedInput.notation) as DiceRollInstance;
    const rollTotal = roll.total;
    const rollIndex = index + 1;
    const rollDice = flattenRollDiceDetails(roll.rolls, groups, rollIndex, dice.length + 1);

    total += rollTotal;
    dice.push(...rollDice);

    rolls.push({
      index: rollIndex,
      notation: roll.notation,
      total: rollTotal,
      output: formatRollOutput(roll, rollTotal),
      dice: rollDice,
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
    rolls,
  };
}

/**
 * Checks whether an input can be resolved by the RPG dice facade.
 */
export function verifyRpgDiceNotation(input: string, options: RpgDiceRollOptions = {}): boolean {
  try {
    ensureRpgDiceInputLimits(parseRpgDiceInput(input), options);
    return true;
  } catch {
    return false;
  }
}
