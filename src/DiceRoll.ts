import { StandardDice } from './dice/index.js';
import { DataFormatError, NotationError, RequiredArgumentError } from './exceptions/index.js';
import { toFixed } from './utilities/math.js';
import { engines, generator, type NumberGeneratorEngine } from './utilities/NumberGenerator.js';
import { isBase64, isJson } from './utilities/utils.js';
import Parser, { type ParserExpression } from './parser/Parser.js';
import RollGroup from './RollGroup.js';
import RollResults from './results/RollResults.js';
import ResultGroup from './results/ResultGroup.js';
import exportFormats from './utilities/ExportFormats.js';

/**
 * The notation
 *
 * @type {symbol}
 *
 * @private
 */
const notationSymbol: unique symbol = Symbol('notation');

/**
 * The maximum possible roll total
 *
 * @type {symbol}
 *
 * @private
 */
const maxTotalSymbol: unique symbol = Symbol('maxTotal');

/**
 * The minimum possible roll total
 *
 * @type {symbol}
 *
 * @private
 */
const minTotalSymbol: unique symbol = Symbol('minTotal');

/**
 * List of expressions to roll
 *
 * @type {symbol}
 *
 * @private
 */
const expressionsSymbol: unique symbol = Symbol('expressions');

/**
 * Method for rolling dice
 *
 * @type {symbol}
 *
 * @private
 */
const rollMethodSymbol: unique symbol = Symbol('roll-method');

/**
 * List of rolls
 *
 * @type {symbol}
 *
 * @private
 */
const rollsSymbol: unique symbol = Symbol('rolls');

/**
 * Set the rolls
 *
 * @private
 *
 * @type {symbol}
 */
const setRollsSymbol: unique symbol = Symbol('set-rolls');

/**
 * The roll total
 *
 * @type {symbol}
 *
 * @private
 */
const totalSymbol: unique symbol = Symbol('total');

export type DiceRollImportRoll =
  | ResultGroup
  | RollResults
  | string
  | number
  | RollResults[]
  | ResultGroup[]
  | unknown[];

export interface DiceRollImportData {
  notation: string;
  rolls?: ResultGroup | RollResults | DiceRollImportRoll[];
}

export interface DiceRollJson {
  averageTotal: number;
  maxTotal: number;
  minTotal: number;
  notation: string;
  output: string;
  rolls: Array<ResultGroup | RollResults | string | number>;
  total: number;
  type: 'dice-roll';
}

/**
 * Calculate the total of all the results, fixed to a max of 2 digits after the decimal point.
 *
 * @private
 *
 * @param {ResultGroup} results
 *
 * @returns {Number} the results total
 */
const calculateTotal = (results: ResultGroup): number => toFixed(results.calculationValue, 2);

/**
 * A `DiceRoll` handles rolling of a single dice notation and storing the result.
 *
 * @see {@link DiceRoller} if you need to keep a history of rolls
 */
class DiceRoll {
  private [notationSymbol]!: string;

  private [maxTotalSymbol]: number | null = null;

  private [minTotalSymbol]: number | null = null;

  private [expressionsSymbol]: ParserExpression[] = [];

  private [rollsSymbol]: ResultGroup | null = null;

  private [totalSymbol]: number | null = null;

