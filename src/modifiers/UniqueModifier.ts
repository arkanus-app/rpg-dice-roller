import { DieActionValueError } from '../exceptions/index.js';
import ComparisonModifier from './ComparisonModifier.js';
import ComparePoint from '../ComparePoint.js';
import type { ModifierContext } from './types.js';
import type RollResult from '../results/RollResult.js';
import type RollResults from '../results/RollResults.js';

const onceSymbol = Symbol('once');

const isDuplicate = (
  value: RollResult,
  index: number,
  collection: RollResult[],
  notFirst = false,
): boolean => {
  const i = collection.map((e) => e.value).indexOf(value.value);

  return notFirst ? i < index : i !== index;
};

export interface UniqueModifierJson {
  notation: string;
  name: string;
  type: 'modifier';
  comparePoint?: ComparePoint;
  once: boolean;
}

/**
 * A `UniqueModifier` re-rolls any non-unique dice values and, optionally that match a given test.
 *
 * @extends ComparisonModifier
 */
class UniqueModifier extends ComparisonModifier {
  private [onceSymbol] = false;

  /**
   * The default modifier execution order.
   *
   * @type {number}
   */
  static order = 5;

  /**
   * Create a `UniqueModifier` instance.
   *
   * @param {boolean} [once=false] Whether to only re-roll once or not
   * @param {ComparePoint} [comparePoint=null] The comparison object
   */
  constructor(once = false, comparePoint: ComparePoint | null = null) {
    super(comparePoint);

    this.once = !!once;
  }

  /* eslint-disable class-methods-use-this */
  /**
   * The name of the modifier.
   *
   * @returns {string} 'unique'
   */
  get name() {
    return 'unique';
  }
  /* eslint-enable class-methods-use-this */

  /**
   * The modifier's notation.
   *
   * @returns {string}
   */
  get notation() {
    return `u${this.once ? 'o' : ''}${super.notation}`;
  }

  /**
   * Whether the modifier should only re-roll once or not.
   *
   * @returns {boolean} `true` if it should re-roll once, `false` otherwise
   */
  get once(): boolean {
    return !!this[onceSymbol];
  }

  /**
   * Set whether the modifier should only re-roll once or not.
   *
   * @param {boolean} value
   */
  set once(value: boolean) {
    this[onceSymbol] = !!value;
  }

  /**
   * Run the modifier on the results.
   *
   * @param {RollResults} results The results to run the modifier against
   * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
   *
   * @returns {RollResults} The modified results
   */
  run(results: RollResults, _context: ModifierContext): RollResults {
    // ensure that the dice can re-roll without going into an infinite loop
    if (_context.min === _context.max) {
      throw new DieActionValueError(_context, 're-roll');
    }

    results.rolls
      .forEach((roll, index, collection) => {
        // no need to re-roll on the first roll
        if (index === 0) {
          return;
        }

        for (
          let i = 0;
          (
            (i < this.maxIterations)
            && (!this.comparePoint || this.isComparePoint(roll.value))
            && isDuplicate(roll, index, collection, true)
          );
          i++
        ) {
          // re-roll the dice
          const rollResult = _context.rollOnce();

          // eslint-disable-next-line no-param-reassign
          roll.value = rollResult.value;

          // add the re-roll modifier flag
          roll.modifiers.add(`unique${this.once ? '-once' : ''}`);

          if (this.once) {
            break;
          }
        }
      });

    return results;
  }

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
  toJSON(): UniqueModifierJson {
    const { once } = this;

    return Object.assign(
      super.toJSON(),
      {
        once,
      },
    );
  }
}

export default UniqueModifier;
