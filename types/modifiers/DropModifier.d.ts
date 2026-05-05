import KeepModifier from './KeepModifier.js';
import type { RollIndexEntry } from './types.js';
/**
 * A `DropModifier` will "drop" (Remove from total calculations) dice from a roll.
 *
 * @see {@link KeepModifier} for the opposite of this modifier
 *
 * @extends KeepModifier
 */
declare class DropModifier extends KeepModifier {
    /**
     * The default modifier execution order.
     *
     * @type {number}
     */
    static order: number;
    /**
     * Create a `DropModifier` instance.
     *
     * @param {string} [end=l] Either `h|l` to drop highest or lowest
     * @param {number} [qty=1] The amount of dice to drop
     *
     * @throws {RangeError} End must be one of 'h' or 'l'
     * @throws {TypeError} qty must be a positive integer
     */
    constructor(end?: 'h' | 'l', qty?: number | string);
    /**
     * The name of the modifier.
     *
     * @returns {string} 'drop-l' or 'drop-h'
     */
    get name(): string;
    /**
     * The modifier's notation.
     *
     * @returns {string}
     */
    get notation(): string;
    /**
     * Determine the start and end (end exclusive) range of rolls to drop.
     *
     * @param {RollResults} _results The results to drop from
     *
     * @returns {number[]} The min / max range to drop
     */
    rangeToDrop(_results: RollIndexEntry[]): [number, number];
}
export default DropModifier;