  /* eslint-disable max-len */
  /**
   * Create a DiceRoll, parse the notation and roll the dice.
   *
   * If `notation` is an object, it must contain a `notation` property that defines the notation.
   * It can also have an optional array of `RollResults`, in the `rolls` property.
   *
   * @example <caption>String notation</caption>
   * const roll = new DiceRoll('4d6');
   *
   * @example <caption>Object</caption>
   * const roll = new DiceRoll({
   *   notation: '4d6',
   *   rolls: ..., // RollResults object or array of roll results
   * });
   *
   * @param {string|{notation: string, rolls: ResultGroup|Array.<ResultGroup|RollResults|string|number>}} notation The notation to roll
   * @param {string} notation.notation If `notation is an object; the notation to roll
   * @param {ResultGroup|Array.<ResultGroup|RollResults|string|number>} [notation.rolls] If
   * `notation` is an object; the rolls to import
   *
   * @throws {NotationError} notation is invalid
   * @throws {RequiredArgumentError} notation is required
   * @throws {TypeError} Rolls must be a valid result object, or an array
   */
  constructor(notation: string | DiceRollImportData) {
    if (!notation) {
      throw new RequiredArgumentError('notation');
    }

    // initialise the parsed dice array
    this[expressionsSymbol] = [];

    if ((notation instanceof Object) && !Array.isArray(notation)) {
      // validate object
      // @todo see if we can assert that the notation is valid
      if (!notation.notation) {
        // object doesn't contain a notation property
        throw new RequiredArgumentError('notation');
      } else if (typeof notation.notation !== 'string') {
        throw new NotationError(notation.notation);
      } else if (notation.rolls) {
        // we have rolls - store them
        this[setRollsSymbol](notation.rolls);
      }

      // store the notation
      this[notationSymbol] = notation.notation;

      // parse the notation
      this[expressionsSymbol] = Parser.parse(this.notation);

      if (!this.hasRolls()) {
        // no rolls - roll the dice
        this.roll();
      }
    } else if (typeof notation === 'string') {
      // @todo see if we can assert that the notation is valid
      // store the notation
      this[notationSymbol] = notation;

      // parse the notation
      this[expressionsSymbol] = Parser.parse(this.notation);

      // roll the dice
      this.roll();
    } else {
      throw new NotationError(notation);
    }
  }
  /* eslint-enable max-len */

  /**
   * The average possible total for the notation.
   *
   * @since 4.3.0
   *
   * @returns {number}
   */
  get averageTotal(): number {
    return (this.maxTotal + this.minTotal) / 2;
  }

  /**
   * The maximum possible total for the notation.
   *
   * @since 4.3.0
   *
   * @returns {number}
   */
  get maxTotal(): number {
    if (!this.hasExpressions()) {
      return 0;
    }

    // only calculate the total if it has not already been done
    if (!this[maxTotalSymbol]) {
      // roll the dice, forcing values to their maximum
      const rolls = this[rollMethodSymbol](engines.max);

      // calculate the total
      this[maxTotalSymbol] = calculateTotal(rolls);
    }

    // return the total
    return this[maxTotalSymbol];
  }

  /**
   * The minimum possible total for the notation.
   *
   * @since 4.3.0
   *
   * @returns {number}
   */
  get minTotal(): number {
    if (!this.hasExpressions()) {
      return 0;
    }

    // only calculate the total if it has not already been done
    if (!this[minTotalSymbol]) {
      // roll the dice, forcing values to their minimum
      const rolls = this[rollMethodSymbol](engines.min);

      // calculate the total
      this[minTotalSymbol] = calculateTotal(rolls);
    }

    // return the total
    return this[minTotalSymbol];
  }

  /**
   * The dice notation.
   *
   * @returns {string}
   */
  get notation(): string {
    return this[notationSymbol];
  }

  /**
   * String representation of the rolls
   *
   * @example
   * 2d20+1d6: [20,2]+[2] = 24
   *
   * @returns {string}
   */
  get output(): string {
    let output = `${this.notation}: `;

    if (this.hasRolls()) {
      output += `${this[rollsSymbol]} = ${this.total}`;
    } else {
      output += 'No dice rolled';
    }

    return output;
  }

  /**
   * The dice rolled for the notation
   *
   * @returns {Array.<ResultGroup|RollResults|string|number>}
   */
  get rolls(): Array<ResultGroup | RollResults | string | number> {
    return this[rollsSymbol] ? this[rollsSymbol].results : [];
  }

