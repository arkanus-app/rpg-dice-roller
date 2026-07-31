import { rollRpgDice } from '../engine.js';
import type { DiceRollResult, ResolvedDie, RollOptions } from '../types.js';
import {
  createSystemDieResult,
  readOptionalSystemInteger,
  readRequiredSystemInteger,
  readSystemInput,
  type SystemDieResult,
} from './common.js';

export const VAMPIRE_V5_NORMAL_D10_PROFILE = 'vampire-v5-normal-d10' as const;
export const VAMPIRE_V5_HUNGER_D10_PROFILE = 'vampire-v5-hunger-d10' as const;

export type VampireV5DieKind = 'normal' | 'hunger';

export type VampireV5NormalFaceKey = 'blank' | 'critical' | 'success';

export type VampireV5HungerFaceKey =
  | 'bestial-failure'
  | 'blank'
  | 'messy-critical'
  | 'success';

export type VampireV5FaceKey = VampireV5NormalFaceKey | VampireV5HungerFaceKey;

export type VampireV5Symbol =
  | 'bestial-failure'
  | 'critical'
  | 'messy-critical'
  | 'success';

export type VampireV5NormalDieResult = SystemDieResult<
  typeof VAMPIRE_V5_NORMAL_D10_PROFILE,
  'normal',
  VampireV5NormalFaceKey,
  VampireV5Symbol
>;

export type VampireV5HungerDieResult = SystemDieResult<
  typeof VAMPIRE_V5_HUNGER_D10_PROFILE,
  'hunger',
  VampireV5HungerFaceKey,
  VampireV5Symbol
>;

export type VampireV5DieResult = VampireV5NormalDieResult | VampireV5HungerDieResult;

export type VampireV5Outcome =
  | 'pending'
  | 'success'
  | 'critical-success'
  | 'messy-critical'
  | 'failure'
  | 'bestial-failure';

export interface VampireV5RollInput {
  readonly pool: number;
  readonly hunger: number;
  readonly difficulty?: number;
}

export interface VampireV5RollResult {
  readonly type: 'vampire-v5-roll';
  readonly schemaVersion: 1;
  readonly system: 'vampire-v5';
  readonly rulesVersion: 1;
  readonly pool: number;
  readonly hunger: number;
  readonly difficulty: number | null;
  readonly normalDice: number;
  readonly hungerDice: number;
  readonly successes: number;
  readonly criticalPairs: number;
  readonly outcome: VampireV5Outcome;
  readonly dice: readonly VampireV5DieResult[];
  readonly baseRoll: DiceRollResult;
}

const NO_SYMBOLS: readonly VampireV5Symbol[] = Object.freeze([]);
const SUCCESS_SYMBOLS: readonly VampireV5Symbol[] = Object.freeze(['success']);
const CRITICAL_SYMBOLS: readonly VampireV5Symbol[] = Object.freeze(['success', 'critical']);
const BESTIAL_FAILURE_SYMBOLS: readonly VampireV5Symbol[] = Object.freeze([
  'bestial-failure',
]);
const MESSY_CRITICAL_SYMBOLS: readonly VampireV5Symbol[] = Object.freeze([
  'success',
  'critical',
  'messy-critical',
]);

function toNormalDie(die: ResolvedDie): VampireV5NormalDieResult {
  if (die.rawValue === 10) {
    return createSystemDieResult(
      die,
      VAMPIRE_V5_NORMAL_D10_PROFILE,
      'normal',
      'critical',
      CRITICAL_SYMBOLS,
    );
  }
  if (die.rawValue >= 6) {
    return createSystemDieResult(
      die,
      VAMPIRE_V5_NORMAL_D10_PROFILE,
      'normal',
      'success',
      SUCCESS_SYMBOLS,
    );
  }
  return createSystemDieResult(
    die,
    VAMPIRE_V5_NORMAL_D10_PROFILE,
    'normal',
    'blank',
    NO_SYMBOLS,
  );
}

