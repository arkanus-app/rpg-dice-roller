import {
  evaluateBinary,
  evaluateBinaryFunction,
  evaluateUnaryFunction,
  normalizeMathValue,
} from './math.js';
import { parseDiceNotation, type ExpressionNode } from './syntax/index.js';

const ROLL_COUNT_PARSER_LIMITS = Object.freeze({ maxDepth: 64, maxNodes: 512 });
const GROUP_CLOSERS: Readonly<Record<string, string>> = Object.freeze({
  '(': ')',
  '[': ']',
  '{': '}',
});
const CLOSING_GROUPS = new Set(Object.values(GROUP_CLOSERS));

function unwrapOuterGroups(expression: string): string {
  let current = expression.trim();

  for (;;) {
    const expectedOuterCloser = GROUP_CLOSERS[current.charAt(0)];
    if (expectedOuterCloser === undefined || current.charAt(current.length - 1) !== expectedOuterCloser) {
      return current;
    }

    const closerStack: string[] = [];
    let closesBeforeExpressionEnd = false;

    for (let index = 0; index < current.length; index += 1) {
      const character = current.charAt(index);
      const closer = GROUP_CLOSERS[character];
      if (closer !== undefined) {
        closerStack.push(closer);
        continue;
      }
      if (!CLOSING_GROUPS.has(character)) {
        continue;
      }
      if (closerStack.pop() !== character) {
        return current;
      }
      if (closerStack.length === 0 && index < current.length - 1) {
        closesBeforeExpressionEnd = true;
        break;
      }
    }

    if (closesBeforeExpressionEnd || closerStack.length !== 0) {
      return current;
    }
    current = current.slice(1, -1).trim();
  }
}

function expressionChildren(node: ExpressionNode): readonly ExpressionNode[] {
  switch (node.kind) {
    case 'number': return [];
    case 'unary': return [node.operand];
    case 'binary': return [node.left, node.right];
    case 'parenthesized': return [node.expression];
    case 'function': return node.arguments;
    case 'dice': return node.diceKind === 'standard'
      ? [node.quantity, node.sides]
      : [node.quantity];
    case 'group': return node.expressions;
  }
}

function buildPostOrder(root: ExpressionNode): readonly ExpressionNode[] {
  const output: ExpressionNode[] = [];
  const pending: Array<{ readonly node: ExpressionNode; readonly visited: boolean }> = [
    { node: root, visited: false },
  ];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    if (current.visited) {
      output.push(current.node);
      continue;
    }
    pending.push({ node: current.node, visited: true });
    const children = expressionChildren(current.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push({ node: child, visited: false });
      }
    }
  }

  return output;
}

function evaluateConstantRollCount(root: ExpressionNode, input: string): number | null {
  const constants = new Map<string, number>();
  const read = (node: ExpressionNode): number | null => constants.get(node.id) ?? null;

  for (const node of buildPostOrder(root)) {
    let value: number | null;
    switch (node.kind) {
      case 'number': value = node.value; break;
      case 'dice':
      case 'group': value = null; break;
      case 'unary': {
        const operand = read(node.operand);
        value = operand === null
          ? null
          : normalizeMathValue(node.operator === '-' ? -operand : operand, input);
        break;
      }
      case 'parenthesized': value = read(node.expression); break;
      case 'binary': {
        const left = read(node.left);
        const right = read(node.right);
        value = left === null || right === null
          ? null
          : evaluateBinary(node.operator === '**' ? '^' : node.operator, left, right, input);
        break;
      }
      case 'function': {
        const first = read(node.arguments[0]);
        if (first === null) {
          value = null;
        } else if (node.functionKind === 'unary') {
          value = evaluateUnaryFunction(node.name, first, input);
        } else {
          const second = read(node.arguments[1]);
          value = second === null ? null : evaluateBinaryFunction(node.name, first, second, input);
        }
        break;
      }
    }
    if (value !== null) {
      constants.set(node.id, value);
    }
  }

  return read(root);
}

/** Resolves a deterministic expression used before the multi-roll `#` marker. */
export function resolveRollCountExpression(expression: string): number | null {
  const normalized = unwrapOuterGroups(expression).replace(/\s+/gu, '');
  if (normalized.length === 0) {
    return null;
  }

  try {
    const ast = parseDiceNotation(normalized, ROLL_COUNT_PARSER_LIMITS);
    return evaluateConstantRollCount(ast, normalized);
  } catch {
    return null;
  }
}