  /**
   * The roll total
   *
   * @returns {number}
   */
  get total(): number {
    // only calculate the total if it has not already been done
    if (!this[totalSymbol] && this.hasRolls() && this[rollsSymbol]) {
      this[totalSymbol] = calculateTotal(this[rollsSymbol]);
    }

    // return the total
    return this[totalSymbol] || 0;
  }

  /**
   * Export the object in the given format.
   * If no format is specified, JSON is returned.
   *
   * @see {@link DiceRoll#toJSON}
   *
   * @param {exportFormats} [format=exportFormats.JSON] The format to export the data as
   *
   * @returns {string|null} The exported data, in the specified format
   *
   * @throws {TypeError} Invalid export format
   */
  export(format: number = exportFormats.JSON): string | DiceRollJson {
    switch (format) {
      case exportFormats.BASE_64:
        // JSON encode then base64, else it exports the string representation of the roll output
        return btoa(this.export(exportFormats.JSON) as string);
      case exportFormats.JSON:
        return JSON.stringify(this);
      case exportFormats.OBJECT:
        return JSON.parse(this.export(exportFormats.JSON) as string) as DiceRollJson;
      default:
        throw new TypeError(`Invalid export format "${format}"`);
    }
  }

  /**
   * Check whether the DiceRoll has expressions or not.
   *
   * @returns {boolean} `true` if the object has expressions, `false` otherwise
   */
  hasExpressions(): boolean {
    return this[expressionsSymbol] && (this[expressionsSymbol].length > 0);
  }

  /**
   * Check whether the object has rolled dice or not
   *
   * @returns {boolean} `true` if the object has rolls, `false` otherwise
   */
  hasRolls(): boolean {
    return this.hasExpressions() && (this.rolls.length > 0);
  }

  /**
   * Roll the dice for the stored notation.
   *
   * This is called in the constructor, so you'll only need this if you want to re-roll the
   * notation. However, it's usually better to create a new `DiceRoll` instance instead.
   *
   * @returns {RollResults[]} The results of the rolls
   */
  roll(): Array<ResultGroup | RollResults | string | number> {
    // reset the cached total
    this[totalSymbol] = 0;

    // save the rolls to the log
    this[rollsSymbol] = this[rollMethodSymbol]();

    // return the rolls;
    return this.rolls;
  }

  /**
   * Return an object for JSON serialising.
   *
   * This is called automatically when JSON encoding the object.
   *
   * @returns {{
   *  output: string,
   *  total: number,
   *  minTotal: number,
   *  maxTotal: number,
   *  notation: string,
   *  rolls: RollResults[],
   *  type: string
   * }}
   */
  toJSON(): DiceRollJson {
    const {
      averageTotal, maxTotal, minTotal, notation, output, rolls, total,
    } = this;

    return {
      averageTotal,
      maxTotal,
      minTotal,
      notation,
      output,
      rolls,
      total,
      type: 'dice-roll',
    };
  }

  /**
   * Return the String representation of the object.
   *
   * This is called automatically when casting the object to a string.
   *
   * @returns {string}
   *
   * @see {@link DiceRoll#output}
   */
  toString(): string {
    return this.output;
  }

  /**
   * Create a new `DiceRoll` instance with the given data.
   *
   * `data` can be an object of data, a JSON / base64 encoded string of such data.
   *
   * The object must contain a `notation` property that defines the notation and, optionally, an
   * array of RollResults, in the `rolls` property.
   *
   * @example <caption>Object</caption>
   * DiceRoll.import({
   *   notation: '4d6',
   *   rolls: ..., // ResultGroup object or array of roll results
   * });
   *
   * @example <caption>JSON</caption>
   * DiceRoll.import('{"notation":"4d6","rolls":[...]}');
   *
   * @example <caption>Base64</caption>
   * DiceRoll.import('eyJub3RhdGlvbiI6IjRkNiIsInJvbGxzIjpbXX0=');
   *
   * @param {{notation: string, rolls: RollResults[]}|string} data The data to import
   * @param {string} data.notation If `notation` is an object; the notation to import
   * @param {RollResults[]} [data.rolls] If `notation` is an object; the rolls to import
   *
   * @returns {DiceRoll} The new `DiceRoll` instance
   *
   * @throws {DataFormatError} data format is invalid
   */
  static import(data: unknown): DiceRoll {
    if (!data) {
      throw new RequiredArgumentError('data');
    } else if ((typeof data === 'string') && isJson(data)) {
      // data is JSON format - parse and import
      return DiceRoll.import(JSON.parse(data as string));
    } else if ((typeof data === 'string') && isBase64(data)) {
      // data is base64 encoded - decode and import
      return DiceRoll.import(atob(data as string));
    } else if (typeof data === 'object') {
      // if data is a `DiceRoll` return it, otherwise build it
      return new DiceRoll(data as DiceRollImportData);
    } else {
      throw new DataFormatError(data);
    }
  }

