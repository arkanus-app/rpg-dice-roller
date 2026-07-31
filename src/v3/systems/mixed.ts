import { compileRpgDice, rollRpgDice } from '../engine.js';
import { DiceRollError } from '../errors.js';
import { createDiceLimits, type DiceLimits } from '../runtime/limits.js';
import {
  createProvidedSeed,
  validateReplayDescriptor,
  type RandomAlgorithm,
  type ReplayDescriptor,
  type SeedInput,
  type SeedMaterial,
} from '../runtime/replay.js';
import type {
  DiceRollResult,
  ExecutionStats,
  ResolvedDie,
  RollOptions,
  RollPlan,
} from '../types.js';
import {
  rollAssimilation,
  type AssimilationDieResult,
  type AssimilationRollInput,
  type AssimilationRollResult,
} from './assimilation.js';
import {
  rollFateDice,
  type FateDieResult,
  type FateRollInput,
  type FateRollResult,
} from './fate.js';
import {
  rollVampireV5,
  type VampireV5DieResult,
  type VampireV5RollInput,
  type VampireV5RollResult,
} from './vampire-v5.js';

export type MixedRollKind = 'generic' | 'vampire-v5' | 'fate' | 'assimilation';

export interface MixedRollReplayEntry {
  readonly kind: MixedRollKind;
  readonly notation: string;
  readonly replay: ReplayDescriptor;
}

export interface MixedRollReplayDescriptor {
  readonly type: 'mixed-roll-replay';
  readonly schemaVersion: 1;
  readonly notation: string;
  readonly rolls: readonly MixedRollReplayEntry[];
}

type MixedSeededRollOptions = {
  readonly limits?: Partial<DiceLimits>;
  readonly seed?: SeedInput;
  readonly replay?: never;
  readonly randomAlgorithm?: RandomAlgorithm;
};

type MixedReplayRollOptions = {
  readonly limits?: Partial<DiceLimits>;
  readonly seed?: never;
  readonly replay: MixedRollReplayDescriptor;
  readonly randomAlgorithm?: never;
};

export type MixedRollOptions = MixedSeededRollOptions | MixedReplayRollOptions;

interface MixedRollItemBase<
  Kind extends MixedRollKind,
  Result,
> {
  readonly id: string;
  readonly index: number;
  readonly kind: Kind;
  readonly notation: string;
  readonly result: Result;
}

export type MixedGenericRollItem = MixedRollItemBase<
  'generic',
  DiceRollResult
>;

export type MixedVampireV5RollItem = MixedRollItemBase<
  'vampire-v5',
  VampireV5RollResult
>;

export type MixedFateRollItem = MixedRollItemBase<
  'fate',
  FateRollResult
>;

export type MixedAssimilationRollItem = MixedRollItemBase<
  'assimilation',
  AssimilationRollResult
>;

export type MixedRollItem =
  | MixedGenericRollItem
  | MixedVampireV5RollItem
  | MixedFateRollItem
  | MixedAssimilationRollItem;

export interface MixedGenericDieResult extends ResolvedDie {
  readonly mixedRollId: string;
  readonly mixedRollIndex: number;
  readonly sourceDieId: string;
  /** Last physical face produced by roll/reroll events, before semantic transforms. */
  readonly physicalValue: number;
}

type MixedSourceSystemDieResult =
  | VampireV5DieResult
  | FateDieResult
  | AssimilationDieResult;

export type MixedSystemDieResult = MixedSourceSystemDieResult & {
  readonly mixedRollId: string;
  readonly mixedRollIndex: number;
  readonly systemDieId: string;
  readonly physicalValue: number;
  readonly included: true;
};

export type MixedRollDieResult = MixedGenericDieResult | MixedSystemDieResult;

export interface MixedRollResult {
  readonly type: 'mixed-roll';
  readonly schemaVersion: 1;
  readonly input: string;
  readonly notation: string;
  readonly rolls: readonly MixedRollItem[];
  readonly dice: readonly MixedRollDieResult[];
  readonly output: string;
  readonly replay: MixedRollReplayDescriptor;
  readonly stats: ExecutionStats;
}

interface ParsedGenericRoll {
  readonly kind: 'generic';
  readonly notation: string;
  readonly plan: RollPlan;
  readonly initialDice: number;
  readonly rollCount: number;
}

