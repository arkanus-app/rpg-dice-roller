import type { ModifierContext, ModifierDefaults, ModifierResult } from './types.js';
export interface ModifierJson {
    name: string;
    notation: string;
    type: 'modifier';
}
/**
 * A `Modifier` is the base modifier class that all others extend from.
 *
 * @abstract
 */
declare class Modifier {
    /**
     * The default modifier execution order.
     *
     * @type {number}
     */
    static order: number;
    order: number;
    [key: string]: unknown;
    /**
     * Create a `Modifier` instance.
     */
    constructor();
    /**
     * The name of the modifier.
     *
     * @returns {string} 'modifier'
     */
    get name(): string;
    /**
     * The modifier's notation.
     *
     * @returns {string}
     */
    get notation(): string;
    /**
     * The maximum number of iterations that the modifier can apply to a single die roll
     *
     * @returns {number} `1000`
     */
    get maxIterations(): number;
    /**
     * No default values present
     *
     * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
     *
     * @returns {object}
     */
    defaults(_context: ModifierContext): ModifierDefaults;
    /**
     * Processing default values definitions
     *
     * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
     *
     * @returns {void}
     */
    useDefaultsIfNeeded(_context: ModifierContext): void;
    /**
     * Run the modifier on the results.
     *
     * @param {RollResults} results The results to run the modifier against
     * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
     *
     * @returns {RollResults} The modified results
     */
    run(results: ModifierResult, _context: ModifierContext): ModifierResult;
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @returns {{notation: string, name: string, type: string}}
     */
    toJSON(): ModifierJson;
    /**
     * Return the String representation of the object.
     *
     * This is called automatically when casting the object to a string.
     *
     * @see {@link Modifier#notation}
     *
     * @returns {string}
     */
    toString(): string;
}
export default Modifier;
