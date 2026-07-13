import type { BinaryOperator, ComparisonOperator } from './ast.js';
import type { SourceSpan } from '../errors.js';

export interface NumberToken {
  readonly kind: 'number';
  readonly lexeme: string;
  readonly value: number;
  readonly span: SourceSpan;
}

export interface IdentifierToken {
  readonly kind: 'identifier';
  readonly lexeme: string;
  readonly value: string;
  readonly span: SourceSpan;
}

export interface OperatorToken {
  readonly kind: 'operator';
  readonly lexeme: string;
  readonly value: BinaryOperator;
  readonly span: SourceSpan;
}

export interface ComparisonToken {
  readonly kind: 'comparison';
  readonly lexeme: string;
  readonly value: Exclude<ComparisonOperator, '!='>;
  readonly span: SourceSpan;
}

export type PunctuationKind =
  | 'left-parenthesis'
  | 'right-parenthesis'
  | 'left-brace'
  | 'right-brace'
  | 'comma'
  | 'dot'
  | 'bang';

export interface PunctuationToken {
  readonly kind: PunctuationKind;
  readonly lexeme: string;
  readonly span: SourceSpan;
}

export interface EofToken {
  readonly kind: 'eof';
  readonly lexeme: '';
  readonly span: SourceSpan;
}

export type SyntaxToken =
  | NumberToken
  | IdentifierToken
  | OperatorToken
  | ComparisonToken
  | PunctuationToken
  | EofToken;