interface ParsedVampireV5Roll {
  readonly kind: 'vampire-v5';
  readonly notation: string;
  readonly input: VampireV5RollInput;
  readonly initialDice: number;
  readonly rollCount: 1;
}

interface ParsedFateRoll {
  readonly kind: 'fate';
  readonly notation: string;
  readonly input: FateRollInput;
  readonly initialDice: number;
  readonly rollCount: 1;
}

interface ParsedAssimilationRoll {
  readonly kind: 'assimilation';
  readonly notation: string;
  readonly input: AssimilationRollInput;
  readonly initialDice: number;
  readonly rollCount: 1;
}

type ParsedMixedRoll =
  | ParsedGenericRoll
  | ParsedVampireV5Roll
  | ParsedFateRoll
  | ParsedAssimilationRoll;

type NamedArguments = Readonly<Record<string, number>>;

const SYSTEM_ALIASES: Readonly<Record<string, Exclude<MixedRollKind, 'generic'>>> =
  Object.freeze({
    as: 'assimilation',
    assim: 'assimilation',
    assimilacao: 'assimilation',
    assimilation: 'assimilation',
    fate: 'fate',
    fatedice: 'fate',
    v5: 'vampire-v5',
    vampire: 'vampire-v5',
    vampirev5: 'vampire-v5',
    vampiro: 'vampire-v5',
  });

const LIMIT_STATS = Object.freeze([
  ['maxRolls', 'rolls', 'TOO_MANY_ROLLS'],
  ['maxInitialDice', 'initialDice', 'TOO_MANY_INITIAL_DICE'],
  ['maxGeneratedDice', 'generatedDice', 'GENERATED_DICE_LIMIT_EXCEEDED'],
  ['maxRandomCalls', 'randomCalls', 'RANDOM_BUDGET_EXCEEDED'],
  ['maxEvents', 'events', 'EVENT_LIMIT_EXCEEDED'],
  ['maxModifierSteps', 'modifierSteps', 'MODIFIER_STEP_LIMIT_EXCEEDED'],
  ['maxResolvedGroups', 'resolvedGroups', 'RESOLVED_GROUP_LIMIT_EXCEEDED'],
  ['maxResultItems', 'resultItems', 'RESULT_LIMIT_EXCEEDED'],
] as const);

const EMPTY_STATS: ExecutionStats = Object.freeze({
  rolls: 0,
  initialDice: 0,
  generatedDice: 0,
  randomCalls: 0,
  modifierSteps: 0,
  events: 0,
  resolvedGroups: 0,
  resultItems: 0,
});

function mixedNotationError(
  input: string,
  message: string,
  segment?: number,
): DiceRollError {
  return new DiceRollError(message, {
    code: 'INVALID_NOTATION',
    input,
    details: segment === undefined ? {} : { segment },
  });
}

function normalizeSystemName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/giu, '')
    .toLowerCase();
}

function splitMixedNotation(input: string): readonly string[] {
  const segments: string[] = [];
  let start = 0;
  let parentheses = 0;
  let braces = 0;
  let brackets = 0;
  let notationEnd = input.length;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '/' && input[index + 1] === '/') {
      notationEnd = index;
      break;
    }
    if (character === '(') {
      parentheses += 1;
    } else if (character === ')') {
      parentheses -= 1;
    } else if (character === '{') {
      braces += 1;
    } else if (character === '}') {
      braces -= 1;
    } else if (character === '[') {
      brackets += 1;
    } else if (character === ']') {
      brackets -= 1;
    }

    if (parentheses < 0 || braces < 0 || brackets < 0) {
      throw mixedNotationError(input, 'Mixed dice notation has an unmatched closing delimiter');
    }
    if (character === ';' && parentheses === 0 && braces === 0 && brackets === 0) {
      const segment = input.slice(start, index).trim();
      if (segment.length === 0) {
        throw mixedNotationError(input, 'Mixed dice notation contains an empty roll');
      }
      segments.push(segment);
      start = index + 1;
    }
  }

  if (parentheses !== 0 || braces !== 0 || brackets !== 0) {
    throw mixedNotationError(input, 'Mixed dice notation has an unmatched opening delimiter');
  }

  const finalSegment = input.slice(start, notationEnd).trim();
  if (finalSegment.length === 0) {
    throw mixedNotationError(input, 'Mixed dice notation contains an empty roll');
  }
  segments.push(finalSegment);
  return Object.freeze(segments);
}

