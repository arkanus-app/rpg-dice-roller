import Modifier from './Modifier.js';
import type { ModifierContext } from './types.js';
import type RollResults from '../results/RollResults.js';
declare const minSymbol: unique symbol;
export interface MinModifierJson {
    notation: string;
    name: string;
    type: 'modifier';
    min: number;
}
/**
 * A `MinModifier` causes die rolls under a minimum value to be treated as the minimum value.
 *
 * @since 4.3.0
 *
 * @see {@link MaxModifier} for the opposite of this modifier
 *
 * @extends {Modifier}
 */
declare class MinModifier extends Modifier {
    private [minSymbol];
    /**
     * The default modifier execution order.
     *
     * @type {number}
     */
    static order: number;
    /**
     * Create a `MinModifier` instance.
     *
     * @param {number} min The minimum value
     *
     * @throws {TypeError} min must be a number
     */
    constructor(min: number | string);
    /**
     * The minimum value.
     *
     * @returns {Number}
     */
    get min(): number;
    /**
     * Set the minimum value.
     *
     * @param {number} value
     *
     * @throws {TypeError} min must be a number
     */
    set min(value: number | string);
    /**
     * The name of the modifier.
     *
     * @returns {string} 'min'
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
     * @returns {{notation: string, name: string, type: string, min: Number}}
     */
    toJSON(): MinModifierJson;
}
export default MinModifier;
