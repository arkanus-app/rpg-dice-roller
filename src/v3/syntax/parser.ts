import { DiceRollError } from '../errors.js';
import type { JsonObject, SourceSpan } from '../errors.js';
import {
  createNodeId,
  type BinaryFunctionName,
  type BinaryNode,
  type BinaryOperator,
  type ComparePointNode,
  type ComparisonOperator,
  type DiceArgumentNode,
  type DiceNode,
  type ExpressionNode,
  type FunctionNode,
  type GroupNode,
  type ModifierNode,
  type NumberNode,
  type ParenthesizedNode,
  type UnaryFunctionName,
  type UnaryNode,
  type UnaryOperator,
} from './ast.js';
import { tokenizeDiceNotation } from './scanner.js';
import type { SyntaxToken } from './tokens.js';

const UNARY_FUNCTIONS: readonly UnaryFunctionName[] = [
  'abs', 'ceil', 'cos', 'exp', 'floor', 'log', 'round', 'sign', 'sin', 'sqrt', 'tan',
];

const BINARY_FUNCTIONS: readonly BinaryFunctionName[] = ['pow', 'max', 'min'];

const BINARY_PRECEDENCE: Readonly<Record<BinaryOperator, number>> = {
  '+': 10,
  '-': 10,
  '*': 20,
  '/': 20,
  '%': 20,
  '^': 30,
  '**': 30,
};

const UNARY_PRECEDENCE = 25;

export interface DiceParserLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
}

const DEFAULT_PARSER_LIMITS: DiceParserLimits = Object.freeze({
  maxDepth: Number.MAX_SAFE_INTEGER,
  maxNodes: Number.MAX_SAFE_INTEGER,
});

type CountedNode = ExpressionNode | ModifierNode | ComparePointNode;

function isUnaryFunctionName(value: string): value is UnaryFunctionName {
  return UNARY_FUNCTIONS.some((name) => name === value);
}

function isBinaryFunctionName(value: string): value is BinaryFunctionName {
  return BINARY_FUNCTIONS.some((name) => name === value);
}

function mergeSpan(start: SourceSpan, end: SourceSpan): SourceSpan {
  return { start: start.start, end: end.end };
}

class DiceNotationParser {
  private readonly input: string;

  private readonly tokens: readonly SyntaxToken[];

  private cursor = 0;

  private recursionDepth = 0;

  private readonly limits: DiceParserLimits;

  constructor(
    input: string,
    limits: DiceParserLimits,
  ) {
    this.input = input;
    this.limits = limits;
    this.tokens = tokenizeDiceNotation(input);
  }

  parse(): ExpressionNode {
    if (this.input.length === 0) {
      return this.fail('Dice notation is required', this.current().span, {});
    }

    const expression = this.parseExpression(0);
    const trailing = this.current();
    if (trailing.kind !== 'eof') {
      return this.fail(
        `Unexpected token "${trailing.lexeme}" at offset ${trailing.span.start}`,
        trailing.span,
        { found: trailing.lexeme, expected: 'end of notation' },
      );
    }
    this.assertTreeLimits(expression);
    return expression;
  }

  private current(offset = 0): SyntaxToken {
    const index = this.cursor + offset;
    const token = this.tokens[index];
    if (token !== undefined) {
      return token;
    }
    return {
      kind: 'eof',
      lexeme: '',
      span: { start: this.input.length, end: this.input.length },
    };
  }

  private consume(): SyntaxToken {
    const token = this.current();
    if (token.kind !== 'eof') {
      this.cursor += 1;
    }
    return token;
  }

  private fail(message: string, errorSpan: SourceSpan, details: JsonObject): never {
    throw new DiceRollError(message, {
      code: 'INVALID_NOTATION',
      span: errorSpan,
      input: this.input,
      details,
    });
  }