function parseUnsignedInteger(
  input: string,
  originalInput: string,
  segment: number,
): number {
  if (!/^\d+$/u.test(input)) {
    throw mixedNotationError(
      originalInput,
      `Mixed roll ${segment} arguments must be non-negative integer literals`,
      segment,
    );
  }
  const value = Number(input);
  if (!Number.isSafeInteger(value)) {
    throw mixedNotationError(
      originalInput,
      `Mixed roll ${segment} argument exceeds the safe integer range`,
      segment,
    );
  }
  return value;
}

function parseArguments(
  body: string,
  originalInput: string,
  segment: number,
): readonly number[] | NamedArguments {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return Object.freeze([]);
  }
  const parts = trimmed.split(',').map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) {
    throw mixedNotationError(
      originalInput,
      `Mixed roll ${segment} contains an empty argument`,
      segment,
    );
  }

  const named = parts.some((part) => part.includes('='));
  if (!named) {
    return Object.freeze(parts.map((part) => (
      parseUnsignedInteger(part, originalInput, segment)
    )));
  }
  if (parts.some((part) => !part.includes('='))) {
    throw mixedNotationError(
      originalInput,
      `Mixed roll ${segment} cannot mix positional and named arguments`,
      segment,
    );
  }

  const result: Record<string, number> = {};
  for (const part of parts) {
    const separator = part.indexOf('=');
    const rawName = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    const name = normalizeSystemName(rawName);
    if (name.length === 0 || Object.hasOwn(result, name)) {
      throw mixedNotationError(
        originalInput,
        `Mixed roll ${segment} contains an invalid or duplicate argument`,
        segment,
      );
    }
    result[name] = parseUnsignedInteger(rawValue, originalInput, segment);
  }
  return Object.freeze(result);
}

function isNamedArguments(
  value: readonly number[] | NamedArguments,
): value is NamedArguments {
  return !Array.isArray(value);
}

function readNamedArgument(
  args: NamedArguments,
  aliases: readonly string[],
  originalInput: string,
  segment: number,
  field: string,
): number | undefined {
  let result: number | undefined;
  for (const alias of aliases) {
    const normalized = normalizeSystemName(alias);
    if (Object.hasOwn(args, normalized)) {
      if (result !== undefined) {
        throw mixedNotationError(
          originalInput,
          `Mixed roll ${segment} contains more than one '${field}' argument`,
          segment,
        );
      }
      result = args[normalized];
    }
  }
  return result;
}

function assertNamedArguments(
  args: NamedArguments,
  allowed: readonly string[],
  originalInput: string,
  segment: number,
): void {
  const allowedNames = new Set(allowed.map(normalizeSystemName));
  for (const name of Object.keys(args)) {
    if (!allowedNames.has(name)) {
      throw mixedNotationError(
        originalInput,
        `Mixed roll ${segment} contains unknown argument '${name}'`,
        segment,
      );
    }
  }
}

function parseVampireV5(
  args: readonly number[] | NamedArguments,
  originalInput: string,
  segment: number,
): ParsedVampireV5Roll {
  let pool: number | undefined;
  let hunger: number | undefined;
  let difficulty: number | undefined;

  if (isNamedArguments(args)) {
    const allowed = ['pool', 'hunger', 'fome', 'difficulty', 'dificuldade'];
    assertNamedArguments(args, allowed, originalInput, segment);
    pool = readNamedArgument(args, ['pool'], originalInput, segment, 'pool');
    hunger = readNamedArgument(
      args,
      ['hunger', 'fome'],
      originalInput,
      segment,
      'hunger',
    );
    difficulty = readNamedArgument(
      args,
      ['difficulty', 'dificuldade'],
      originalInput,
      segment,
      'difficulty',
    );
  } else {
    if (args.length < 2 || args.length > 3) {
      throw mixedNotationError(
        originalInput,
        `Mixed roll ${segment} v5() expects pool, hunger, and optional difficulty`,
        segment,
      );
    }
    [pool, hunger, difficulty] = args;
  }

  if (pool === undefined || hunger === undefined) {
    throw mixedNotationError(
      originalInput,
      `Mixed roll ${segment} v5() requires pool and hunger`,
      segment,
    );
  }

  const input: VampireV5RollInput = {
    pool,
    hunger,
    ...(difficulty === undefined ? {} : { difficulty }),
  };
  return Object.freeze({
    kind: 'vampire-v5',
    notation: `v5(pool=${pool},hunger=${hunger}${
      difficulty === undefined ? '' : `,difficulty=${difficulty}`
    })`,
    input,
    initialDice: pool,
    rollCount: 1,
  });
}

