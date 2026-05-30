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
const compareNumbers = (a: number | string, b: number | string, operator: string): boolean => {
  const aNum = Number(a);
  const bNum = Number(b);
  let result: boolean;

  if (Number.isNaN(aNum) || Number.isNaN(bNum)) {
    return false;
  }

  switch (operator) {
    case '=':
    case '==':
      result = aNum === bNum;
      break;
    case '<':
      result = aNum < bNum;
      break;
    case '>':
      result = aNum > bNum;
      break;
    case '<=':
      result = aNum <= bNum;
      break;
    case '>=':
      result = aNum >= bNum;
      break;
    case '!':
    case '!=':
    case '<>':
      result = aNum !== bNum;
      break;
    default:
      result = false;
      break;
  }

  return result;
};

const unaryFunctions: Record<string, (value: number) => number> = {
  abs: Math.abs,
  ceil: Math.ceil,
  cos: Math.cos,
  exp: Math.exp,
  floor: Math.floor,
  log: Math.log,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
};

const binaryFunctions: Record<string, (a: number, b: number) => number> = {
  pow: (a, b) => a ** b,
  max: Math.max,
  min: Math.min,
};

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
/* eslint-disable @typescript-eslint/no-use-before-define */
const evaluate = (equation: string): number => {
  const source = String(equation);
  let pos = 0;

  const skipWhitespace = (): void => {
    while ((pos < source.length) && /\s/.test(source[pos])) {
      pos += 1;
    }
  };

  const fail = (message: string): never => {
    throw new SyntaxError(`Unable to evaluate expression "${equation}": ${message}`);
  };

  // additive: term (('+' | '-') term)*
  function parseExpression(): number {
    let value = parseTerm();

    for (;;) {
      skipWhitespace();
      const operator = source[pos];

      if (operator === '+') {
        pos += 1;
        value += parseTerm();
      } else if (operator === '-') {
        pos += 1;
        value -= parseTerm();
      } else {
        return value;
      }
    }
  }

  // multiplicative: unary (('*' | '/' | '%') unary)*
  function parseTerm(): number {
    let value = parseUnary();

    for (;;) {
      skipWhitespace();
      const operator = source[pos];

      if (operator === '*') {
        pos += 1;
        value *= parseUnary();
      } else if (operator === '/') {
        pos += 1;
        value /= parseUnary();
      } else if (operator === '%') {
        pos += 1;
        value %= parseUnary();
      } else {
        return value;
      }
    }
  }

  // unary: ('+' | '-') unary | power
  function parseUnary(): number {
    skipWhitespace();
    const char = source[pos];

    if (char === '+') {
      pos += 1;
      return parseUnary();
    }

    if (char === '-') {
      pos += 1;
      return -parseUnary();
    }

    return parsePower();
  }

  // power: primary ('^' unary)?  (right-associative, binds tighter than unary minus)
  function parsePower(): number {
    const base = parsePrimary();
    skipWhitespace();

    if (source[pos] === '^') {
      pos += 1;
      return base ** parseUnary();
    }

    return base;
  }

  // primary: number | '(' expression ')' | function call
  function parsePrimary(): number {
    skipWhitespace();
    const char = source[pos];

    if (char === undefined) {
      return fail('unexpected end of expression');
    }

    if (char === '(') {
      pos += 1;
      const value = parseExpression();
      skipWhitespace();
      if (source[pos] !== ')') {
        fail('expected ")"');
      }
      pos += 1;
      return value;
    }

    if (/[a-z]/i.test(char)) {
      return parseFunction();
    }

    return parseNumber();
  }

  function parseFunction(): number {
    const start = pos;
    while ((pos < source.length) && /[a-z]/i.test(source[pos])) {
      pos += 1;
    }
    const name = source.slice(start, pos);

    skipWhitespace();
    if (source[pos] !== '(') {
      return fail(`expected "(" after "${name}"`);
    }
    pos += 1;

    const firstArg = parseExpression();
    skipWhitespace();

    if (source[pos] === ',') {
      pos += 1;
      const secondArg = parseExpression();
      skipWhitespace();
      if (source[pos] !== ')') {
        return fail('expected ")"');
      }
      pos += 1;

      const fn = binaryFunctions[name];
      if (!fn) {
        return fail(`unknown function "${name}"`);
      }
      return fn(firstArg, secondArg);
    }

    if (source[pos] !== ')') {
      return fail('expected ")"');
    }
    pos += 1;

    const fn = unaryFunctions[name];
    if (!fn) {
      return fail(`unknown function "${name}"`);
    }
    return fn(firstArg);
  }

  function parseNumber(): number {
    const start = pos;
    while ((pos < source.length) && /[0-9.]/.test(source[pos])) {
      pos += 1;
    }

    const raw = source.slice(start, pos);
    if (raw === '') {
      return fail(`unexpected token "${source[pos]}"`);
    }

    const value = Number(raw);
    if (Number.isNaN(value)) {
      return fail(`invalid number "${raw}"`);
    }
    return value;
  }

  skipWhitespace();
  if (source.length === 0) {
    return fail('empty expression');
  }

  const result = parseExpression();
  skipWhitespace();
  if (pos < source.length) {
    return fail(`unexpected token "${source[pos]}"`);
  }

  return result;
};
/* eslint-enable @typescript-eslint/no-use-before-define */

/**
 * Check if the given value is a valid finite number.
 *
 * @param {*} val
 *
 * @returns {boolean} `true` if it is a finite number, `false` otherwise
 */
const isNumeric = (val: unknown): boolean => {
  if ((typeof val !== 'number') && (typeof val !== 'string')) {
    return false;
  }

  return !Number.isNaN(val) && Number.isFinite(Number(val));
};

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
const isSafeNumber = (val: unknown): boolean => {
  if (!isNumeric(val)) {
    return false;
  }

  const castVal = Number(val);

  return (castVal <= Number.MAX_SAFE_INTEGER) && (castVal >= Number.MIN_SAFE_INTEGER);
};

/**
 * Take an array of numbers and add the values together.
 *
 * @param {number[]} numbers
 *
 * @returns {number} The summed value
 */
const sumArray = (numbers: unknown): number => (
  !Array.isArray(numbers) ? 0 : numbers.reduce((prev, current) => (
    prev + (isNumeric(current) ? parseFloat(`${current}`) : 0)
  ), 0)
);

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
const toFixed = (num: number, precision = 0): number => (
  // round to precision, then cast to a number to remove trailing zeroes after the decimal point
  parseFloat(parseFloat(`${num}`).toFixed(precision || 0))
);

export {
  compareNumbers,
  evaluate,
  isNumeric,
  isSafeNumber,
  sumArray,
  toFixed,
};
