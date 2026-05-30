/**
 * Check if `a` is comparative to `b` with the given operator.
 *
 * @example <caption>Is `a` greater than `b`?</caption>
 * const a = 4;
 * const b = 2;
 *
 * compareNumber(a, b, '>'); // true
 *
 * @example <caption>Is `a` equal to `b`?</caption>
 * const a = 4;
 * const b = 2;
 *
 * compareNumber(a, b, '='); // false
 *
 * @param {number} a The number to compare with `b`
 * @param {number} b The number to compare with `a`
 * @param {string} operator A valid comparative operator: `=, <, >, <=, >=, !=, <>`
 *
 * @returns {boolean} `true` if the comparison matches, `false` otherwise
 */
declare const compareNumbers: (a: number | string, b: number | string, operator: string) => boolean;
/**
 * Evaluate mathematical strings.
 *
 * Supports `+ - * / % ^` (with `^` as right-associative exponentiation), parentheses,
 * unary `+`/`-`, and the math functions emitted by the dice grammar: `abs`, `ceil`, `cos`,
 * `exp`, `floor`, `log`, `round`, `sign`, `sin`, `sqrt`, `tan` (single argument) and `pow`,
 * `max`, `min` (two arguments).
 *
 * This is a small self-contained recursive-descent evaluator that replaces the previous
 * `mathjs` dependency. The grammar only ever produces clean numeric expressions (dice
 * results are resolved to numbers before the string is assembled), so a full expression
 * engine is unnecessary. Operator precedence and associativity match the previous `mathjs`
 * behaviour, including `^` binding tighter than unary minus (e.g. `-3^2 === -9`).
 *
 * @example
 * evaluate('5+6'); // 11
 *
 * @param {string} equation The mathematical equation to compute.
 *
 * @returns {number} The result of the equation
 */
declare const evaluate: (equation: string) => number;
/**
 * Check if the given value is a valid finite number.
 *
 * @param {*} val
 *
 * @returns {boolean} `true` if it is a finite number, `false` otherwise
 */
declare const isNumeric: (val: unknown) => boolean;
/**
 * Check if the given value is a "safe" number.
 *
 * A "safe" number falls within the `Number.MAX_SAFE_INTEGER` and `Number.MIN_SAFE_INTEGER` values
 * (Inclusive).
 *
 * @param {*} val
 *
 * @returns {boolean} `true` if the value is a "safe" number, `false` otherwise
 */
declare const isSafeNumber: (val: unknown) => boolean;
/**
 * Take an array of numbers and add the values together.
 *
 * @param {number[]} numbers
 *
 * @returns {number} The summed value
 */
declare const sumArray: (numbers: unknown) => number;
/**
 * Round a number to the given amount of digits after the decimal point, removing any trailing
 * zeros after the decimal point.
 *
 * @example
 * toFixed(1.236, 2); // 1.24
 * toFixed(30.1, 2); // 30.1
 * toFixed(4.0000000004, 3); // 4
 *
 * @param {number} num The number to round
 * @param {number} [precision=0] The number of digits after the decimal point
 *
 * @returns {number}
 */
declare const toFixed: (num: number, precision?: number) => number;
export { compareNumbers, evaluate, isNumeric, isSafeNumber, sumArray, toFixed, };