function parseFate(
  args: readonly number[] | NamedArguments,
  originalInput: string,
  segment: number,
): ParsedFateRoll {
  let dice: number | undefined;
  if (isNamedArguments(args)) {
    const allowed = ['dice', 'dado', 'dados'];
    assertNamedArguments(args, allowed, originalInput, segment);
    dice = readNamedArgument(args, allowed, originalInput, segment, 'dice');
  } else {
    if (args.length > 1) {
      throw mixedNotationError(
        originalInput,
        `Mixed roll ${segment} fate() expects an optional dice count`,
        segment,
      );
    }
    [dice] = args;
  }

  const count = dice ?? 4;
  return Object.freeze({
    kind: 'fate',
    notation: `fate(dice=${count})`,
    input: { dice: count },
    initialDice: count,
    rollCount: 1,
  });
}

function parseAssimilation(
  args: readonly number[] | NamedArguments,
  originalInput: string,
  segment: number,
): ParsedAssimilationRoll {
  let d6 = 0;
  let d10 = 0;
  let d12 = 0;
  let keep = 1;

  if (isNamedArguments(args)) {
    const allowed = ['d6', 'd10', 'd12', 'keep', 'manter'];
    assertNamedArguments(args, allowed, originalInput, segment);
    d6 = readNamedArgument(args, ['d6'], originalInput, segment, 'd6') ?? 0;
    d10 = readNamedArgument(args, ['d10'], originalInput, segment, 'd10') ?? 0;
    d12 = readNamedArgument(args, ['d12'], originalInput, segment, 'd12') ?? 0;
    keep = readNamedArgument(
      args,
      ['keep', 'manter'],
      originalInput,
      segment,
      'keep',
    ) ?? 1;
  } else {
    if (args.length < 1 || args.length > 4) {
      throw mixedNotationError(
        originalInput,
        `Mixed roll ${segment} assim() expects d6, d10, d12, and optional keep`,
        segment,
      );
    }
    [d6 = 0, d10 = 0, d12 = 0, keep = 1] = args;
  }

  const input: AssimilationRollInput = { d6, d10, d12, keep };
  return Object.freeze({
    kind: 'assimilation',
    notation: `assim(d6=${d6},d10=${d10},d12=${d12},keep=${keep})`,
    input,
    initialDice: d6 + d10 + d12,
    rollCount: 1,
  });
}

function parseMixedRoll(
  segmentInput: string,
  originalInput: string,
  segment: number,
  limits: DiceLimits,
): ParsedMixedRoll {
  const call = /^([\p{L}][\p{L}\p{N}_-]*)\s*\(([\s\S]*)\)$/u.exec(segmentInput);
  if (call !== null) {
    const name = normalizeSystemName(call[1] ?? '');
    const system = SYSTEM_ALIASES[name];
    if (system !== undefined) {
      const args = parseArguments(call[2] ?? '', originalInput, segment);
      switch (system) {
        case 'vampire-v5':
          return parseVampireV5(args, originalInput, segment);
        case 'fate':
          return parseFate(args, originalInput, segment);
        case 'assimilation':
          return parseAssimilation(args, originalInput, segment);
      }
    }
  }

  const plan = compileRpgDice(segmentInput, { limits });
  return Object.freeze({
    kind: 'generic',
    notation: plan.normalizedNotation,
    plan,
    initialDice: plan.cost.totalStaticDice,
    rollCount: plan.rollCount,
  });
}

