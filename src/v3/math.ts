import { DiceRollError } from './errors.js';

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '^';

export type UnaryMathFunction =
  | 'abs'
  | 'ceil'
  | 'cos'
  | 'exp'
  | 'floor'
  | 'log'
  | 'round'
  | 'sign'
  | 'sin'
  | 'sqrt'
  | 'tan';

export type BinaryMathFunction = 'max' | 'min' | 'pow';

export type MathProfile = 'decimal12-v1';

export const MATH_PROFILE: MathProfile = 'decimal12-v1';

const SIGNIFICANT_DIGITS = 12;

function ensureFinite(value: number, input: string): number {
  if (!Number.isFinite(value)) {
    throw new DiceRollError('Dice expression produced a non-finite result', {
      code: 'NON_FINITE_RESULT',
      input,
      details: { value: String(value) },
    });
  }
  return Object.is(value, -0) ? 0 : value;
}

/** Applies the V3 cross-runtime numeric profile after every math operation. */
export function normalizeMathValue(value: number, input: string): number {
  const finite = ensureFinite(value, input);
  const normalized = Number.isSafeInteger(finite)
    ? finite
    : Number(finite.toPrecision(SIGNIFICANT_DIGITS));
  return ensureFinite(normalized, input);
}

export function evaluateBinary(
  operator: BinaryOperator,
  left: number,
  right: number,
  input: string,
): number {
  let result: number;

  switch (operator) {
    case '+':
      result = left + right;
      break;
    case '-':
      result = left - right;
      break;
    case '*':
      result = left * right;
      break;
    case '/':
      result = left / right;
      break;
    case '%':
      result = left % right;
      break;
    case '^':
      result = left ** right;
      break;
  }

  return normalizeMathValue(result, input);
}

export function evaluateUnaryFunction(
  name: UnaryMathFunction,
  value: number,
  input: string,
): number {
  let result: number;

  switch (name) {
    case 'abs':
      result = Math.abs(value);
      break;
    case 'ceil':
      result = Math.ceil(value);
      break;
    case 'cos':
      result = Math.cos(value);
      break;
    case 'exp':
      result = Math.exp(value);
      break;
    case 'floor':
      result = Math.floor(value);
      break;
    case 'log':
      result = Math.log(value);
      break;
    case 'round':
      result = Math.round(value);
      break;
    case 'sign':
      result = Math.sign(value);
      break;
    case 'sin':
      result = Math.sin(value);
      break;
    case 'sqrt':
      result = Math.sqrt(value);
      break;
    case 'tan':
      result = Math.tan(value);
      break;
  }

  return normalizeMathValue(result, input);
}

export function evaluateBinaryFunction(
  name: BinaryMathFunction,
  left: number,
  right: number,
  input: string,
): number {
  let result: number;

  switch (name) {
    case 'max':
      result = Math.max(left, right);
      break;
    case 'min':
      result = Math.min(left, right);
      break;
    case 'pow':
      result = Math.pow(left, right);
      break;
  }

  return normalizeMathValue(result, input);
}

export function compareValues(
  operator: '=' | '!=' | '<>' | '<' | '>' | '<=' | '>=',
  left: number,
  right: number,
): boolean {
  switch (operator) {
    case '=':
      return left === right;
    case '!=':
    case '<>':
      return left !== right;
    case '<':
      return left < right;
    case '>':
      return left > right;
    case '<=':
      return left <= right;
    case '>=':
      return left >= right;
  }
}

export function roundResult(value: number): number {
  const rounded = Number(normalizeMathValue(value, '').toFixed(2));
  return Object.is(rounded, -0) ? 0 : rounded;
}
