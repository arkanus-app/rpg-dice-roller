import type { SourceSpan } from '../errors.js';

export type { SourceSpan } from '../errors.js';

export type NodeId = string;

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '^' | '**';

export type UnaryOperator = '+' | '-';

export type ComparisonOperator = '=' | '!=' | '<>' | '<' | '>' | '<=' | '>=';

export type UnaryFunctionName =
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

export type BinaryFunctionName = 'pow' | 'max' | 'min';

export interface SyntaxNodeBase {
  readonly id: NodeId;
  readonly span: SourceSpan;
}

export interface NumberNode extends SyntaxNodeBase {
  readonly kind: 'number';
  readonly value: number;
  readonly raw: string;
  readonly implicit: boolean;
}

export interface UnaryNode extends SyntaxNodeBase {
  readonly kind: 'unary';
  readonly operator: UnaryOperator;
  readonly operand: ExpressionNode;
}

export interface BinaryNode extends SyntaxNodeBase {
  readonly kind: 'binary';
  readonly operator: BinaryOperator;
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
}

export interface ParenthesizedNode extends SyntaxNodeBase {
  readonly kind: 'parenthesized';
  readonly expression: ExpressionNode;
}

export interface UnaryFunctionNode extends SyntaxNodeBase {
  readonly kind: 'function';
  readonly functionKind: 'unary';
  readonly name: UnaryFunctionName;
  readonly arguments: readonly [ExpressionNode];
}

export interface BinaryFunctionNode extends SyntaxNodeBase {
  readonly kind: 'function';
  readonly functionKind: 'binary';
  readonly name: BinaryFunctionName;
  readonly arguments: readonly [ExpressionNode, ExpressionNode];
}

export type FunctionNode = UnaryFunctionNode | BinaryFunctionNode;

export type DiceArgumentNode = NumberNode | ParenthesizedNode;

export interface StandardDiceNode extends SyntaxNodeBase {
  readonly kind: 'dice';
  readonly diceKind: 'standard';
  readonly quantity: DiceArgumentNode;
  readonly sides: DiceArgumentNode;
  readonly modifiers: readonly ModifierNode[];
}

export interface PercentileDiceNode extends SyntaxNodeBase {
  readonly kind: 'dice';
  readonly diceKind: 'percentile';
  readonly quantity: DiceArgumentNode;
  readonly modifiers: readonly ModifierNode[];
}

export interface FudgeDiceNode extends SyntaxNodeBase {
  readonly kind: 'dice';
  readonly diceKind: 'fudge';
  readonly quantity: DiceArgumentNode;
  readonly variant: 1 | 2;
  readonly modifiers: readonly ModifierNode[];
}

export type DiceNode = StandardDiceNode | PercentileDiceNode | FudgeDiceNode;

export interface GroupNode extends SyntaxNodeBase {
  readonly kind: 'group';
  readonly expressions: readonly ExpressionNode[];
  readonly modifiers: readonly ModifierNode[];
}

export type ExpressionNode =
  | NumberNode
  | UnaryNode
  | BinaryNode
  | ParenthesizedNode
  | FunctionNode
  | DiceNode
  | GroupNode;

export interface ComparePointNode extends SyntaxNodeBase {
  readonly kind: 'compare-point';
  readonly operator: ComparisonOperator;
  readonly value: number;
}

export interface ExplodeModifierNode extends SyntaxNodeBase {
  readonly kind: 'explode';
  readonly compound: boolean;
  readonly penetrate: boolean;
  readonly compare: ComparePointNode | null;
}

export interface TargetModifierNode extends SyntaxNodeBase {
  readonly kind: 'target';
  readonly success: ComparePointNode;
  readonly failure: ComparePointNode | null;
}

export interface DropModifierNode extends SyntaxNodeBase {
  readonly kind: 'drop';
  readonly selection: 'lowest' | 'highest';
  readonly quantity: number;
}

export interface KeepModifierNode extends SyntaxNodeBase {
  readonly kind: 'keep';
  readonly selection: 'lowest' | 'highest';
  readonly quantity: number;
}

export interface MinimumModifierNode extends SyntaxNodeBase {
  readonly kind: 'min';
  readonly value: number;
}

export interface MaximumModifierNode extends SyntaxNodeBase {
  readonly kind: 'max';
  readonly value: number;
}

export interface RerollModifierNode extends SyntaxNodeBase {
  readonly kind: 'reroll';
  readonly once: boolean;
  readonly compare: ComparePointNode | null;
}

export interface UniqueModifierNode extends SyntaxNodeBase {
  readonly kind: 'unique';
  readonly once: boolean;
  readonly compare: ComparePointNode | null;
}

export interface CriticalSuccessModifierNode extends SyntaxNodeBase {
  readonly kind: 'critical-success';
  readonly compare: ComparePointNode | null;
}

export interface CriticalFailureModifierNode extends SyntaxNodeBase {
  readonly kind: 'critical-failure';
  readonly compare: ComparePointNode | null;
}

export interface SortModifierNode extends SyntaxNodeBase {
  readonly kind: 'sort';
  readonly direction: 'ascending' | 'descending';
}

export type ModifierNode =
  | ExplodeModifierNode
  | TargetModifierNode
  | DropModifierNode
  | KeepModifierNode
  | MinimumModifierNode
  | MaximumModifierNode
  | RerollModifierNode
  | UniqueModifierNode
  | CriticalSuccessModifierNode
  | CriticalFailureModifierNode
  | SortModifierNode;

export function createNodeId(kind: string, span: SourceSpan): NodeId {
  return `${kind}@${span.start}:${span.end}`;
}