function assertStaticBudgets(
  parsed: readonly ParsedMixedRoll[],
  limits: DiceLimits,
  input: string,
): void {
  const rollCount = parsed.reduce((total, roll) => total + roll.rollCount, 0);
  const initialDice = parsed.reduce((total, roll) => total + roll.initialDice, 0);
  if (rollCount > limits.maxRolls) {
    throw new DiceRollError('Mixed roll exceeds the roll-count limit', {
      code: 'TOO_MANY_ROLLS',
      input,
      details: { rollCount, limit: limits.maxRolls },
    });
  }
  if (!Number.isSafeInteger(initialDice) || initialDice > limits.maxInitialDice) {
    throw new DiceRollError('Mixed roll exceeds the initial-dice limit', {
      code: 'TOO_MANY_INITIAL_DICE',
      input,
      details: { initialDice, limit: limits.maxInitialDice },
    });
  }
}

function addStats(left: ExecutionStats, right: ExecutionStats): ExecutionStats {
  return Object.freeze({
    rolls: left.rolls + right.rolls,
    initialDice: left.initialDice + right.initialDice,
    generatedDice: left.generatedDice + right.generatedDice,
    randomCalls: left.randomCalls + right.randomCalls,
    modifierSteps: left.modifierSteps + right.modifierSteps,
    events: left.events + right.events,
    resolvedGroups: left.resolvedGroups + right.resolvedGroups,
    resultItems: left.resultItems + right.resultItems,
  });
}

function assertRuntimeBudgets(
  stats: ExecutionStats,
  limits: DiceLimits,
  input: string,
): void {
  for (const [limitName, statName, code] of LIMIT_STATS) {
    if (stats[statName] > limits[limitName]) {
      throw new DiceRollError(`Mixed roll exceeds ${limitName}`, {
        code,
        input,
        details: {
          limit: limits[limitName],
          actual: stats[statName],
        },
      });
    }
  }
}

function createRemainingLimits(
  limits: DiceLimits,
  stats: ExecutionStats,
  outputLength: number,
): DiceLimits {
  const remaining: Record<string, number> = { ...limits };
  for (const [limitName, statName] of LIMIT_STATS) {
    remaining[limitName] = Math.max(1, limits[limitName] - stats[statName]);
  }
  remaining['maxOutputLength'] = Math.max(1, limits.maxOutputLength - outputLength);
  return remaining as unknown as DiceLimits;
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function deriveItemSeed(root: SeedMaterial, index: number): number {
  const high = mix32((root.words[index % root.words.length] ?? 0) ^ index);
  const low = mix32(
    (root.words[(index + 1) % root.words.length] ?? 0)
    ^ Math.imul(index + 1, 0x9e3779b1),
  );
  return (high & 0x1fffff) * 0x1_0000_0000 + low;
}

function validateMixedReplay(
  value: unknown,
  notation: string,
  parsed: readonly ParsedMixedRoll[],
): MixedRollReplayDescriptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DiceRollError('Mixed replay must be a non-null object', {
      code: 'INVALID_REPLAY',
    });
  }
  const replay = value as Readonly<Record<string, unknown>>;
  let keys: string[];
  try {
    keys = Object.keys(replay).sort();
  } catch {
    throw new DiceRollError('Mixed replay could not be read', {
      code: 'INVALID_REPLAY',
    });
  }
  if (
    keys.join(',') !== 'notation,rolls,schemaVersion,type'
    || replay['type'] !== 'mixed-roll-replay'
    || replay['schemaVersion'] !== 1
    || replay['notation'] !== notation
    || !Array.isArray(replay['rolls'])
    || replay['rolls'].length !== parsed.length
  ) {
    throw new DiceRollError('Mixed replay does not match this notation', {
      code: 'INVALID_REPLAY',
      details: { expectedNotation: notation },
    });
  }

  const entries = replay['rolls'].map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new DiceRollError('Mixed replay contains an invalid roll entry', {
        code: 'INVALID_REPLAY',
        details: { index },
      });
    }
    const record = entry as Readonly<Record<string, unknown>>;
    const expected = parsed[index];
    let entryKeys: string[];
    try {
      entryKeys = Object.keys(record).sort();
    } catch {
      throw new DiceRollError('Mixed replay roll entry could not be read', {
        code: 'INVALID_REPLAY',
        details: { index },
      });
    }
    if (
      expected === undefined
      || entryKeys.join(',') !== 'kind,notation,replay'
      || record['kind'] !== expected.kind
      || record['notation'] !== expected.notation
    ) {
      throw new DiceRollError('Mixed replay roll entry does not match the notation', {
        code: 'INVALID_REPLAY',
        details: { index },
      });
    }
    return Object.freeze({
      kind: expected.kind,
      notation: expected.notation,
      replay: validateReplayDescriptor(record['replay']),
    });
  });

  return Object.freeze({
    type: 'mixed-roll-replay',
    schemaVersion: 1,
    notation,
    rolls: Object.freeze(entries),
  });
}

