import Modifier from './Modifier.js';
import type { ModifierContext } from './types.js';
import type RollResults from '../results/RollResults.js';
declare const maxSymbol: unique symbol;
export interface MaxModifierJson {
    notation: string;
    name: string;
    type: 'modifier';
    max: number;
}
/**
 * A `MaxModifier` causes die rolls over a maximum value to be treated as the maximum value.
 *
 * @since 4.3.0
 *
 * @see {@link MinModifier} for the opposite of this modifier
 *
 * @extends {Modifier}
 */
declare class MaxModifier extends Modifier {
    private [maxSymbol];
    /**
     * The default modifier execution order.
     *
     * @type {number}
     */
    static order: number;
    /**
     * Create a `MaxModifier` instance.
     *
     * @param {number} max The maximum value
     *
     * @throws {TypeError} max must be a number
     */
    constructor(max: number | string);
    /**
     * The maximum value.
     *
     * @returns {Number}
     */
    get max(): number;
    /**
     * Set the maximum value.
     *
     * @param {number} value
     *
     * @throws {TypeError} max must be a number
     */
    set max(value: number | string);
    /**
     * The name of the modifier.
     *
     * @returns {string} 'max'
     */
    get name(): string;
    /**
     * The modifier's notation.
     *
     * @returns {string}
     */
    get notation(): string;
    /**
     * Run the modifier on the results.
     *
     * @param {RollResults} results The results to run the modifier against
     * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
     *
     * @returns {RollResults} The modified results
     */
    run(results: RollResults, _context: ModifierContext): RollResults;
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @returns {{notation: string, name: string, type: string, max: Number}}
     */
    toJSON(): MaxModifierJson;
}
export default MaxModifier;
