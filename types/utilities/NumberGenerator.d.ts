import { MersenneTwister19937, type Engine } from 'random-js';
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
declare const engineSymbol: unique symbol;
/**
 * The random object
 *
 * @type {symbol}
 *
 * @private
 */
declare const randomSymbol: unique symbol;
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
declare const engines: {
    min: Engine;
    max: RangeEngine;
    browserCrypto: Engine;
    nodeCrypto: Engine;
    MersenneTwister19937: typeof MersenneTwister19937;
    nativeMath: Engine;
};
/**
 * The `NumberGenerator` is capable of generating random numbers.
 *
 * @since 4.2.0
 *
 * @see This uses [random-js](https://github.com/ckknight/random-js).
 * For details of the engines, check the [documentation](https://github.com/ckknight/random-js#engines).
 */
declare class NumberGenerator {
    private [engineSymbol];
    private [randomSymbol];
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
    constructor(engine?: NumberGeneratorEngine);
    /**
     * The current engine.
     *
     * @returns {Engine|{next(): number}}
     */
    get engine(): NumberGeneratorEngine;
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
    set engine(engine: NumberGeneratorEngine);
    /**
     * Generate a random integer within the inclusive range `[min, max]`.
     *
     * @param {number} min The minimum integer value, inclusive.
     * @param {number} max The maximum integer value, inclusive.
     *
     * @returns {number} The random integer
     */
    integer(min: number, max: number): number;
    /**
     * Returns a floating-point value within `[min, max)` or `[min, max]`.
     *
     * @param {number} min The minimum floating-point value, inclusive.
     * @param {number} max The maximum floating-point value.
     * @param {boolean} [inclusive=false] If `true`, `max` will be inclusive.
     *
     * @returns {number} The random floating-point value
     */
    real(min: number, max: number, inclusive?: boolean): number;
}
declare const generator: NumberGenerator;
export { engines, generator, };