function createItemOptions(
  options: MixedRollOptions,
  limits: DiceLimits,
  index: number,
  rootSeed: SeedMaterial | null,
  replay: MixedRollReplayDescriptor | null,
): RollOptions {
  if (replay !== null) {
    const entry = replay.rolls[index];
    if (entry === undefined) {
      throw new DiceRollError('Mixed replay is missing a roll entry', {
        code: 'INVALID_REPLAY',
        details: { index },
      });
    }
    return { limits, replay: entry.replay };
  }

  const seeded = options as MixedSeededRollOptions;
  return {
    limits,
    ...(rootSeed === null ? {} : { seed: deriveItemSeed(rootSeed, index) }),
    ...(seeded.randomAlgorithm === undefined
      ? {}
      : { randomAlgorithm: seeded.randomAlgorithm }),
  };
}

function resultStats(item: MixedRollItem): ExecutionStats {
  return item.kind === 'generic'
    ? item.result.stats
    : item.result.baseRoll.stats;
}

function resultReplay(item: MixedRollItem): ReplayDescriptor {
  return item.kind === 'generic'
    ? item.result.replay
    : item.result.baseRoll.replay;
}

function createMixedItem(
  parsed: ParsedMixedRoll,
  index: number,
  options: RollOptions,
): MixedRollItem {
  const id = `mixed-roll-${index + 1}`;
  switch (parsed.kind) {
    case 'generic':
      return Object.freeze({
        id,
        index,
        kind: parsed.kind,
        notation: parsed.notation,
        result: rollRpgDice(parsed.plan, options),
      });
    case 'vampire-v5':
      return Object.freeze({
        id,
        index,
        kind: parsed.kind,
        notation: parsed.notation,
        result: rollVampireV5(parsed.input, options),
      });
    case 'fate':
      return Object.freeze({
        id,
        index,
        kind: parsed.kind,
        notation: parsed.notation,
        result: rollFateDice(parsed.input, options),
      });
    case 'assimilation':
      return Object.freeze({
        id,
        index,
        kind: parsed.kind,
        notation: parsed.notation,
        result: rollAssimilation(parsed.input, options),
      });
  }
}

function resolvePhysicalValues(result: DiceRollResult): ReadonlyMap<string, number> {
  const values = new Map(result.dice.map((die) => [die.id, die.rawValue]));
  for (const event of result.events) {
    if (event.subject !== 'die') {
      continue;
    }
    if (event.type === 'roll') {
      values.set(event.dieId, event.value);
    } else if (event.type === 'reroll') {
      values.set(event.dieId, event.to);
    }
  }
  return values;
}

function flattenGenericDice(item: MixedGenericRollItem): readonly MixedGenericDieResult[] {
  const physicalValues = resolvePhysicalValues(item.result);
  return item.result.dice.map((die) => Object.freeze({
    ...die,
    id: `${item.id}:${die.id}`,
    sourceDieId: die.id,
    sourceNodeId: `${item.id}:${die.sourceNodeId}`,
    parentDieId: die.parentDieId === null ? null : `${item.id}:${die.parentDieId}`,
    groupId: `${item.id}:${die.groupId}`,
    mixedRollId: item.id,
    mixedRollIndex: item.index,
    physicalValue: physicalValues.get(die.id) ?? die.rawValue,
  }));
}

function flattenSystemDice(
  item: MixedVampireV5RollItem | MixedFateRollItem | MixedAssimilationRollItem,
): readonly MixedSystemDieResult[] {
  return item.result.dice.map((die) => Object.freeze({
    ...die,
    id: `${item.id}:${die.id}`,
    systemDieId: die.id,
    mixedRollId: item.id,
    mixedRollIndex: item.index,
    physicalValue: die.rawValue,
    included: true as const,
  }));
}

