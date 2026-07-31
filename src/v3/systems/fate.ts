import { rollRpgDice } from '../engine.js';
import type { DiceRollResult, ResolvedDie, RollOptions } from '../types.js';
import {
  createSystemDieResult,
  readOptionalSystemInteger,
  readSystemInput,
  type SystemDieResult,
} from './common.js';

export const FATE_DF_PROFILE = 'fate-df' as const;

export type FateDieKind = 'fate';
export type FateFaceKey = 'minus' | 'blank' | 'plus';
export type FateSymbol = 'minus' | 'plus';
export type FateValue = -1 | 0 | 1;

export type FateDieResult = SystemDieResult<
  typeof FATE_DF_PROFILE,
  FateDieKind,
  FateFaceKey,
  FateSymbol
> & {
  /** The Fate contribution represented by the physical d6 face. */
  readonly fateValue: FateValue;
};

export interface FateRollInput {
  /** Number of Fate dice. Defaults to the standard pool of four. */
  readonly dice?: number;
}

export interface FateRollResult {
  readonly type: 'fate-roll';
  readonly schemaVersion: 1;
  readonly system: 'fate';
  readonly rulesVersion: 1;
  readonly diceCount: number;
  /** Sum of `fateValue`, ranging from `-diceCount` to `diceCount`. */
  readonly total: number;
  readonly dice: readonly FateDieResult[];
  readonly baseRoll: DiceRollResult;
}

interface FateFace {
  readonly faceKey: FateFaceKey;
  readonly symbols: readonly FateSymbol[];
  readonly fateValue: FateValue;
}

const MINUS_FACE: FateFace = Object.freeze({
  faceKey: 'minus',
  symbols: Object.freeze(['minus'] as const),
  fateValue: -1,
});
const BLANK_FACE: FateFace = Object.freeze({
  faceKey: 'blank',
  symbols: Object.freeze([]),
  fateValue: 0,
});
const PLUS_FACE: FateFace = Object.freeze({
  faceKey: 'plus',
  symbols: Object.freeze(['plus'] as const),
  fateValue: 1,
});

function fateFace(value: number): FateFace {
  if (value === 1 || value === 2) {
    return MINUS_FACE;
  }
  if (value === 3 || value === 4) {
    return BLANK_FACE;
  }
  if (value === 5 || value === 6) {
    return PLUS_FACE;
  }
  throw new TypeError(`Unsupported Fate face: ${value}`);
}

function toFateDie(die: ResolvedDie): FateDieResult {
  const face = fateFace(die.rawValue);
  return {
    ...createSystemDieResult(
      die,
      FATE_DF_PROFILE,
      'fate',
      face.faceKey,
      face.symbols,
    ),
    fateValue: face.fateValue,
  };
}

/**
 * Rolls Fate/Fudge dice while retaining an auditable physical d6 face.
 *
 * Faces 1-2 are minus, 3-4 are blank, and 5-6 are plus.
 */
export function rollFateDice(
  input: FateRollInput = {},
  options: RollOptions = {},
): FateRollResult {
  const source = readSystemInput(input, 'fate');
  const diceCount = readOptionalSystemInteger(source, 'fate', 'dice', 1) ?? 4;
  const baseRoll = rollRpgDice(`${diceCount}d6`, options);
  const dice = baseRoll.dice.map(toFateDie);
  const total = dice.reduce((sum, die) => sum + die.fateValue, 0);

  return {
    type: 'fate-roll',
    schemaVersion: 1,
    system: 'fate',
    rulesVersion: 1,
    diceCount,
    total,
    dice,
    baseRoll,
  };
}
