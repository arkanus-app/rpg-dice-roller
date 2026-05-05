import { cleanRpgDiceNotation, extractRpgDiceComment, normalizeRpgDiceNotation } from './rpg/normalization.js';
import { RpgDiceRollError, type RpgDiceRollErrorCode, type RpgDiceRollErrorDetails, type RpgDiceRollErrorOptions } from './rpg/errors.js';
export declare const DEFAULT_MAX_TOTAL_DICE = 9999;
export declare const DEFAULT_MAX_MULTI_ROLLS = 100;
export interface RpgDiceRollOptions {
    maxDice?: number;
    maxRolls?: number;
    seed?: number | string;
}
export { cleanRpgDiceNotation, extractRpgDiceComment, normalizeRpgDiceNotation, RpgDiceRollError, };
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
    wasTargetSuccess: boolean;
    wasTargetFailure: boolean;
    wasTargetNeutral: boolean;
    sourceId: string | null;
    modifierReasons: string[];
}
export type RpgDiceRollEventType = 'roll' | 'explode' | 'reroll' | 'drop' | 'critical-success' | 'critical-failure';
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
export interface RpgDicePoolSummary {
    successes: number;
    failures: number;
    netSuccesses: number;
    hasTarget: boolean;
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
    pool: RpgDicePoolSummary;
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
    pool: RpgDicePoolSummary;
    rolls: RpgDiceRollEntry[];
}
/**
 * Parses raw RPG dice input into normalized notation and platform-neutral metadata.
 */
export declare function parseRpgDiceInput(input: string): RpgDiceInput;
/**
 * Lists static dice groups in notation order.
 */
export declare function extractRpgDiceGroups(notation: string): RpgDiceGroup[];
/**
 * Counts static dice in a notation string.
 */
export declare function countRpgDiceInNotation(notation: string): number;
export declare function inspectRpgDiceNotation(input: string, options?: RpgDiceRollOptions): RpgDiceNotationInspection;
/**
 * Rolls an RPG dice notation with ERPG/Kraken aliases and a platform-neutral result shape.
 */
export declare function rollRpgDice(input: string, options?: RpgDiceRollOptions): RpgDiceRollResult;
/**
 * Checks whether an input can be resolved by the RPG dice facade.
 */
export declare function verifyRpgDiceNotation(input: string, options?: RpgDiceRollOptions): boolean;
