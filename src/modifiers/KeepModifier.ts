import { isNumeric } from '../utilities/math.js';
import Modifier from './Modifier.js';
import ResultGroup from '../results/ResultGroup.js';
import RollResults from '../results/RollResults.js';
import type { ModifierContext, RollIndexEntry, RollLike } from './types.js';

const endSymbol = Symbol('end');
const qtySymbol = Symbol('qty');

type KeepEnd = 'h' | 'l';

export interface KeepModifierJson {
  notation: string;
  name: string;
  type: 'modifier';
  end: KeepEnd;
  qty: number;
}

/**
 * A `KeepModifier` will "keep" dice from a roll, dropping (Remove from total calculations) all
 * others.
 *
 * @see {@link DropModifier} for the opposite of this modifier
 *
 * @extends Modifier
 */
class KeepModifier extends Modifier {
  private [endSymbol]!: KeepEnd;

  private [qtySymbol]!: number;

  /**
   * The default modifier execution order.
   *
   * @type {number}
   */
  static order = 6;

  /**
   * Create a `KeepModifier` instance
   *
   * @param {string} [end=h] Either `h|l` to keep highest or lowest
   * @param {number} [qty=1] The amount dice to keep
   *
   * @throws {RangeError} End must be one of 'h' or 'l'
   * @throws {TypeError} qty must be a positive integer
   */
  constructor(end: KeepEnd = 'h', qty: number | string = 1) {
    super();

    this.end = end;
    this.qty = qty;
  }

  /**
   * Which end the rolls should be kept ("h" = High, "l" = Low).
   *
   * @returns {string} 'h' or 'l'
   */
  get end(): KeepEnd {
    return this[endSymbol];
  }

  /**
   * Set which end the rolls should be kept ("h" = High, "l" = Low).
   *
   * @param {string} value Either 'h' or 'l'
   *
   * @throws {RangeError} End must be one of 'h' or 'l'
   */
  set end(value: KeepEnd) {
    if ((value !== 'h') && (value !== 'l')) {
      throw new RangeError('End must be "h" or "l"');
    }

    this[endSymbol] = value;
  }

  /**
   * The name of the modifier.
   *
   * @returns {string} 'keep-l' or 'keep-h'
   */
  get name() {
    return `keep-${this.end}`;
  }

  /**
   * The modifier's notation.
   *
   * @returns {string}
   */
  get notation() {
    return `k${this.end}${this.qty}`;
  }

  /**
   * The quantity of dice that should be kept.
   *
   * @returns {number}
   */
  get qty(): number {
    return this[qtySymbol];
  }

  /**
   * Set the quantity of dice that should be kept.
   *
   * @param {number} value
   *
   * @throws {TypeError} qty must be a positive finite integer
   */
  set qty(value: number | string) {
    if (value === Infinity) {
      throw new RangeError('qty must be a finite number');
    }
    if (!isNumeric(value) || (value < 1)) {
      throw new TypeError('qty must be a positive finite integer');
    }

    this[qtySymbol] = Math.floor(Number(value));
  }

  /**
   * Determine the start and end (end exclusive) range of rolls to drop.
   *
   * @param {RollResults} _results The results to drop from
   *
   * @returns {number[]} The min / max range to drop
   */
  rangeToDrop(_results: RollIndexEntry[]): [number, number] {
    // we're keeping, so we want to drop all dice that are outside of the qty range
    if (this.end === 'h') {
      return [0, _results.length - this.qty];
    }

    return [this.qty, _results.length];
  }

  /**
   * Run the modifier on the results.
   *
   * @param {ResultGroup|RollResults} results The results to run the modifier against
   * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
   *
   * @returns {ResultGroup|RollResults} The modified results
   */
  run(results: ResultGroup | RollResults, _context: ModifierContext): ResultGroup | RollResults {
    let modifiedRolls: unknown[];
    let rollIndexes: RollIndexEntry[];

    if (results instanceof ResultGroup) {
      modifiedRolls = results.results;

      if ((modifiedRolls.length === 1) && (modifiedRolls[0] instanceof ResultGroup)) {
        // single sub-roll - get all the dice rolled and their 2d indexes
        rollIndexes = modifiedRolls[0].results.map((result: unknown, index: number) => {
          if (result instanceof RollResults) {
            return result.rolls.map((subResult, subIndex): RollIndexEntry => ({
              value: subResult.value,
              index: [index, subIndex],
            }));
          }

          return null;
        }).flat()
          .filter((rollIndex: RollIndexEntry | null): rollIndex is RollIndexEntry => (
            Boolean(rollIndex)
          ));
      } else {
        rollIndexes = [...modifiedRolls]
          // get a list of objects with roll values and original index
          .map((roll: unknown, index: number) => ({
            value: (roll as RollLike).value,
            index,
          }));
      }
    } else {
      modifiedRolls = results.rolls;

      rollIndexes = [...modifiedRolls]
        // get a list of objects with roll values and original index
        .map((roll, index) => ({
          value: (roll as RollLike).value,
          index,
        }));
    }

    // determine the indexes that need to be dropped
    const droppedRollIndexes = rollIndexes
      // sort the list ascending by value
      .sort((a, b) => a.value - b.value)
      .map((rollIndex) => rollIndex.index)
      // get the roll indexes to drop
      .slice(...this.rangeToDrop(rollIndexes));

    // loop through all of our dice to drop and flag them as such
    droppedRollIndexes.forEach((rollIndex) => {
      let roll;

      if (Array.isArray(rollIndex)) {
        // array of indexes (e.g. single sub-roll in a group roll)
        roll = (
          modifiedRolls[0] as { results: Array<{ rolls: RollLike[] }> }
        ).results[rollIndex[0]].rolls[rollIndex[1]];
      } else {
        roll = modifiedRolls[rollIndex];
      }

      (roll as RollLike).modifiers.add('drop');
      (roll as RollLike).useInTotal = false;
    });

    return results;
  }

  /**
   * Return an object for JSON serialising.
   *
   * This is called automatically when JSON encoding the object.
   *
   * @returns {{notation: string, name: string, type: string, qty: number, end: string}}
   */
  toJSON(): KeepModifierJson {
    const { end, qty } = this;

    return Object.assign(
      super.toJSON(),
      {
        end,
        qty,
      },
    );
  }
}

export default KeepModifier;
