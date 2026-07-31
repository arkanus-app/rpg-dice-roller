import { rollRpgDice } from '../engine.js';
import type { DiceRollResult, ResolvedDie, RollOptions } from '../types.js';
import {
  createSystemDieResult,
  invalidSystemInput,
  readOptionalSystemInteger,
  readSystemInput,
  type SystemDieResult,
} from './common.js';

export const ASSIMILATION_D6_PROFILE = 'assimilation-d6' as const;
export const ASSIMILATION_D10_PROFILE = 'assimilation-d10' as const;
export const ASSIMILATION_D12_PROFILE = 'assimilation-d12' as const;

export type AssimilationDieKind = 'd6' | 'd10' | 'd12';

export type AssimilationFaceKey =
  | 'blank'
  | 'pressure'
  | 'adaptation-pressure'
  | 'success'
  | 'double-success'
  | 'success-adaptation'
  | 'success-adaptation-pressure'
  | 'double-success-pressure'
  | 'success-double-adaptation-pressure'
  | 'double-pressure';

export type AssimilationSymbol = 'success' | 'adaptation' | 'pressure';

export type AssimilationProfileId =
  | typeof ASSIMILATION_D6_PROFILE
  | typeof ASSIMILATION_D10_PROFILE
  | typeof ASSIMILATION_D12_PROFILE;

export type AssimilationDieResult = SystemDieResult<
  AssimilationProfileId,
  AssimilationDieKind,
  AssimilationFaceKey,
  AssimilationSymbol
>;

export interface AssimilationRollInput {
  readonly d6?: number;
  readonly d10?: number;
  readonly d12?: number;
  readonly keep?: number;
}

export interface AssimilationRollResult {
  readonly type: 'assimilation-roll';
  readonly schemaVersion: 1;
  readonly system: 'assimilation';
  readonly rulesVersion: 1;
  readonly d6: number;
  readonly d10: number;
  readonly d12: number;
  readonly totalDice: number;
  readonly keep: number;
  readonly dice: readonly AssimilationDieResult[];
  readonly baseRoll: DiceRollResult;
}

export interface AssimilationSelectionResult {
  readonly type: 'assimilation-selection';
  readonly schemaVersion: 1;
  readonly system: 'assimilation';
  readonly selectedIds: readonly string[];
  readonly dice: readonly AssimilationDieResult[];
  readonly success: number;
  readonly adaptation: number;
  readonly pressure: number;
}

interface AssimilationFace {
  readonly faceKey: AssimilationFaceKey;
  readonly symbols: readonly AssimilationSymbol[];
}

function createAssimilationFace(
  faceKey: AssimilationFaceKey,
  symbols: readonly AssimilationSymbol[],
): AssimilationFace {
  return Object.freeze({ faceKey, symbols: Object.freeze(symbols.slice()) });
}

const BLANK = createAssimilationFace('blank', []);
const PRESSURE = createAssimilationFace('pressure', ['pressure']);
const ADAPTATION_PRESSURE = createAssimilationFace(
  'adaptation-pressure',
  ['adaptation', 'pressure'],
);
const SUCCESS = createAssimilationFace('success', ['success']);
const DOUBLE_SUCCESS = createAssimilationFace('double-success', ['success', 'success']);
const SUCCESS_ADAPTATION = createAssimilationFace(
  'success-adaptation',
  ['success', 'adaptation'],
);
const SUCCESS_ADAPTATION_PRESSURE = createAssimilationFace(
  'success-adaptation-pressure',
  ['success', 'adaptation', 'pressure'],
);
const DOUBLE_SUCCESS_PRESSURE = createAssimilationFace(
  'double-success-pressure',
  ['success', 'success', 'pressure'],
);
const SUCCESS_DOUBLE_ADAPTATION_PRESSURE = createAssimilationFace(
  'success-double-adaptation-pressure',
  ['success', 'adaptation', 'adaptation', 'pressure'],
);
const DOUBLE_PRESSURE = createAssimilationFace(
  'double-pressure',
  ['pressure', 'pressure'],
);

function assimilationFace(value: number): AssimilationFace {
  switch (value) {
    case 1:
    case 2:
      return BLANK;
    case 3:
    case 4:
      return PRESSURE;
    case 5:
      return ADAPTATION_PRESSURE;
    case 6:
      return SUCCESS;
    case 7:
      return DOUBLE_SUCCESS;
    case 8:
      return SUCCESS_ADAPTATION;
    case 9:
      return SUCCESS_ADAPTATION_PRESSURE;
    case 10:
      return DOUBLE_SUCCESS_PRESSURE;
    case 11:
      return SUCCESS_DOUBLE_ADAPTATION_PRESSURE;
    case 12:
      return DOUBLE_PRESSURE;
    default:
      throw new TypeError(`Unsupported Assimilation face: ${value}`);
  }
}