function toHungerDie(die: ResolvedDie): VampireV5HungerDieResult {
  if (die.rawValue === 1) {
    return createSystemDieResult(
      die,
      VAMPIRE_V5_HUNGER_D10_PROFILE,
      'hunger',
      'bestial-failure',
      BESTIAL_FAILURE_SYMBOLS,
    );
  }
  if (die.rawValue === 10) {
    return createSystemDieResult(
      die,
      VAMPIRE_V5_HUNGER_D10_PROFILE,
      'hunger',
      'messy-critical',
      MESSY_CRITICAL_SYMBOLS,
    );
  }
  if (die.rawValue >= 6) {
    return createSystemDieResult(
      die,
      VAMPIRE_V5_HUNGER_D10_PROFILE,
      'hunger',
      'success',
      SUCCESS_SYMBOLS,
    );
  }
  return createSystemDieResult(
    die,
    VAMPIRE_V5_HUNGER_D10_PROFILE,
    'hunger',
    'blank',
    NO_SYMBOLS,
  );
}

function evaluateVampireV5(
  dice: readonly VampireV5DieResult[],
  difficulty: number | undefined,
): Pick<VampireV5RollResult, 'successes' | 'criticalPairs' | 'outcome'> {
  let baseSuccesses = 0;
  let tens = 0;
  let hasHungerTen = false;
  let hasHungerOne = false;

  for (const die of dice) {
    if (die.rawValue >= 6) {
      baseSuccesses += 1;
    }
    if (die.rawValue === 10) {
      tens += 1;
      hasHungerTen ||= die.dieKind === 'hunger';
    } else if (die.rawValue === 1 && die.dieKind === 'hunger') {
      hasHungerOne = true;
    }
  }

  const criticalPairs = Math.floor(tens / 2);
  const successes = baseSuccesses + (criticalPairs * 2);
  let outcome: VampireV5Outcome = 'pending';

  if (difficulty !== undefined) {
    if (successes >= difficulty) {
      if (criticalPairs > 0) {
        outcome = hasHungerTen ? 'messy-critical' : 'critical-success';
      } else {
        outcome = 'success';
      }
    } else {
      outcome = hasHungerOne ? 'bestial-failure' : 'failure';
    }
  }

  return { successes, criticalPairs, outcome };
}

function vampireNotation(normalDice: number, hungerDice: number): string {
  const terms: string[] = [];
  if (normalDice > 0) {
    terms.push(`${normalDice}d10`);
  }
  if (hungerDice > 0) {
    terms.push(`${hungerDice}d10`);
  }
  return terms.join('+');
}

/** Rolls and evaluates a Vampire: The Masquerade Fifth Edition dice pool. */
export function rollVampireV5(
  input: VampireV5RollInput,
  options: RollOptions = {},
): VampireV5RollResult {
  const source = readSystemInput(input, 'vampire-v5');
  const pool = readRequiredSystemInteger(source, 'vampire-v5', 'pool', 1);
  const hunger = readRequiredSystemInteger(source, 'vampire-v5', 'hunger', 0, 5);
  const difficulty = readOptionalSystemInteger(source, 'vampire-v5', 'difficulty', 0);
  const hungerDice = Math.min(pool, hunger);
  const normalDice = pool - hungerDice;
  const baseRoll = rollRpgDice(vampireNotation(normalDice, hungerDice), options);
  const dice = baseRoll.dice.map((die, index) => (
    index < normalDice ? toNormalDie(die) : toHungerDie(die)
  ));
  const evaluation = evaluateVampireV5(dice, difficulty);

  return {
    type: 'vampire-v5-roll',
    schemaVersion: 1,
    system: 'vampire-v5',
    rulesVersion: 1,
    pool,
    hunger,
    difficulty: difficulty ?? null,
    normalDice,
    hungerDice,
    ...evaluation,
    dice,
    baseRoll,
  };
}
