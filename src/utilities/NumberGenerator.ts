import {
  browserCrypto, nodeCrypto, MersenneTwister19937, nativeMath, Random, type Engine,
} from 'random-js';

export type NumberGeneratorEngine = Engine & {
  range?: number[];
};

interface RangeEngine extends Engine {
  range: number[];
}

/**
 * The engine
 *
 * @type {symbol}
 *
 * @private
 */
const engineSymbol: unique symbol = Symbol('engine');

/**
 * The random object
 *
 * @type {symbol}
 *
 * @private
 */
const randomSymbol: unique symbol = Symbol('random');

/**
 * Engine that always returns the maximum value.
 * Used internally for calculating max roll values.
 *
 * @since 4.2.0
 *
 * @type {{next(): number, range: number[]}}
 */
const maxEngine: RangeEngine = {
  /**
   * The min / max number range (e.g. `[1, 10]`).
   *
   * This _must_ be set for the `next()` method to return the correct last index.
   *
   * @example
   * maxEngine.range = [1, 10];
   *
   * @type {number[]}
   */
  range: [],
  /**
   * Returns the maximum number index for the range
   *
   * @returns {number}
   */
  next(): number {
    // calculate the index of the max number
    return this.range[1] - this.range[0];
  },
};

/**
 * Engine that always returns the minimum value.
 * Used internally for calculating min roll values.
 *
 * @since 4.2.0
 *
 * @type {{next(): number}}
 */
const minEngine: Engine = {
  /**
   * Returns the minimum number index, `0`
   *
   * @returns {number}
   */
  next(): number {
    return 0;
  },
};

/**
 * List of built-in number generator engines.
 *
 * @since 4.2.0
 *
 * @see This uses [random-js](https://github.com/ckknight/random-js).
 * For details of the engines, check the [documentation](https://github.com/ckknight/random-js#engines).
 *
 * @type {{
 *  min: {next(): number},
 *  max: {next(): number, range: number[]},
 *  browserCrypto: Engine,
 *  nodeCrypto: Engine,
 *  MersenneTwister19937: MersenneTwister19937,
 *  nativeMath: Engine
 * }}
 */
const engines: {
  min: Engine;
  max: RangeEngine;
  browserCrypto: Engine;
  nodeCrypto: Engine;
  MersenneTwister19937: typeof MersenneTwister19937;
  nativeMath: Engine;
} = {
  browserCrypto,
  nodeCrypto,
  MersenneTwister19937,
  nativeMath,
  min: minEngine,
  max: maxEngine,
};

/**
 * The `NumberGenerator` is capable of generating random numbers.
 *
 * @since 4.2.0
 *
 * @see This uses [random-js](https://github.com/ckknight/random-js).
 * For details of the engines, check the [documentation](https://github.com/ckknight/random-js#engines).
 */
class NumberGenerator {
  private [engineSymbol]!: NumberGeneratorEngine;

  private [randomSymbol]!: Random;

  /**
   * Create a `NumberGenerator` instance.
   *
   * The `engine` can be any object that has a `next()` method, which returns a number.
   *
   * @example <caption>Built-in engine</caption>
   * new NumberGenerator(engines.nodeCrypto);
   *
   * @example <caption>Custom engine</caption>
   * new NumberGenerator({
   *   next() {
   *     // return a random number
   *   },
   * });
   *
   * @param {Engine|{next(): number}} [engine=nativeMath] The RNG engine to use
   *
   * @throws {TypeError} engine must have function `next()`
   */
  constructor(engine: NumberGeneratorEngine = nativeMath) {
    this.engine = engine || nativeMath;
  }

  /**
   * The current engine.
   *
   * @returns {Engine|{next(): number}}
   */
  get engine(): NumberGeneratorEngine {
    return this[engineSymbol];
  }

  /**
   * Set the engine.
   *
   * The `engine` can be any object that has a `next()` method, which returns a number.
   *
   * @example <caption>Built-in engine</caption>
   * numberGenerator.engine = engines.nodeCrypto;
   *
   * @example <caption>Custom engine</caption>
   * numberGenerator.engine = {
   *   next() {
   *     // return a random number
   *   },
   * });
   *
   * @see {@link engines}
   *
   * @param {Engine|{next(): number}} engine
   *
   * @throws {TypeError} engine must have function `next()`
   */
  set engine(engine: NumberGeneratorEngine) {
    if (engine && (typeof engine.next !== 'function')) {
      throw new TypeError('engine must have function `next()`');
    }

    // set the engine and re-initialise the random engine
    this[engineSymbol] = engine || nativeMath;
    this[randomSymbol] = new Random(this[engineSymbol]);
  }

  /**
   * Generate a random integer within the inclusive range `[min, max]`.
   *
   * @param {number} min The minimum integer value, inclusive.
   * @param {number} max The maximum integer value, inclusive.
   *
   * @returns {number} The random integer
   */
  integer(min: number, max: number): number {
    this[engineSymbol].range = [min, max];

    return this[randomSymbol].integer(min, max);
  }

  /**
   * Returns a floating-point value within `[min, max)` or `[min, max]`.
   *
   * @param {number} min The minimum floating-point value, inclusive.
   * @param {number} max The maximum floating-point value.
   * @param {boolean} [inclusive=false] If `true`, `max` will be inclusive.
   *
   * @returns {number} The random floating-point value
   */
  real(min: number, max: number, inclusive = false): number {
    this[engineSymbol].range = [min, max];

    return this[randomSymbol].real(min, max, inclusive);
  }
}

const generator = new NumberGenerator();

export {
  engines,
  generator,
};