  /**
   * Roll the dice and return the result.
   *
   * If the engine is passed, it will be used for the number generation for **this roll only**.
   * The engine will be reset after use.
   *
   * @private
   *
   * @param {{next(): number}} [engine] The RNG engine to use for die rolls
   *
   * @returns {ResultGroup} The result of the rolls
   *
   * @throws {TypeError} engine must have function `next()`
   */
  [rollMethodSymbol](engine?: NumberGeneratorEngine): ResultGroup {
    let oEngine: NumberGeneratorEngine | null = null;
    if (engine) {
      // use the selected engine
      oEngine = generator.engine;
      generator.engine = engine;
    }

    // roll the dice
    const results = new ResultGroup(this[expressionsSymbol]
      .map((expression: ParserExpression) => {
        if ((expression instanceof StandardDice) || (expression instanceof RollGroup)) {
          // roll the object and return the value
          return expression.roll();
        }

        return expression;
      })
      // filter out empty values (e.g. whitespace)
      .filter((value: unknown) => !!value || (value === 0)));

    if (engine && oEngine) {
      // reset the engine
      generator.engine = oEngine;
    }

    return results;
  }

  /* eslint-disable max-len */
  /**
   * Set the rolls.
   *
   * @private
   *
   * @param {ResultGroup|Array.<ResultGroup|RollResults|string|number|{}|Array.<RollResult|number>>} rolls
   *
   * @throws {TypeError} Rolls must be a valid result object, or an array
   */
  [setRollsSymbol](rolls: unknown): void {
    if (rolls instanceof ResultGroup) {
      this[rollsSymbol] = rolls;
    } else if (rolls instanceof RollResults) {
      this[rollsSymbol] = new ResultGroup([rolls]);
    } else if (Array.isArray(rolls)) {
      this[rollsSymbol] = new ResultGroup(rolls.map((roll: unknown) => {
        if ((roll instanceof ResultGroup) || (roll instanceof RollResults)) {
          // already a RollResults object
          return roll;
        }

        // @todo should this be a ResultGroup, or a RollResults?
        if (Array.isArray(roll)) {
          // array of values
          return new RollResults(roll);
        }

        if (typeof roll === 'object') {
          // a result group
          const maybeGroup = roll as {
            results?: unknown[];
            modifiers?: unknown;
            isRollGroup?: unknown;
            useInTotal?: unknown;
            rolls?: unknown[];
          };
          if (Array.isArray(maybeGroup.results)) {
            return new ResultGroup(
              maybeGroup.results,
              maybeGroup.modifiers || [],
              maybeGroup.isRollGroup || false,
              (typeof maybeGroup.useInTotal === 'boolean') ? maybeGroup.useInTotal : true,
            );
          }
          // roll results
          if (Array.isArray(maybeGroup.rolls)) {
            return new RollResults(maybeGroup.rolls);
          }
        }

        return roll;
      }));
    } else {
      throw new TypeError('Rolls must be a valid result object, or an array');
    }
  }
  /* eslint-enable max-len */
}

export default DiceRoll;
