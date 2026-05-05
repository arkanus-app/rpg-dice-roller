import Modifier from './Modifier.js';
import ResultGroup from '../results/ResultGroup.js';
import RollResults from '../results/RollResults.js';
import type { ModifierContext, RollLike } from './types.js';

const directionSymbol = Symbol('direction');

type SortDirection = 'a' | 'd';

export interface SortingModifierJson {
  notation: string;
  name: string;
  type: 'modifier';
  direction: SortDirection;
}

/**
 * A `SortingModifier` sorts roll results by their value, either ascending or descending.
 *
 * @extends ComparisonModifier
 */
class SortingModifier extends Modifier {
  private [directionSymbol]!: SortDirection;

  /**
   * The default modifier execution order.
   *
   * @type {number}
   */
  static order = 11;

  /**
   * Create a `SortingModifier` instance.
   *
   * @param {string} [direction=a] The direction to sort in; 'a' (Ascending) or 'd' (Descending)
   *
   * @throws {RangeError} Direction must be 'a' or 'd'
   */
  constructor(direction: SortDirection = 'a') {
    super();

    this.direction = direction;
  }

  /**
   * The sort direction.
   *
   * @returns {string} Either 'a' or 'd'
   */
  get direction(): SortDirection {
    return this[directionSymbol];
  }

  /**
   * Set the sort direction.
   *
   * @param {string} value Either 'a' (Ascending) or 'd' (Descending)
   *
   * @throws {RangeError} Direction must be 'a' or 'd'
   */
  set direction(value: SortDirection) {
    if ((value !== 'a') && (value !== 'd')) {
      throw new RangeError('Direction must be "a" (Ascending) or "d" (Descending)');
    }

    this[directionSymbol] = value;
  }

  /* eslint-disable class-methods-use-this */
  /**
   * The name of the modifier.
   *
   * @returns {string} 'sorting'
   */
  get name() {
    return 'sorting';
  }
  /* eslint-enable class-methods-use-this */

  /**
   * The modifier's notation.
   *
   * @returns {string}
   */
  get notation() {
    return `s${this.direction}`;
  }

  /**
   * Run the modifier on the results.
   *
   * @param {RollResults} results The results to run the modifier against
   * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
   *
   * @returns {RollResults} The modified results
   */
  run(results: ResultGroup | RollResults, _context: ModifierContext): ResultGroup | RollResults {
    let resultsKey: 'results' | 'rolls';
    const mutableResults = results as unknown as Record<'results' | 'rolls', unknown[]>;

    if (results instanceof ResultGroup) {
      resultsKey = 'results';
    } else {
      resultsKey = 'rolls';
    }

    /* eslint-disable no-param-reassign */
    mutableResults[resultsKey] = mutableResults[resultsKey].sort((a, b) => {
      const left = a as RollLike;
      const right = b as RollLike;

      if (this.direction === 'd') {
        return right.value - left.value;
      }

      return left.value - right.value;
    });

    // if result group, we also need to sort any die rolls in th sub-rolls
    if (results instanceof ResultGroup) {
      mutableResults[resultsKey] = mutableResults[resultsKey].map((subRoll: unknown) => {
        if ((subRoll instanceof ResultGroup) || (subRoll instanceof RollResults)) {
          return this.run(subRoll, _context);
        }

        return subRoll;
      });
    }
    /* eslint-enable */

    return results;
  }

  /**
   * Return an object for JSON serialising.
   *
   * This is called automatically when JSON encoding the object.
   *
   * @returns {{notation: string, name: string, type: string, direction: string}}
   */
  toJSON(): SortingModifierJson {
    const { direction } = this;

    return Object.assign(
      super.toJSON(),
      {
        direction,
      },
    );
  }
}

export default SortingModifier;
