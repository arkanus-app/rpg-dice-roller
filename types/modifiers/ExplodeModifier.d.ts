import ComparisonModifier from './ComparisonModifier.js';
import ComparePoint from '../ComparePoint.js';
import type { ModifierContext } from './types.js';
import type RollResults from '../results/RollResults.js';
declare const compoundSymbol: unique symbol;
declare const penetrateSymbol: unique symbol;
export interface ExplodeModifierJson {
    notation: string;
    name: string;
    type: 'modifier';
    comparePoint?: ComparePoint;
    compound: boolean;
    penetrate: boolean;
}
/**
 * An `ExplodeModifier` re-rolls dice that match a given test, and adds them to the results.
 *
 * @see {@link ReRollModifier} if you want to replace the old value with the new, rather than adding
 *
 * @extends ComparisonModifier
 */
declare class ExplodeModifier extends ComparisonModifier {
    private [compoundSymbol];
    private [penetrateSymbol];
    /**
     * The default modifier execution order.
     *
     * @type {number}
     */
    static order: number;
    /**
     * Create an `ExplodeModifier` instance
     *
     * @param {ComparePoint} [comparePoint=null] The comparison object
     * @param {boolean} [compound=false] Whether to compound or not
     * @param {boolean} [penetrate=false] Whether to penetrate or not
     *
     * @throws {TypeError} comparePoint must be a `ComparePoint` object
     */
    constructor(comparePoint?: ComparePoint | null, compound?: boolean, penetrate?: boolean);
    /**
     * Whether the modifier should compound the results or not.
     *
     * @returns {boolean} `true` if it should compound, `false` otherwise
     */
    get compound(): boolean;
    /**
     * The name of the modifier.
     *
     * @returns {string} 'explode'
     */
    get name(): string;
    /**
     * The modifier's notation.
     *
     * @returns {string}
     */
    get notation(): string;
    /**
     * Whether the modifier should penetrate the results or not.
     *
     * @returns {boolean} `true` if it should penetrate, `false` otherwise
     */
    get penetrate(): boolean;
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
     *  compound: boolean,
     *  penetrate: boolean
     * }}
     */
    toJSON(): ExplodeModifierJson;
}
export default ExplodeModifier;
