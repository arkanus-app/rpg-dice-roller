export declare const DEFAULT_MAX_TOTAL_DICE = 9999;
export declare const DEFAULT_MAX_MULTI_ROLLS = 100;
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
/**
 * Extracts user-facing comments without coupling the dice engine to a chat platform.
 */
export declare function extractRpgDiceComment(input: string): string;
/**
 * Removes comments and whitespace from notation while preserving dice semantics.
 */
export declare function cleanRpgDiceNotation(input: string): string;
/**
 * Applies ERPG/Kraken-friendly notation aliases before handing the formula to the parser.
 */
export declare function normalizeRpgDiceNotation(input: string): string;
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
/**
 * Rolls an RPG dice notation with ERPG/Kraken aliases and a platform-neutral result shape.
 */
export declare function rollRpgDice(input: string, options?: RpgDiceRollOptions): RpgDiceRollResult;
/**
 * Checks whether an input can be resolved by the RPG dice facade.
 */
export declare function verifyRpgDiceNotation(input: string, options?: RpgDiceRollOptions): boolean;