function flattenDice(items: readonly MixedRollItem[]): readonly MixedRollDieResult[] {
  const dice: MixedRollDieResult[] = [];
  for (const item of items) {
    if (item.kind === 'generic') {
      dice.push(...flattenGenericDice(item));
    } else {
      dice.push(...flattenSystemDice(item));
    }
  }
  return Object.freeze(dice);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatItem(item: MixedRollItem): string {
  switch (item.kind) {
    case 'generic':
      return item.result.output;
    case 'vampire-v5':
      return `${item.notation}: ${item.result.successes} successes (${item.result.outcome})`;
    case 'fate':
      return `${item.notation}: [${
        item.result.dice.map((die) => (
          die.fateValue < 0 ? '−' : die.fateValue > 0 ? '+' : '0'
        )).join(',')
      }] = ${signed(item.result.total)}`;
    case 'assimilation':
      return `${item.notation}: [${
        item.result.dice.map((die) => (
          die.symbols.length === 0 ? 'blank' : die.symbols.join('+')
        )).join(' | ')
      }] (keep ${item.result.keep})`;
  }
}

/**
 * Rolls generic and system dice together without treating unlike systems as
 * one arithmetic expression. Top-level semicolons delimit independently
 * evaluated rolls; each generic segment retains the complete V3 notation.
 */
export function rollMixedDice(
  input: string,
  options: MixedRollOptions = {},
): MixedRollResult {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new DiceRollError('Mixed dice notation is required', {
      code: 'DICE_NOTATION_REQUIRED',
      input: typeof input === 'string' ? input : '',
    });
  }

  const limits = createDiceLimits(options.limits);
  if (input.length > limits.maxInputLength) {
    throw new DiceRollError('Mixed dice notation exceeds the input-length limit', {
      code: 'INPUT_TOO_LONG',
      input,
      details: { length: input.length, limit: limits.maxInputLength },
    });
  }

  const segments = splitMixedNotation(input);
  const parsed = Object.freeze(segments.map((segmentInput, index) => (
    parseMixedRoll(segmentInput, input, index + 1, limits)
  )));
  assertStaticBudgets(parsed, limits, input);
  const notation = parsed.map((roll) => roll.notation).join('; ');

  const replayOption = 'replay' in options && options.replay !== undefined
    ? validateMixedReplay(options.replay, notation, parsed)
    : null;
  const seededOptions = options as MixedSeededRollOptions;
  const rootSeed = replayOption === null && seededOptions.seed !== undefined
    ? createProvidedSeed(seededOptions.seed, limits.maxSeedLength)
    : null;

  const items: MixedRollItem[] = [];
  let stats = EMPTY_STATS;
  let outputLength = 0;
  for (let index = 0; index < parsed.length; index += 1) {
    const parsedRoll = parsed[index];
    if (parsedRoll === undefined) {
      continue;
    }
    const itemLimits = createRemainingLimits(limits, stats, outputLength);
    const itemOptions = createItemOptions(
      options,
      itemLimits,
      index,
      rootSeed,
      replayOption,
    );
    const item = createMixedItem(parsedRoll, index, itemOptions);
    items.push(item);
    stats = addStats(stats, resultStats(item));
    outputLength += formatItem(item).length;
    assertRuntimeBudgets(stats, limits, input);
    if (outputLength > limits.maxOutputLength) {
      throw new DiceRollError('Mixed roll output exceeds the output-length limit', {
        code: 'OUTPUT_LIMIT_EXCEEDED',
        input,
        details: { outputLength, limit: limits.maxOutputLength },
      });
    }
  }

  const frozenItems = Object.freeze(items);
  const output = frozenItems.map(formatItem).join(' ; ');
  if (output.length > limits.maxOutputLength) {
    throw new DiceRollError('Mixed roll output exceeds the output-length limit', {
      code: 'OUTPUT_LIMIT_EXCEEDED',
      input,
      details: { outputLength: output.length, limit: limits.maxOutputLength },
    });
  }

  const replay = Object.freeze({
    type: 'mixed-roll-replay' as const,
    schemaVersion: 1 as const,
    notation,
    rolls: Object.freeze(frozenItems.map((item) => Object.freeze({
      kind: item.kind,
      notation: item.notation,
      replay: resultReplay(item),
    }))),
  });

  return Object.freeze({
    type: 'mixed-roll',
    schemaVersion: 1,
    input,
    notation,
    rolls: frozenItems,
    dice: flattenDice(frozenItems),
    output,
    replay,
    stats,
  });
}
