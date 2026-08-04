import { rollRpgDice } from '../engine.js';
import type { DiceRollResult, ResolvedDie, RollOptions } from '../types.js';
import {
  createSystemDieResult,
  readOptionalSystemInteger,
  readSystemInput,
  type SystemDieResult,
} from './common.js';

export const DAGGERHEART_HOPE_D12_PROFILE = 'daggerheart-hope-d12' as const;
export const DAGGERHEART_FEAR_D12_PROFILE = 'daggerheart-fear-d12' as const;

export type DaggerheartDieKind = 'hope' | 'fear';
export type DaggerheartFaceKey = DaggerheartDieKind;
export type DaggerheartSymbol = DaggerheartDieKind;
export type DaggerheartProfileId =
  | typeof DAGGERHEART_HOPE_D12_PROFILE
  | typeof DAGGERHEART_FEAR_D12_PROFILE;

export type DaggerheartHopeDieResult = SystemDieResult<
  typeof DAGGERHEART_HOPE_D12_PROFILE,
  'hope',
  'hope',
  'hope'
>;

export type DaggerheartFearDieResult = SystemDieResult<
  typeof DAGGERHEART_FEAR_D12_PROFILE,
  'fear',
  'fear',
  'fear'
>;

export type DaggerheartDieResult = DaggerheartHopeDieResult | DaggerheartFearDieResult;

export type DaggerheartDuality = 'hope' | 'fear' | 'critical';

/**
 * A Difficulty can be secret. In that case the roll still reports whether it
 * was made with Hope or Fear, but leaves success resolution to the table.
 */
export type DaggerheartOutcome =
  | 'pending-with-hope'
  | 'pending-with-fear'
  | 'success-with-hope'
  | 'success-with-fear'
  | 'failure-with-hope'
  | 'failure-with-fear'
  | 'critical-success';

export interface DaggerheartRollInput {
  /** Trait, Experience, and other numeric modifiers applied to the Duality Dice. */
  readonly modifier?: number;
  /** GM-set target number. Omit it when the Difficulty is secret or not applicable. */
  readonly difficulty?: number;
}

export interface DaggerheartRollResult {
  readonly type: 'daggerheart-roll';
  readonly schemaVersion: 1;
  readonly system: 'daggerheart';
  readonly rulesVersion: 1;
  readonly modifier: number;
  readonly difficulty: number | null;
  /** Sum of the two d12s before numeric modifiers. */
  readonly dualityTotal: number;
  /** Duality Dice plus modifier. */
  readonly total: number;
  /** Which die was higher; matching dice are a Critical Success. */
  readonly duality: DaggerheartDuality;
  /** True for Critical Success and resolved rolls, null when Difficulty is omitted. */
  readonly succeeds: boolean | null;
  readonly outcome: DaggerheartOutcome;
  readonly hopeDie: DaggerheartHopeDieResult;
  readonly fearDie: DaggerheartFearDieResult;
  readonly dice: readonly [DaggerheartHopeDieResult, DaggerheartFearDieResult];
  readonly baseRoll: DiceRollResult;
}

const HOPE_SYMBOLS = Object.freeze(['hope'] as const);
const FEAR_SYMBOLS = Object.freeze(['fear'] as const);
// Preserve integer precision after adding the two d12 values.
const MINIMUM_MODIFIER = Number.MIN_SAFE_INTEGER + 24;
const MAXIMUM_MODIFIER = Number.MAX_SAFE_INTEGER - 24;

const toHopeDie = (die: ResolvedDie): DaggerheartHopeDieResult =>
  createSystemDieResult(
    die,
    DAGGERHEART_HOPE_D12_PROFILE,
    'hope',
    'hope',
    HOPE_SYMBOLS,
  );

const toFearDie = (die: ResolvedDie): DaggerheartFearDieResult =>
  createSystemDieResult(
    die,
    DAGGERHEART_FEAR_D12_PROFILE,
    'fear',
    'fear',
    FEAR_SYMBOLS,
  );

const evaluateOutcome = (
  hope: number,
  fear: number,
  total: number,
  difficulty: number | undefined,
): Pick<DaggerheartRollResult, 'duality' | 'succeeds' | 'outcome'> => {
  if (hope === fear) {
    return {
      duality: 'critical',
      succeeds: true,
      outcome: 'critical-success',
    };
  }

  const duality = hope > fear ? 'hope' : 'fear';
  if (difficulty === undefined) {
    return {
      duality,
      succeeds: null,
      outcome: duality === 'hope' ? 'pending-with-hope' : 'pending-with-fear',
    };
  }

  const succeeds = total >= difficulty;
  if (succeeds) {
    return {
      duality,
      succeeds,
      outcome: duality === 'hope' ? 'success-with-hope' : 'success-with-fear',
    };
  }

  return {
    duality,
    succeeds,
    outcome: duality === 'hope' ? 'failure-with-hope' : 'failure-with-fear',
  };
};

/**
 * Rolls Daggerheart's two distinct d12 Duality Dice for an action roll.
 *
 * Matching values are a Critical Success and automatically succeed. Otherwise
 * the higher die decides whether the roll is made with Hope or Fear; an
 * optional Difficulty resolves success or failure from the total.
 */
export function rollDaggerheart(
  input: DaggerheartRollInput = {},
  options: RollOptions = {},
): DaggerheartRollResult {
  const source = readSystemInput(input, 'daggerheart');
  const modifier = readOptionalSystemInteger(
    source,
    'daggerheart',
    'modifier',
    MINIMUM_MODIFIER,
    MAXIMUM_MODIFIER,
  ) ?? 0;
  const difficulty = readOptionalSystemInteger(source, 'daggerheart', 'difficulty', 0);
  const baseRoll = rollRpgDice('1d12+1d12', options);
  const [hopeSourceDie, fearSourceDie] = baseRoll.dice;

  if (hopeSourceDie === undefined || fearSourceDie === undefined) {
    throw new Error('Daggerheart Duality Dice must resolve exactly two d12s.');
  }

  const hopeDie = toHopeDie(hopeSourceDie);
  const fearDie = toFearDie(fearSourceDie);
  const dualityTotal = hopeDie.rawValue + fearDie.rawValue;
  const total = dualityTotal + modifier;
  const evaluation = evaluateOutcome(hopeDie.rawValue, fearDie.rawValue, total, difficulty);

  return {
    type: 'daggerheart-roll',
    schemaVersion: 1,
    system: 'daggerheart',
    rulesVersion: 1,
    modifier,
    difficulty: difficulty ?? null,
    dualityTotal,
    total,
    ...evaluation,
    hopeDie,
    fearDie,
    dice: [hopeDie, fearDie],
    baseRoll,
  };
}