  private failLimit(
    code: 'AST_TOO_DEEP' | 'TOO_MANY_NODES',
    limit: number,
    actual: number,
    errorSpan: SourceSpan,
  ): never {
    throw new DiceRollError(
      code === 'AST_TOO_DEEP' ? 'AST depth exceeds the parser limit' : 'AST node count exceeds the parser limit',
      {
        code,
        span: errorSpan,
        input: this.input,
        details: { limit, actual },
      },
    );
  }

  private enterExpression(): void {
    this.recursionDepth += 1;
    if (this.recursionDepth > this.limits.maxDepth) {
      this.failLimit('AST_TOO_DEEP', this.limits.maxDepth, this.recursionDepth, this.current().span);
    }
  }

  private leaveExpression(): void {
    this.recursionDepth -= 1;
  }

  private countedChildren(node: CountedNode): readonly CountedNode[] {
    switch (node.kind) {
      case 'number':
      case 'compare-point':
      case 'drop':
      case 'keep':
      case 'min':
      case 'max':
      case 'sort':
        return [];
      case 'unary':
        return [node.operand];
      case 'binary':
        return [node.left, node.right];
      case 'parenthesized':
        return [node.expression];
      case 'function':
        return node.arguments;
      case 'dice':
        return node.diceKind === 'standard'
          ? [node.quantity, node.sides, ...node.modifiers]
          : [node.quantity, ...node.modifiers];
      case 'group':
        return [...node.expressions, ...node.modifiers];
      case 'explode':
      case 'reroll':
      case 'unique':
      case 'critical-success':
      case 'critical-failure':
        return node.compare === null ? [] : [node.compare];
      case 'target':
        return node.failure === null ? [node.success] : [node.success, node.failure];
    }
  }

