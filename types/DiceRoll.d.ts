import { type NumberGeneratorEngine } from './utilities/NumberGenerator.js';
import RollResults from './results/RollResults.js';
import ResultGroup from './results/ResultGroup.js';
/**
 * The notation
 *
 * @type {symbol}
 *
 * @private
 */
declare const notationSymbol: unique symbol;
/**
 * The maximum possible roll total
 *
 * @type {symbol}
 *
 * @private
 */
declare const maxTotalSymbol: unique symbol;
/**
 * The minimum possible roll total
 *
 * @type {symbol}
 *
 * @private
 */
declare const minTotalSymbol: unique symbol;
/**
 * List of expressions to roll
 *
 * @type {symbol}
 *
 * @private
 */
declare const expressionsSymbol: unique symbol;
/**
 * Method for rolling dice
 *
 * @type {symbol}
 *
 * @private
 */
declare const rollMethodSymbol: unique symbol;
/**
 * List of rolls
 *
 * @type {symbol}
 *
 * @private
 */
declare const rollsSymbol: unique symbol;
/**
 * Set the rolls
 *
 * @private
 *
 * @type {symbol}
 */
declare const setRollsSymbol: unique symbol;
/**
 * The roll total
 *
 * @type {symbol}
 *
 * @private
 */
declare const totalSymbol: unique symbol;
export type DiceRollImportRoll = ResultGroup | RollResults | string | number | RollResults[] | ResultGroup[] | unknown[];
export interface DiceRollImportData {
    notation: string;
    rolls?: ResultGroup | RollResults | DiceRollImportRoll[];
}
export interface DiceRollJson {
    averageTotal: number;
    maxTotal: number;
    minTotal: number;
    notation: string;
    output: string;
    rolls: Array<ResultGroup | RollResults | string | number>;
    total: number;
    type: 'dice-roll';
}
/**
 * A `DiceRoll` handles rolling of a single dice notation and storing the result.
 *
 * @see {@link DiceRoller} if you need to keep a history of rolls
 */
