import { DiceRollError } from '../errors.js';
import type { JsonObject, SourceSpan } from '../errors.js';
import type { BinaryOperator } from './ast.js';
import type { PunctuationKind, SyntaxToken } from './tokens.js';

const RESERVED_WORDS: readonly string[] = [
  'floor',
  'round',
  'sqrt',
  'ceil',
  'sign',
  'abs',
  'cos',
  'exp',
  'log',
  'sin',
  'tan',
  'pow',
  'max',
  'min',
  'dF',
  'cs',
  'cf',
];

const SINGLE_LETTER_IDENTIFIERS = 'dkrusfpolha';

const PUNCTUATION_KINDS: Readonly<Record<string, PunctuationKind>> = Object.freeze({
  '(': 'left-parenthesis',
  ')': 'right-parenthesis',
  '{': 'left-brace',
  '}': 'right-brace',
  ',': 'comma',
  '.': 'dot',
  '!': 'bang',
});

function span(start: number, end: number): SourceSpan {
  return { start, end };
}

function invalidNotation(
  input: string,
  message: string,
  errorSpan: SourceSpan,
  details: JsonObject,
): never {
  throw new DiceRollError(message, {
    code: 'INVALID_NOTATION',
    span: errorSpan,
    input,
    details,
  });
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9';
}

function isWhitespace(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const code = value.charCodeAt(0);
  return code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c
    || code === 0x0d || code === 0x20 || code === 0xa0 || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029
    || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

function isAsciiLetter(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const code = value.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isBinaryOperator(value: string | undefined): value is BinaryOperator {
  return value === '+' || value === '-' || value === '*' || value === '/'
    || value === '%' || value === '^';
}

function readNumber(input: string, start: number): SyntaxToken {
  let cursor = start;

  while (isDigit(input[cursor])) {
    cursor += 1;
  }

  if (input[cursor] === '.' && isDigit(input[cursor + 1])) {
    cursor += 1;
    while (isDigit(input[cursor])) {
      cursor += 1;
    }
  }

  const lexeme = input.slice(start, cursor);
  const value = Number(lexeme);
  if (!Number.isFinite(value)) {
    return invalidNotation(
      input,
      `Numeric literal is not finite at offset ${start}`,
      span(start, cursor),
      { found: lexeme },
    );
  }
  return {
    kind: 'number',
    lexeme,
    value,
    span: span(start, cursor),
  };
}

function readIdentifier(input: string, start: number): SyntaxToken {
  const reserved = RESERVED_WORDS.find((word) => input.startsWith(word, start));
  if (reserved !== undefined) {
    return {
      kind: 'identifier',
      lexeme: reserved,
      value: reserved,
      span: span(start, start + reserved.length),
    };
  }

  const value = input[start];
  if (value !== undefined && SINGLE_LETTER_IDENTIFIERS.includes(value)) {
    return {
      kind: 'identifier',
      lexeme: value,
      value,
      span: span(start, start + 1),
    };
  }

  return invalidNotation(
    input,
    `Unexpected identifier at offset ${start}`,
    span(start, start + 1),
    { found: value ?? '' },
  );
}

function punctuation(kind: PunctuationKind, lexeme: string, start: number): SyntaxToken {
  const tokenSpan = span(start, start + lexeme.length);
  switch (kind) {
    case 'left-parenthesis':
    case 'right-parenthesis':
    case 'left-brace':
    case 'right-brace':
    case 'comma':
    case 'dot':
    case 'bang':
      return { kind, lexeme, span: tokenSpan };
    default:
      throw new Error('Invalid punctuation token kind');
  }
}

/** Tokenizes compact V3 notation while retaining exact source offsets. */
export function tokenizeDiceNotation(input: string): readonly SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const current = input[cursor];

    if (isWhitespace(current)) {
      cursor += 1;
    } else if (isDigit(current)) {
      const token = readNumber(input, cursor);
      tokens.push(token);
      cursor = token.span.end;
    } else if (isAsciiLetter(current)) {
      const token = readIdentifier(input, cursor);
      tokens.push(token);
      cursor = token.span.end;
    } else if (input.startsWith('**', cursor)) {
      tokens.push({
        kind: 'operator',
        lexeme: '**',
        value: '**',
        span: span(cursor, cursor + 2),
      });
      cursor += 2;
    } else if (input.startsWith('<=', cursor) || input.startsWith('>=', cursor)
      || input.startsWith('<>', cursor)) {
      const value = input.slice(cursor, cursor + 2);
      if (value === '<=' || value === '>=' || value === '<>') {
        tokens.push({
          kind: 'comparison',
          lexeme: value,
          value,
          span: span(cursor, cursor + 2),
        });
      }
      cursor += 2;
    } else if (isBinaryOperator(current)) {
      tokens.push({
        kind: 'operator',
        lexeme: current,
        value: current,
        span: span(cursor, cursor + 1),
      });
      cursor += 1;
    } else if (current === '=' || current === '<' || current === '>') {
      tokens.push({
        kind: 'comparison',
        lexeme: current,
        value: current,
        span: span(cursor, cursor + 1),
      });
      cursor += 1;
    } else {
      const kind = current === undefined ? undefined : PUNCTUATION_KINDS[current];
      if (kind === undefined) {
        return invalidNotation(
          input,
          `Unexpected character at offset ${cursor}`,
          span(cursor, cursor + 1),
          { found: current ?? '' },
        );
      }
      tokens.push(punctuation(kind, current ?? '', cursor));
      cursor += 1;
    }
  }

  tokens.push({ kind: 'eof', lexeme: '', span: span(input.length, input.length) });
  return tokens;
}