  private assertTreeLimits(root: ExpressionNode): void {
    const pending: Array<{ readonly node: CountedNode; readonly depth: number }> = [
      { node: root, depth: 1 },
    ];
    let count = 0;

    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) {
        break;
      }
      count += 1;
      if (count > this.limits.maxNodes) {
        this.failLimit('TOO_MANY_NODES', this.limits.maxNodes, count, current.node.span);
      }
      if (current.depth > this.limits.maxDepth) {
        this.failLimit('AST_TOO_DEEP', this.limits.maxDepth, current.depth, current.node.span);
      }
      const children = this.countedChildren(current.node);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined) {
          pending.push({ node: child, depth: current.depth + 1 });
        }
      }
    }
  }

  private expect(kind: SyntaxToken['kind'], expected: string): SyntaxToken {
    const token = this.current();
    if (token.kind !== kind) {
      return this.fail(
        `Expected ${expected} at offset ${token.span.start}`,
        token.span,
        { found: token.lexeme, expected },
      );
    }
    return this.consume();
  }

  private isIdentifier(value: string, offset = 0): boolean {
    const token = this.current(offset);
    return token.kind === 'identifier' && token.value === value;
  }

  private parseExpression(minimumPrecedence: number): ExpressionNode {
    this.enterExpression();
    try {
      let left = this.parsePrefix();

      while (true) {
        const token = this.current();
        if (token.kind !== 'operator') {
          break;
        }

        const precedence = BINARY_PRECEDENCE[token.value];
        if (precedence < minimumPrecedence) {
          break;
        }

        this.consume();
        const rightAssociative = token.value === '^' || token.value === '**';
        const right = this.parseExpression(rightAssociative ? precedence : precedence + 1);
        const nodeSpan = mergeSpan(left.span, right.span);
        const node: BinaryNode = {
          kind: 'binary',
          id: createNodeId('binary', nodeSpan),
          span: nodeSpan,
          operator: token.value,
          left,
          right,
        };
        left = node;
      }

      return left;
    } finally {
      this.leaveExpression();
    }
  }

  private parsePrefix(): ExpressionNode {
    const token = this.current();
    if (token.kind === 'operator' && (token.value === '+' || token.value === '-')) {
      const operator = token.value;
      this.consume();
      const operand = this.parseExpression(UNARY_PRECEDENCE);
      const nodeSpan = mergeSpan(token.span, operand.span);
      const node: UnaryNode = {
        kind: 'unary',
        id: createNodeId('unary', nodeSpan),
        span: nodeSpan,
        operator,
        operand,
      };
      return node;
    }

    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionNode {
    const token = this.current();
    if (token.kind === 'number') {
      return this.parseDiceSuffix(this.parseNumber(null));
    }
    if (token.kind === 'left-parenthesis') {
      return this.parseDiceSuffix(this.parseParenthesized());
    }
    if (token.kind === 'left-brace') {
      return this.parseGroup();
    }
    if (token.kind === 'identifier') {
      if (token.value === 'd' || token.value === 'dF') {
        return this.parseDice(null);
      }
      if (isUnaryFunctionName(token.value) || isBinaryFunctionName(token.value)) {
        return this.parseFunction();
      }
    }
    return this.fail(
      `Expected an expression at offset ${token.span.start}`,
      token.span,
      { found: token.lexeme, expected: 'number, dice, group, parenthesis, or function' },
    );
  }

  private parseNumber(sign: UnaryOperator | null): NumberNode {
    const signToken = sign === null ? null : this.tokens[this.cursor - 1];
    const token = this.expect('number', 'a number');
    if (token.kind !== 'number') {
      return this.fail('Internal number token mismatch', token.span, {});
    }
    const nodeSpan = signToken === undefined || signToken === null
      ? token.span
      : mergeSpan(signToken.span, token.span);
    const multiplier = sign === '-' ? -1 : 1;
    const raw = sign === null ? token.lexeme : `${sign}${token.lexeme}`;
    return {
      kind: 'number',
      id: createNodeId('number', nodeSpan),
      span: nodeSpan,
      value: multiplier * token.value,
      raw,
      implicit: false,
    };
  }

  private implicitOne(offset: number): NumberNode {
    const nodeSpan = { start: offset, end: offset };
    return {
      kind: 'number',
      id: createNodeId('implicit-number', nodeSpan),
      span: nodeSpan,
      value: 1,
      raw: '1',
      implicit: true,
    };
  }

  private parseParenthesized(): ParenthesizedNode {
    const opening = this.expect('left-parenthesis', '"("');
    const expression = this.parseExpression(0);
    const closing = this.expect('right-parenthesis', '")"');
    const nodeSpan = mergeSpan(opening.span, closing.span);
    return {
      kind: 'parenthesized',
      id: createNodeId('parenthesized', nodeSpan),
      span: nodeSpan,
      expression,
    };
  }

  private parseDiceSuffix(quantity: NumberNode | ParenthesizedNode): ExpressionNode {
    if (this.isIdentifier('d') || this.isIdentifier('dF')) {
      this.validateDiceArgument(quantity, 'quantity');
      return this.parseDice(quantity);
    }
    return quantity;
  }

  private validateDiceArgument(argument: DiceArgumentNode, label: string): void {
    if (argument.kind === 'number' && (
      !Number.isInteger(argument.value)
      || argument.value < 1
      || (argument.raw.length > 1 && argument.raw.startsWith('0'))
    )) {
      this.fail(
        `Dice ${label} must be a positive integer`,
        argument.span,
        { value: argument.value, argument: label },
      );
    }
  }

  private parseDice(quantity: DiceArgumentNode | null): DiceNode {
    const marker = this.consume();
    if (marker.kind !== 'identifier' || (marker.value !== 'd' && marker.value !== 'dF')) {
      return this.fail('Expected a dice marker', marker.span, { found: marker.lexeme });
    }
    const actualQuantity = quantity ?? this.implicitOne(marker.span.start);
    const startSpan = quantity?.span ?? marker.span;

    if (marker.value === 'dF') {
      let variant: 1 | 2 = 2;
      let coreEnd = marker.span;
      if (this.current().kind === 'dot') {
        this.consume();
        const variantToken = this.expect('number', 'Fudge variant 1 or 2');
        if (variantToken.kind !== 'number' || (variantToken.value !== 1 && variantToken.value !== 2)
          || variantToken.lexeme.length !== 1) {
          return this.fail('Fudge dice variant must be 1 or 2', variantToken.span, {
            found: variantToken.lexeme,
          });
        }
        variant = variantToken.value;
        coreEnd = variantToken.span;
      }
      const modifiers = this.parseModifiers();
      const endSpan = modifiers.length === 0 ? coreEnd : modifiers[modifiers.length - 1]?.span ?? coreEnd;
      const nodeSpan = mergeSpan(startSpan, endSpan);
      return {
        kind: 'dice',
        diceKind: 'fudge',
        id: createNodeId('dice', nodeSpan),
        span: nodeSpan,
        quantity: actualQuantity,
        variant,
        modifiers,
      };
    }

    const sideToken = this.current();
    if (sideToken.kind === 'operator' && sideToken.value === '%') {
      this.consume();
      const modifiers = this.parseModifiers();
      const endSpan = modifiers.length === 0
        ? sideToken.span
        : modifiers[modifiers.length - 1]?.span ?? sideToken.span;
      const nodeSpan = mergeSpan(startSpan, endSpan);
      return {
        kind: 'dice',
        diceKind: 'percentile',
        id: createNodeId('dice', nodeSpan),
        span: nodeSpan,
        quantity: actualQuantity,
        modifiers,
      };
    }

    const sides = sideToken.kind === 'left-parenthesis'
      ? this.parseParenthesized()
      : this.parseNumber(null);
    this.validateDiceArgument(sides, 'sides');
    const modifiers = this.parseModifiers();
    const endSpan = modifiers.length === 0
      ? sides.span
      : modifiers[modifiers.length - 1]?.span ?? sides.span;
    const nodeSpan = mergeSpan(startSpan, endSpan);
    return {
      kind: 'dice',
      diceKind: 'standard',
      id: createNodeId('dice', nodeSpan),
      span: nodeSpan,
      quantity: actualQuantity,
      sides,
      modifiers,
    };
  }

  private parseFunction(): FunctionNode {
    const nameToken = this.consume();
    if (nameToken.kind !== 'identifier') {
      return this.fail('Expected a function name', nameToken.span, {});
    }
    this.expect('left-parenthesis', '"("');
    const first = this.parseExpression(0);

    if (isUnaryFunctionName(nameToken.value)) {
      const closing = this.expect('right-parenthesis', '")"');
      const nodeSpan = mergeSpan(nameToken.span, closing.span);
      return {
        kind: 'function',
        functionKind: 'unary',
        name: nameToken.value,
        arguments: [first],
        id: createNodeId('function', nodeSpan),
        span: nodeSpan,
      };
    }

    this.expect('comma', '","');
    const second = this.parseExpression(0);
    const closing = this.expect('right-parenthesis', '")"');
    const nodeSpan = mergeSpan(nameToken.span, closing.span);
    if (!isBinaryFunctionName(nameToken.value)) {
      return this.fail('Unsupported function', nameToken.span, { found: nameToken.value });
    }
    return {
      kind: 'function',
      functionKind: 'binary',
      name: nameToken.value,
      arguments: [first, second],
      id: createNodeId('function', nodeSpan),
      span: nodeSpan,
    };
  }

  private parseGroup(): GroupNode {
    const opening = this.expect('left-brace', '"{"');
    const expressions: ExpressionNode[] = [this.parseExpression(0)];
    while (this.current().kind === 'comma') {
      this.consume();
      expressions.push(this.parseExpression(0));
    }
    const closing = this.expect('right-brace', '"}"');
    const modifiers = this.parseModifiers();
    const endSpan = modifiers.length === 0
      ? closing.span
      : modifiers[modifiers.length - 1]?.span ?? closing.span;
    const nodeSpan = mergeSpan(opening.span, endSpan);
    return {
      kind: 'group',
      id: createNodeId('group', nodeSpan),
      span: nodeSpan,
      expressions,
      modifiers,
    };
  }

  private isComparePointStart(): boolean {
    const token = this.current();
    return token.kind === 'comparison'
      || (token.kind === 'bang' && this.current(1).kind === 'comparison'
        && this.current(1).lexeme === '=');
  }

  private parseComparePoint(): ComparePointNode {
    const first = this.current();
    let operator: ComparisonOperator;
    let operatorSpan: SourceSpan;
    if (first.kind === 'bang') {
      this.consume();
      const equals = this.expect('comparison', '"=" after "!"');
      if (equals.kind !== 'comparison' || equals.value !== '=') {
        return this.fail('Expected "=" after "!"', equals.span, { found: equals.lexeme });
      }
      operator = '!=';
      operatorSpan = mergeSpan(first.span, equals.span);
    } else if (first.kind === 'comparison') {
      this.consume();
      operator = first.value;
      operatorSpan = first.span;
    } else {
      return this.fail('Expected a comparison operator', first.span, { found: first.lexeme });
    }

    let sign: UnaryOperator | null = null;
    const signCandidate = this.current();
    if (signCandidate.kind === 'operator'
      && (signCandidate.value === '+' || signCandidate.value === '-')) {
      sign = signCandidate.value;
      this.consume();
    }
    const value = this.parseNumber(sign);
    const nodeSpan = mergeSpan(operatorSpan, value.span);
    return {
      kind: 'compare-point',
      id: createNodeId('compare-point', nodeSpan),
      span: nodeSpan,
      operator,
      value: value.value,
    };
  }

  private parseModifiers(): readonly ModifierNode[] {
    const modifiers: ModifierNode[] = [];
    while (true) {
      const modifier = this.parseModifier();
      if (modifier === null) {
        break;
      }
      modifiers.push(modifier);
    }
    return modifiers;
  }

  private parseModifier(): ModifierNode | null {
    const token = this.current();
    if (token.kind === 'bang') {
      return this.parseExplode();
    }
    if (token.kind === 'comparison') {
      return this.parseTarget();
    }
    if (token.kind !== 'identifier') {
      return null;
    }
    switch (token.value) {
      case 'd':
        return this.parseDropKeep('drop');
      case 'k':
        return this.parseDropKeep('keep');
      case 'max':
        return this.parseMinMax('max');
      case 'min':
        return this.parseMinMax('min');
      case 'r':
        return this.parseRerollUnique('reroll');
      case 'u':
        return this.parseRerollUnique('unique');
      case 'cs':
        return this.parseCritical('critical-success');
      case 'cf':
        return this.parseCritical('critical-failure');
      case 's':
        return this.parseSort();
      default:
        return null;
    }
  }

  private parseExplode(): ModifierNode {
    const firstBang = this.expect('bang', '"!"');
    let compound = false;
    if (this.current().kind === 'bang') {
      compound = true;
      this.consume();
    }
    let penetrate = false;
    if (this.isIdentifier('p')) {
      penetrate = true;
      this.consume();
    }
    const compare = this.isComparePointStart() ? this.parseComparePoint() : null;
    const lastSpan = compare?.span ?? this.tokens[this.cursor - 1]?.span ?? firstBang.span;
    const nodeSpan = mergeSpan(firstBang.span, lastSpan);
    return {
      kind: 'explode',
      id: createNodeId('explode', nodeSpan),
      span: nodeSpan,
      compound,
      penetrate,
      compare,
    };
  }

  private parseTarget(): ModifierNode {
    const success = this.parseComparePoint();
    let failure: ComparePointNode | null = null;
    if (this.isIdentifier('f')) {
      this.consume();
      failure = this.parseComparePoint();
    }
    const nodeSpan = mergeSpan(success.span, failure?.span ?? success.span);
    return {
      kind: 'target',
      id: createNodeId('target', nodeSpan),
      span: nodeSpan,
      success,
      failure,
    };
  }

  private parsePositiveInteger(label: string): NumberNode {
    const value = this.parseNumber(null);
    if (!Number.isInteger(value.value) || value.value < 1
      || (value.raw.length > 1 && value.raw.startsWith('0'))) {
      return this.fail(`${label} must be a positive integer`, value.span, { value: value.value });
    }
    return value;
  }

  private parseDropKeep(kind: 'drop' | 'keep'): ModifierNode {
    const opening = this.consume();
    let selection: 'lowest' | 'highest' = kind === 'drop' ? 'lowest' : 'highest';
    if (this.isIdentifier('l')) {
      this.consume();
      selection = 'lowest';
    } else if (this.isIdentifier('h')) {
      this.consume();
      selection = 'highest';
    }
    const quantity = this.parsePositiveInteger(`${kind} quantity`);
    const nodeSpan = mergeSpan(opening.span, quantity.span);
    if (kind === 'drop') {
      return {
        kind,
        id: createNodeId(kind, nodeSpan),
        span: nodeSpan,
        selection,
        quantity: quantity.value,
      };
    }
    return {
      kind,
      id: createNodeId(kind, nodeSpan),
      span: nodeSpan,
      selection,
      quantity: quantity.value,
    };
  }

  private parseSignedFloat(): NumberNode {
    const token = this.current();
    if (token.kind === 'operator' && (token.value === '+' || token.value === '-')) {
      this.consume();
      return this.parseNumber(token.value);
    }
    return this.parseNumber(null);
  }

  private parseMinMax(kind: 'min' | 'max'): ModifierNode {
    const opening = this.consume();
    const value = this.parseSignedFloat();
    const nodeSpan = mergeSpan(opening.span, value.span);
    if (kind === 'min') {
      return { kind, id: createNodeId(kind, nodeSpan), span: nodeSpan, value: value.value };
    }
    return { kind, id: createNodeId(kind, nodeSpan), span: nodeSpan, value: value.value };
  }

  private parseRerollUnique(kind: 'reroll' | 'unique'): ModifierNode {
    const opening = this.consume();
    let once = false;
    if (this.isIdentifier('o')) {
      once = true;
      this.consume();
    }
    const compare = this.isComparePointStart() ? this.parseComparePoint() : null;
    const lastSpan = compare?.span ?? this.tokens[this.cursor - 1]?.span ?? opening.span;
    const nodeSpan = mergeSpan(opening.span, lastSpan);
    if (kind === 'reroll') {
      return { kind, id: createNodeId(kind, nodeSpan), span: nodeSpan, once, compare };
    }
    return { kind, id: createNodeId(kind, nodeSpan), span: nodeSpan, once, compare };
  }

  private parseCritical(kind: 'critical-success' | 'critical-failure'): ModifierNode {
    const opening = this.consume();
    const compare = this.isComparePointStart() ? this.parseComparePoint() : null;
    const nodeSpan = mergeSpan(opening.span, compare?.span ?? opening.span);
    if (kind === 'critical-success') {
      return { kind, id: createNodeId(kind, nodeSpan), span: nodeSpan, compare };
    }
    return { kind, id: createNodeId(kind, nodeSpan), span: nodeSpan, compare };
  }

  private parseSort(): ModifierNode {
    const opening = this.consume();
    let direction: 'ascending' | 'descending' = 'ascending';
    let closingSpan = opening.span;
    if (this.isIdentifier('a')) {
      closingSpan = this.consume().span;
    } else if (this.isIdentifier('d')) {
      direction = 'descending';
      closingSpan = this.consume().span;
    }
    const nodeSpan = mergeSpan(opening.span, closingSpan);
    return { kind: 'sort', id: createNodeId('sort', nodeSpan), span: nodeSpan, direction };
  }
}

/** Parses one compact, comment-free roll formula (without an `N#` prefix). */
export function parseDiceNotation(
  input: string,
  limits: DiceParserLimits = DEFAULT_PARSER_LIMITS,
): ExpressionNode {
  return new DiceNotationParser(input, limits).parse();
}
