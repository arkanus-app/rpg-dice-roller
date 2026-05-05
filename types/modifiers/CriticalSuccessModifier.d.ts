import ComparisonModifier from './ComparisonModifier.js';
import ComparePoint from '../ComparePoint.js';
import type { ModifierContext } from './types.js';
import type RollResults from '../results/RollResults.js';
/**
 * A `CriticalSuccessModifier` modifier flags values that match a comparison.
 *
 * Unlike most other modifiers, it doesn't affect the roll value, it simply "flags" matching rolls.
 *
 * @see {@link CriticalFailureModifier} for the opposite of this modifier
 *
 * @extends ComparisonModifier
 */
declare class CriticalSuccessModifier extends ComparisonModifier {
    /**
     * The default modifier execution order.
     *
     * @type {number}
     */
    static order: number;
    /**
     * Create a `CriticalSuccessModifier` instance.
     *
     * @param {ComparePoint} comparePoint The comparison object
     *
     * @throws {TypeError} comparePoint must be a `ComparePoint` object
     */
    constructor(comparePoint?: ComparePoint | null);
    /**
     * The name of the modifier.
     *
     * @returns {string} 'critical-success'
     */
    get name(): string;
    /**
     * The modifier's notation.
     *
     * @returns {string}
     */
    get notation(): string;
    /**
     * The default compare point definition
     *
     * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
     *
     * @returns {array}
     */
    defaultComparePoint(_context: ModifierContext): [string, number];
    /**
     * Runs the modifier on the rolls.
     *
     * @param {RollResults} results The results to run the modifier against
     * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
     *
     * @returns {RollResults}
     */
    run(results: RollResults, _context: ModifierContext): RollResults;
}
export default CriticalSuccessModifier;
