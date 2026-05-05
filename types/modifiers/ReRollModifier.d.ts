import ComparisonModifier from './ComparisonModifier.js';
import ComparePoint from '../ComparePoint.js';
import type { ModifierContext } from './types.js';
import type RollResults from '../results/RollResults.js';
declare const onceSymbol: unique symbol;
export interface ReRollModifierJson {
    notation: string;
    name: string;
    type: 'modifier';
    comparePoint?: ComparePoint;
    once: boolean;
}
/**
 * A `ReRollModifier` re-rolls dice that match a given test, and replaces the new value with the old
 * one.
 *
 * @see {@link ExplodeModifier} if you want to keep the old value as well
 *
 * @extends ComparisonModifier
 */
declare class ReRollModifier extends ComparisonModifier {
    private [onceSymbol];
    /**
     * The default modifier execution order.
     *
     * @type {number}
     */
    static order: number;
    /**
     * Create a `ReRollModifier` instance.
     *
     * @param {boolean} [once=false] Whether to only re-roll once or not
     * @param {ComparePoint} [comparePoint=null] The comparison object
     */
    constructor(once?: boolean, comparePoint?: ComparePoint | null);
    /**
     * The name of the modifier.
     *
     * @returns {string} 're-roll'
     */
    get name(): string;
    /**
     * The modifier's notation.
     *
     * @returns {string}
     */
    get notation(): string;
    /**
     * Whether the modifier should only re-roll once or not.
     *
     * @returns {boolean} `true` if it should re-roll once, `false` otherwise
     */
    get once(): boolean;
    /**
     * Set whether the modifier should only re-roll once or not.
     *
     * @param {boolean} value
     */
    set once(value: boolean);
    /**
     * The default compare point definition
     *
     * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
     *
     * @returns {array}
     */
    defaultComparePoint(_context: ModifierContext): [string, number];
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
     * @returns {{
     *  notation: string,
     *  name: string,
     *  type: string,
     *  comparePoint: (ComparePoint|undefined),
     *  once: boolean
     * }}
     */
    toJSON(): ReRollModifierJson;
}
export default ReRollModifier;
