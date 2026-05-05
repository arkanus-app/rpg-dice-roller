import HasDescription from '../traits/HasDescription.js';
import Modifier from '../modifiers/Modifier.js';
import RollResult from '../results/RollResult.js';
import RollResults from '../results/RollResults.js';
import type Description from '../Description.js';
declare const modifiersSymbol: unique symbol;
declare const qtySymbol: unique symbol;
declare const sidesSymbol: unique symbol;
declare const minSymbol: unique symbol;
declare const maxSymbol: unique symbol;
export type DiceSides = number | string;
export type DiceModifierMap = Map<string, Modifier>;
export type DiceModifierInput = DiceModifierMap | Modifier[] | Record<string, Modifier> | null;
export interface StandardDiceJson {
    average: number;
    description: Description | null;
    max: number;
    min: number;
    modifiers: DiceModifierMap | null;
    name: string;
    notation: string;
    qty: number;
    sides: DiceSides;
    type: 'die';
}
/**
 * Represents a standard numerical die.
 */
declare class StandardDice extends HasDescription {
    private [modifiersSymbol];
    private [qtySymbol];
    private [sidesSymbol];
    private [minSymbol];
    private [maxSymbol];
    /**
     * Create a `StandardDice` instance.
     *
     * @param {number} sides The number of sides the die has (.e.g `6`)
     * @param {number} [qty=1] The number of dice to roll (e.g. `4`)
     * @param {Map<string, Modifier>|Modifier[]|{}|null} [modifiers] The modifiers that affect the die
     * @param {number|null} [min=1] The minimum possible roll value
     * @param {number|null} [max=null] The maximum possible roll value. Defaults to number of `sides`
     * @param {Description|string|null} [description=null] The roll description.
     *
     * @throws {RequiredArgumentError} sides is required
     * @throws {TypeError} qty must be a positive integer, and modifiers must be valid
     */
    constructor(sides: DiceSides, qty?: number, modifiers?: DiceModifierInput, min?: number | null, max?: number | null, description?: unknown);
    /**
     * The average value that the die can roll (Excluding modifiers).
     *
     * @returns {number}
     */
    get average(): number;
    /**
     * The modifiers that affect this die roll.
     *
     * @returns {Map<string, Modifier>|null}
     */
    get modifiers(): DiceModifierMap | null;
    /**
     * Set the modifiers that affect this roll.
     *
     * @param {Map<string, Modifier>|Modifier[]|{}|null} value
     *
     * @throws {TypeError} Modifiers should be a Map, array of Modifiers, or an Object
     */
    set modifiers(value: DiceModifierInput);
    /**
     * The maximum value that can be rolled on the die, excluding modifiers.
     *
     * @returns {number}
     */
    get max(): number;
    /**
     * The minimum value that can be rolled on the die, excluding modifiers.
     *
     * @returns {number}
     */
    get min(): number;
    /**
     * The name of the die.
     *
     * @returns {string} 'standard'
     */
    get name(): string;
    /**
     * The dice notation. e.g. `4d6!`.
     *
     * @returns {string}
     */
    get notation(): string;
    /**
     * The number of dice that should be rolled.
     *
     * @returns {number}
     */
    get qty(): number;
    /**
     * The number of sides the die has.
     *
     * @returns {number}
     */
    get sides(): DiceSides;
    /**
     * Roll the dice for the specified quantity and apply any modifiers.
     *
     * @returns {RollResults} The result of the roll
     */
    roll(): RollResults;
    /**
     * Roll a single die and return the value.
     *
     * @returns {RollResult} The value rolled
     */
    rollOnce(): RollResult;
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @returns {{
     *  average: number,
     *  min: number,
     *  max: number,
     *  notation: string,
     *  qty: number,
     *  name: string,
     *  sides: number,
     *  modifiers: (Map<string, Modifier>|null),
     *  type: string
     * }}
     */
    toJSON(): StandardDiceJson;
    /**
     * Return the String representation of the object.
     *
     * This is called automatically when casting the object to a string.
     *
     * @see {@link StandardDice#notation}
     *
     * @returns {string}
     */
    toString(): string;
}
export default StandardDice;
