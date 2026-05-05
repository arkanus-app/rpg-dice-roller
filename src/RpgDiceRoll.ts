import DiceRoll from './DiceRoll.js';

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
  index: number;
  rollIndex: number;
  rollDieIndex: number;
  groupIndex: number | null;
  group: RpgDiceGroup | null;
  value: number;
  initialValue: number;
  calculationValue: number;
  modifierFlags: string;
  modifiers: string[];
  useInTotal: boolean;
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

const notationNormalizationRules: NormalizationRule[] = [
  {
    name: 'uppercase-dice-marker',
    apply: (notation) => notation.replace(/D/g, 'd'),
  },
  {
    name: 'zero-dice-groups',
    apply: (notation) => notation.replace(/\b0d(?:\d+|%|F)?/gi, '0'),
  },
  {
    name: 'default-d20-single-d',
    apply: (notation) => notation.replace(/(^|[^a-zA-Z0-9_])d(?![a-zA-Z0-9_%])/g, '$1d20'),
  },
  {
    name: 'default-d20-missing-sides',
    apply: (notation) => notation.replace(/(\d+)d(?![\d%Ff.(])/g, '$1d20'),
  },
  {
    name: 'default-fudge-dice',
    apply: (notation) => notation.replace(/\bf\b/gi, '4dF'),
  },
  {
    name: 'quantity-fudge-dice',
    apply: (notation) => notation.replace(/(\d+)f\b/gi, '$1dF'),
  },
  {
    name: 'canonical-fudge-marker',
    apply: (notation) => notation.replace(/df/gi, 'dF'),
  },
  {
    name: 'short-explode-intent',
    apply: (notation) => notation.replace(/ei(?=\d|[<>=!]|$)/gi, '!'),
  },
  {
    name: 'explode-number-threshold',
    apply: (notation) => notation.replace(/!(\d)/g, '!>=$1'),
  },
  {
    name: 'keep-minimum-alias',
    apply: (notation) => notation.replace(/km/gi, 'kl'),
  },
  {
    name: 'default-keep-lowest-count',
    apply: (notation) => notation.replace(/kl(?!\d)/gi, 'kl1'),
  },
  {
    name: 'default-keep-highest-count',
    apply: (notation) => notation.replace(/kh(?!\d)/gi, 'kh1'),
  },
  {
    name: 'default-keep-count',
    apply: (notation) => notation.replace(/k(?![\dhl])/gi, 'k1'),
  },
  {
    name: 'operator-plus-minus',
    apply: (notation) => notation.replace(/\+-/g, '-'),
  },
  {
    name: 'operator-minus-plus',
    apply: (notation) => notation.replace(/-\+/g, '-'),
  },
  {
    name: 'operator-double-plus',
    apply: (notation) => notation.replace(/\+\+/g, '+'),
  },
  {
    name: 'operator-double-minus',
    apply: (notation) => notation.replace(/--/g, '+'),
  },
  {
    name: 'operator-repeated-signs',
    apply: (notation) => notation.replace(/[+-]{3,}/g, '+'),
  },
  {
    name: 'leading-sign',
    apply: (notation) => notation.replace(/^[+-]/, ''),
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

      dice.push({
        index: firstDieIndex + dice.length,
        rollIndex,
        rollDieIndex: dice.length + 1,
        groupIndex,
        group,
        value: node.value,
        initialValue: (typeof node.initialValue === 'number') ? node.initialValue : node.value,
        calculationValue: (typeof node.calculationValue === 'number') ? node.calculationValue : node.value,
        modifierFlags: (typeof node.modifierFlags === 'string') ? node.modifierFlags : '',
        modifiers: getModifierList(node.modifiers),
        useInTotal: Boolean(node.useInTotal),
      });
    }
  };

  visit(source, null);
  return dice;
}

function resolveLimit(value: number | undefined, fallback: number): number {
  const numericValue = Number(value ?? fallback);

  if (!Number.isFinite(numericValue) || (numericValue < 0)) {
    return fallback;
  }

  return Math.floor(numericValue);
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
  const maxDice = resolveLimit(options.maxDice, DEFAULT_MAX_TOTAL_DICE);
  const maxRolls = resolveLimit(options.maxRolls, DEFAULT_MAX_MULTI_ROLLS);

  if (!parsedInput.notation) {
    throw new Error('Dice notation is required');
  }

  if (parsedInput.rollCount > maxRolls) {
    throw new Error('Too many rolls');
  }

  const diceCount = countRpgDiceInNotation(parsedInput.notation);
  if ((diceCount * parsedInput.rollCount) > maxDice) {
    throw new Error('Too many dice');
  }

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
    rollRpgDice(input, options);
    return true;
  } catch {
    return false;
  }
}
