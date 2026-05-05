import DiceRoll from './DiceRoll.js';
/**
 * history of log rolls
 *
 * @type {symbol}
 *
 * @private
 */
declare const logSymbol: unique symbol;
export interface DiceRollerImportData {
    log?: unknown[];
}
export interface DiceRollerJson {
    log: DiceRoll[];
    output: string;
    total: number;
    type: 'dice-roller';
}
/**
 * A `DiceRoller` handles dice rolling functionality, keeps a history of rolls and can output logs
 * etc.
 *
 * @see {@link DiceRoll} if you don't need to keep a log history of rolls
 */
declare class DiceRoller {
    private [logSymbol];
    /**
     * Create a DiceRoller.
     *
     * The optional `data` property should be either an array of `DiceRoll` objects, or an object with
     * a `log` property that contains the `DiceRoll` objects.
     *
     * @param {{log: DiceRoll[]}|DiceRoll[]} [data] The data to import
     * @param {DiceRoll[]} [data.log] If `data` is an object, it must contain an array of `DiceRoll`s
     *
     * @throws {TypeError} if data is an object, it must have a `log[]` property
     */
    constructor(data?: DiceRollerImportData | DiceRoll[] | string);
    /**
     * The list of roll logs.
     *
     * @returns {DiceRoll[]}
     */
    get log(): DiceRoll[];
    /**
     * String representation of the rolls in the log
     *
     * @example
     * 2d20+1d6: [20,2]+[2] = 24; 1d8: [6] = 6
     *
     * @returns {string}
     */
    get output(): string;
    /**
     * The sum of all the rolls in the log
     *
     * @see {@link DiceRoller#log}
     *
     * @returns {number}
     */
    get total(): number;
    /**
     * Clear the roll history log.
     *
     * @see {@link DiceRoller#log}
     */
    clearLog(): void;
    /**
     * Export the object in the given format.
     * If no format is specified, JSON is returned.
     *
     * @see {@link DiceRoller#toJSON}
     *
     * @param {exportFormats} [format=exportFormats#JSON] The format to export the data as
     *
     * @returns {string|null} The exported data, in the specified format
     *
     * @throws {TypeError} Invalid export format
     */
    export(format?: number): string | DiceRollerJson;
    /**
     * Add the data to the existing [roll log]{@link DiceRoller#log}.
     *
     * `data` can be an array of `DiceRoll` objects, an object with a `log` property that contains
     * `DiceRoll` objects, or a JSON / base64 encoded representation of either.
     *
     * @see {@link DiceRoller#log}
     *
     * @param {string|{log: DiceRoll[]}|DiceRoll[]} data The data to import
     * @param {DiceRoll[]} [data.log] If `data` is an object, it must contain an array of `DiceRoll`s
     *
     * @returns {DiceRoll[]} The roll log
     *
     * @throws {DataFormatError} data format invalid
     * @throws {RequiredArgumentError} data is required
     * @throws {TypeError} log must be an array
     */
    import(data: unknown): DiceRoll[];
    /**
     * Roll the given dice notation(s) and return the corresponding `DiceRoll` objects.
     *
     * You can roll a single notation, or multiple at once.
     *
     * @example <caption>Single notation</caption>
     * diceRoller.roll('2d6');
     *
     * @example <caption>Multiple notations</caption>
     * roll('2d6', '4d10', 'd8+4d6');
     *
     * @param {...string} notations The notations to roll
     *
     * @returns {DiceRoll|DiceRoll[]} If a single notation is passed, a single `DiceRoll` is returned,
     * otherwise an array of `DiceRoll` objects is returned
     *
     * @throws {NotationError} notation is invalid
     * @throws {RequiredArgumentError} notation is required
     */
    roll(...notations: string[]): DiceRoll | DiceRoll[];
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @returns {{output: string, total: number, log: DiceRoll[], type: string}}
     */
    toJSON(): DiceRollerJson;
    /**
     * Return the String representation of the object.
     *
     * This is called automatically when casting the object to a string.
     *
     * @returns {string}
     *
     * @see {@link DiceRoller#output}
     */
    toString(): string;
    /**
     * Create a new `DiceRoller` instance with the given data.
     *
     * `data` can be an array of `DiceRoll` objects, an object with a `log` property that contains the
     * `DiceRoll` objects, or a JSON / base64 encoded representation of either.
     *
     * @see instance method {@link DiceRoller#import}
     *
     * @param {string|{log: DiceRoll[]}|DiceRoll[]} data The data to import
     * @param {DiceRoll[]} [data.log] If `data` is an object, it must contain an array of `DiceRoll`s
     *
     * @returns {DiceRoller} The new `DiceRoller` instance
     *
     * @throws {DataFormatError} data format invalid
     * @throws {RequiredArgumentError} data is required
     * @throws {TypeError} log must be an array
     */
    static import(data: unknown): DiceRoller;
}
export default DiceRoller;