function toAssimilationDie(die: ResolvedDie): AssimilationDieResult {
  const face = assimilationFace(die.rawValue);
  switch (die.sides) {
    case 6:
      return createSystemDieResult(
        die,
        ASSIMILATION_D6_PROFILE,
        'd6',
        face.faceKey,
        face.symbols,
      );
    case 10:
      return createSystemDieResult(
        die,
        ASSIMILATION_D10_PROFILE,
        'd10',
        face.faceKey,
        face.symbols,
      );
    case 12:
      return createSystemDieResult(
        die,
        ASSIMILATION_D12_PROFILE,
        'd12',
        face.faceKey,
        face.symbols,
      );
    case 'F':
      throw new TypeError('Assimilation does not support Fudge dice');
    default:
      throw new TypeError(`Unsupported Assimilation die: d${String(die.sides)}`);
  }
}

function assimilationNotation(d6: number, d10: number, d12: number): string {
  const terms: string[] = [];
  if (d6 > 0) {
    terms.push(`${d6}d6`);
  }
  if (d10 > 0) {
    terms.push(`${d10}d10`);
  }
  if (d12 > 0) {
    terms.push(`${d12}d12`);
  }
  return terms.join('+');
}

/** Rolls an Assimilation pool without choosing any result automatically. */
export function rollAssimilation(
  input: AssimilationRollInput,
  options: RollOptions = {},
): AssimilationRollResult {
  const source = readSystemInput(input, 'assimilation');
  const d6 = readOptionalSystemInteger(source, 'assimilation', 'd6', 0) ?? 0;
  const d10 = readOptionalSystemInteger(source, 'assimilation', 'd10', 0) ?? 0;
  const d12 = readOptionalSystemInteger(source, 'assimilation', 'd12', 0) ?? 0;
  const totalDice = d6 + d10 + d12;

  if (!Number.isSafeInteger(totalDice) || totalDice < 1) {
    throw invalidSystemInput(
      'assimilation',
      'dice',
      'must contain at least one die and have a safe total',
    );
  }

  const keep = readOptionalSystemInteger(source, 'assimilation', 'keep', 1) ?? 1;
  if (keep > totalDice) {
    throw invalidSystemInput('assimilation', 'keep', 'cannot exceed the dice pool');
  }

  const baseRoll = rollRpgDice(assimilationNotation(d6, d10, d12), options);
  const dice = baseRoll.dice.map(toAssimilationDie);

  return {
    type: 'assimilation-roll',
    schemaVersion: 1,
    system: 'assimilation',
    rulesVersion: 1,
    d6,
    d10,
    d12,
    totalDice,
    keep,
    dice,
    baseRoll,
  };
}

/**
 * Selects up to `roll.keep` dice by unique system-die ID and aggregates their
 * symbols. The returned dice and IDs preserve the caller's selection order.
 */
export function evaluateAssimilationSelection(
  roll: AssimilationRollResult,
  selectedIds: readonly string[],
): AssimilationSelectionResult {
  if (!Array.isArray(selectedIds)) {
    throw invalidSystemInput('assimilation', 'selectedIds', 'must be an array');
  }
  if (selectedIds.length > roll.keep) {
    throw invalidSystemInput('assimilation', 'selectedIds', 'cannot exceed keep');
  }

  const diceById = new Map(roll.dice.map((die) => [die.id, die]));
  const seen = new Set<string>();
  const selected: AssimilationDieResult[] = [];
  let success = 0;
  let adaptation = 0;
  let pressure = 0;

  for (const id of selectedIds) {
    if (typeof id !== 'string' || id.length === 0) {
      throw invalidSystemInput(
        'assimilation',
        'selectedIds',
        'must contain non-empty strings',
      );
    }
    if (seen.has(id)) {
      throw invalidSystemInput('assimilation', 'selectedIds', 'must contain unique IDs');
    }
    const die = diceById.get(id);
    if (die === undefined) {
      throw invalidSystemInput('assimilation', 'selectedIds', 'contains an unknown ID');
    }

    seen.add(id);
    selected.push(die);
    for (const symbol of die.symbols) {
      switch (symbol) {
        case 'success':
          success += 1;
          break;
        case 'adaptation':
          adaptation += 1;
          break;
        case 'pressure':
          pressure += 1;
          break;
      }
    }
  }

  return {
    type: 'assimilation-selection',
    schemaVersion: 1,
    system: 'assimilation',
    selectedIds: selectedIds.slice(),
    dice: selected,
    success,
    adaptation,
    pressure,
  };
}