declare class DiceRoll {
    private [notationSymbol];
    private [maxTotalSymbol];
    private [minTotalSymbol];
    private [expressionsSymbol];
    private [rollsSymbol];
    private [totalSymbol];
    /**
     * Create a DiceRoll, parse the notation and roll the dice.
     *
     * If `notation` is an object, it must contain a `notation` property that defines the notation.
     * It can also have an optional array of `RollResults`, in the `rolls` property.
     *
     * @example <caption>String notation</caption>
     * const roll = new DiceRoll('4d6');
     *
     * @example <caption>Object</caption>
     * const roll = new DiceRoll({
     *   notation: '4d6',
     *   rolls: ..., // RollResults object or array of roll results
     * });
     *
     * @param {string|{notation: string, rolls: ResultGroup|Array.<ResultGroup|RollResults|string|number>}} notation The notation to roll
     * @param {string} notation.notation If `notation is an object; the notation to roll
     * @param {ResultGroup|Array.<ResultGroup|RollResults|string|number>} [notation.rolls] If
     * `notation` is an object; the rolls to import
     *
     * @throws {NotationError} notation is invalid
     * @throws {RequiredArgumentError} notation is required
     * @throws {TypeError} Rolls must be a valid result object, or an array
     */
    constructor(notation: string | DiceRollImportData);
    /**
     * The average possible total for the notation.
     *
     * @since 4.3.0
     *
     * @returns {number}
     */
    get averageTotal(): number;
    /**
     * The maximum possible total for the notation.
     *
     * @since 4.3.0
     *
     * @returns {number}
     */
    get maxTotal(): number;
    /**
     * The minimum possible total for the notation.
     *
     * @since 4.3.0
     *
     * @returns {number}
     */
    get minTotal(): number;
    /**
     * The dice notation.
     *
     * @returns {string}
     */
    get notation(): string;
    /**
     * String representation of the rolls
     *
     * @example
     * 2d20+1d6: [20,2]+[2] = 24
     *
     * @returns {string}
     */
    get output(): string;
    /**
     * The dice rolled for the notation
     *
     * @returns {Array.<ResultGroup|RollResults|string|number>}
     */
    get rolls(): Array<ResultGroup | RollResults | string | number>;
    /**
     * The roll total
     *
     * @returns {number}
     */
    get total(): number;
    /**
     * Export the object in the given format.
     * If no format is specified, JSON is returned.
     *
     * @see {@link DiceRoll#toJSON}
     *
     * @param {exportFormats} [format=exportFormats.JSON] The format to export the data as
     *
     * @returns {string|null} The exported data, in the specified format
     *
     * @throws {TypeError} Invalid export format
     */
    export(format?: number): string | DiceRollJson;
    /**
     * Check whether the DiceRoll has expressions or not.
     *
     * @returns {boolean} `true` if the object has expressions, `false` otherwise
     */
    hasExpressions(): boolean;
    /**
     * Check whether the object has rolled dice or not
     *
     * @returns {boolean} `true` if the object has rolls, `false` otherwise
     */
    hasRolls(): boolean;
    /**
     * Roll the dice for the stored notation.
     *
     * This is called in the constructor, so you'll only need this if you want to re-roll the
     * notation. However, it's usually better to create a new `DiceRoll` instance instead.
     *
     * @returns {RollResults[]} The results of the rolls
     */
    roll(): Array<ResultGroup | RollResults | string | number>;
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @returns {{
     *  output: string,
     *  total: number,
     *  minTotal: number,
     *  maxTotal: number,
     *  notation: string,
     *  rolls: RollResults[],
     *  type: string
     * }}
     */
    toJSON(): DiceRollJson;
    /**
     * Return the String representation of the object.
     *
     * This is called automatically when casting the object to a string.
     *
     * @returns {string}
     *
     * @see {@link DiceRoll#output}
     */
    toString(): string;
    /**
     * Create a new `DiceRoll` instance with the given data.
     *
     * `data` can be an object of data, a JSON / base64 encoded string of such data.
     *
     * The object must contain a `notation` property that defines the notation and, optionally, an
     * array of RollResults, in the `rolls` property.
     *
     * @example <caption>Object</caption>
     * DiceRoll.import({
     *   notation: '4d6',
     *   rolls: ..., // ResultGroup object or array of roll results
     * });
     *
     * @example <caption>JSON</caption>
     * DiceRoll.import('{"notation":"4d6","rolls":[...]}');
     *
     * @example <caption>Base64</caption>
     * DiceRoll.import('eyJub3RhdGlvbiI6IjRkNiIsInJvbGxzIjpbXX0=');
     *
     * @param {{notation: string, rolls: RollResults[]}|string} data The data to import
     * @param {string} data.notation If `notation` is an object; the notation to import
     * @param {RollResults[]} [data.rolls] If `notation` is an object; the rolls to import
     *
     * @returns {DiceRoll} The new `DiceRoll` instance
     *
     * @throws {DataFormatError} data format is invalid
     */
    static import(data: unknown): DiceRoll;
    /**
     * Roll the dice and return the result.
     *
     * If the engine is passed, it will be used for the number generation for **this roll only**.
     * The engine will be reset after use.
     *
     * @private
     *
     * @param {{next(): number}} [engine] The RNG engine to use for die rolls
     *
     * @returns {ResultGroup} The result of the rolls
     *
     * @throws {TypeError} engine must have function `next()`
     */
    [rollMethodSymbol](engine?: NumberGeneratorEngine): ResultGroup;
    /**
     * Set the rolls.
     *
     * @private
     *
     * @param {ResultGroup|Array.<ResultGroup|RollResults|string|number|{}|Array.<RollResult|number>>} rolls
     *
     * @throws {TypeError} Rolls must be a valid result object, or an array
     */
    [setRollsSymbol](rolls: unknown): void;
}
export default DiceRoll;
