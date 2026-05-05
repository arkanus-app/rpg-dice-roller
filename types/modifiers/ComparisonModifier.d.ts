import Modifier from './Modifier.js';
import ComparePoint from '../ComparePoint.js';
import type { ModifierContext, ModifierDefaults } from './types.js';
declare const comparePointSymbol: unique symbol;
type ComparePointConfig = [string, number];
export interface ComparisonModifierJson {
    notation: string;
    name: string;
    type: 'modifier';
    comparePoint?: ComparePoint;
}
/**
 * A `ComparisonModifier` is the base modifier class for comparing values.
 *
 * @abstract
 *
 * @extends Modifier
 *
 * @see {@link CriticalFailureModifier}
 * @see {@link CriticalSuccessModifier}
 * @see {@link ExplodeModifier}
 * @see {@link ReRollModifier}
 * @see {@link TargetModifier}
 */
declare class ComparisonModifier extends Modifier {
    private [comparePointSymbol]?;
    /**
     * Create a `ComparisonModifier` instance.
     *
     * @param {ComparePoint} [comparePoint] The comparison object
     *
     * @throws {TypeError} `comparePoint` must be an instance of `ComparePoint` or `undefined`
     */
    constructor(comparePoint?: ComparePoint | null);
    /**
     * The compare point.
     *
     * @returns {ComparePoint|undefined}
     */
    get comparePoint(): ComparePoint | undefined;
    /**
     * Set the compare point.
     *
     * @param {ComparePoint} comparePoint
     *
     * @throws {TypeError} value must be an instance of `ComparePoint`
     */
    set comparePoint(comparePoint: ComparePoint | undefined);
    /**
     * The name of the modifier.
     *
     * @returns {string} 'comparison'
     */
    get name(): string;
    /**
     * The modifier's notation.
     *
     * @returns {string}
     */
    get notation(): string;
    /**
     * Empty default compare point definition
     *
     * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
     *
     * @returns {null}
     */
    defaultComparePoint(_context: ModifierContext): ComparePointConfig | Record<string, never>;
    /**
     * Eases processing of simple "compare point only" defaults
     *
     * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
     *
     * @returns {object}
     */
    defaults(_context: ModifierContext): ModifierDefaults;
    /**
     * Check whether value matches the compare point or not.
     *
     * @param {number} value The value to compare with
     *
     * @returns {boolean} `true` if the value matches, `false` otherwise
     */
    isComparePoint(value: number): boolean;
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @returns {{
     *  notation: string,
     *  name: string,
     *  type: string,
     *  comparePoint: (ComparePoint|undefined)
     * }}
     */
    toJSON(): ComparisonModifierJson;
}
export default ComparisonModifier;
