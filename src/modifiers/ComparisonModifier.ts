import Modifier from './Modifier.js';
import ComparePoint from '../ComparePoint.js';
import type { ModifierContext, ModifierDefaults } from './types.js';

const comparePointSymbol = Symbol('compare-point');

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
class ComparisonModifier extends Modifier {
  private [comparePointSymbol]?: ComparePoint;

  /**
   * Create a `ComparisonModifier` instance.
   *
   * @param {ComparePoint} [comparePoint] The comparison object
   *
   * @throws {TypeError} `comparePoint` must be an instance of `ComparePoint` or `undefined`
   */
  constructor(comparePoint?: ComparePoint | null) {
    super();

    if (comparePoint) {
      this.comparePoint = comparePoint;
    }
  }

  /**
   * The compare point.
   *
   * @returns {ComparePoint|undefined}
   */
  get comparePoint(): ComparePoint | undefined {
    return this[comparePointSymbol];
  }

  /**
   * Set the compare point.
   *
   * @param {ComparePoint} comparePoint
   *
   * @throws {TypeError} value must be an instance of `ComparePoint`
   */
  set comparePoint(comparePoint: ComparePoint | undefined) {
    if (!(comparePoint instanceof ComparePoint)) {
      throw new TypeError('comparePoint must be instance of ComparePoint');
    }

    this[comparePointSymbol] = comparePoint;
  }

  /* eslint-disable class-methods-use-this */
  /**
   * The name of the modifier.
   *
   * @returns {string} 'comparison'
   */
  get name() {
    return 'comparison';
  }
  /* eslint-enable class-methods-use-this */

  /**
   * The modifier's notation.
   *
   * @returns {string}
   */
  get notation() {
    return `${this.comparePoint || ''}`;
  }

  /* eslint-disable class-methods-use-this */
  /**
   * Empty default compare point definition
   *
   * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
   *
   * @returns {null}
   */
  defaultComparePoint(_context: ModifierContext): ComparePointConfig | Record<string, never> {
    return {};
  }
  /* eslint-enable class-methods-use-this */

  /**
   * Eases processing of simple "compare point only" defaults
   *
   * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
   *
   * @returns {object}
   */
  defaults(_context: ModifierContext): ModifierDefaults {
    const comparePointConfig = this.defaultComparePoint(_context);

    if (Array.isArray(comparePointConfig) && comparePointConfig.length === 2) {
      return { comparePoint: new ComparePoint(...comparePointConfig) };
    }

    return {};
  }

  /**
   * Check whether value matches the compare point or not.
   *
   * @param {number} value The value to compare with
   *
   * @returns {boolean} `true` if the value matches, `false` otherwise
   */
  isComparePoint(value: number): boolean {
    if (!this.comparePoint) {
      return false;
    }

    return this.comparePoint.isMatch(value);
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
   *  comparePoint: (ComparePoint|undefined)
   * }}
   */
  toJSON(): ComparisonModifierJson {
    const { comparePoint } = this;

    return Object.assign(
      super.toJSON(),
      {
        comparePoint,
      },
    );
  }
}

export default ComparisonModifier;
