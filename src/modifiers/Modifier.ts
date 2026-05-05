import type { ModifierContext, ModifierDefaults, ModifierResult } from './types.js';

type ModifierConstructor = typeof Modifier & {
  order: number;
};

export interface ModifierJson {
  name: string;
  notation: string;
  type: 'modifier';
}

/**
 * A `Modifier` is the base modifier class that all others extend from.
 *
 * @abstract
 */
class Modifier {
  /**
   * The default modifier execution order.
   *
   * @type {number}
   */
  static order = 999;

  order: number;

  [key: string]: unknown;

  /**
   * Create a `Modifier` instance.
   */
  constructor() {
    // set the modifier's sort order
    this.order = (this.constructor as ModifierConstructor).order;
  }

  /* eslint-disable class-methods-use-this */
  /**
   * The name of the modifier.
   *
   * @returns {string} 'modifier'
   */
  get name() {
    return 'modifier';
  }
  /* eslint-enable class-methods-use-this */

  /* eslint-disable class-methods-use-this */
  /**
   * The modifier's notation.
   *
   * @returns {string}
   */
  get notation() {
    return '';
  }
  /* eslint-enable class-methods-use-this */

  /* eslint-disable class-methods-use-this */
  /**
   * The maximum number of iterations that the modifier can apply to a single die roll
   *
   * @returns {number} `1000`
   */
  get maxIterations() {
    return 1000;
  }

  /**
   * No default values present
   *
   * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
   *
   * @returns {object}
   */
  defaults(_context: ModifierContext): ModifierDefaults {
    return {};
  }
  /* eslint-enable class-methods-use-this */

  /**
   * Processing default values definitions
   *
   * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
   *
   * @returns {void}
   */
  useDefaultsIfNeeded(_context: ModifierContext): void {
    Object.entries(this.defaults(_context)).forEach(([field, value]) => {
      if (typeof this[field] === 'undefined') {
        this[field] = value;
      }
    });
  }

  /* eslint-disable class-methods-use-this */
  /**
   * Run the modifier on the results.
   *
   * @param {RollResults} results The results to run the modifier against
   * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
   *
   * @returns {RollResults} The modified results
   */
  run(results: ModifierResult, _context: ModifierContext): ModifierResult {
    this.useDefaultsIfNeeded(_context);
    return results;
  }
  /* eslint-enable class-methods-use-this */

  /**
   * Return an object for JSON serialising.
   *
   * This is called automatically when JSON encoding the object.
   *
   * @returns {{notation: string, name: string, type: string}}
   */
  toJSON(): ModifierJson {
    const { notation, name } = this;

    return {
      name,
      notation,
      type: 'modifier',
    };
  }

  /**
   * Return the String representation of the object.
   *
   * This is called automatically when casting the object to a string.
   *
   * @see {@link Modifier#notation}
   *
   * @returns {string}
   */
  toString(): string {
    return this.notation;
  }
}

export default Modifier;
