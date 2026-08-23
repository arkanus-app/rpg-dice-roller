import { describe, expect, test } from 'vitest';
import { isDiceRollError } from '../errors.js';
import type { DiceNode, GroupNode } from './ast.js';
import { parseDiceNotation } from './parser.js';
import { tokenizeDiceNotation } from './scanner.js';

function parseDice(input: string): DiceNode {
  const node = parseDiceNotation(input);
  if (node.kind !== 'dice') {
    throw new Error(`Expected dice, received ${node.kind}`);
  }
  return node;
}

function parseGroup(input: string): GroupNode {
  const node = parseDiceNotation(input);
  if (node.kind !== 'group') {
    throw new Error(`Expected group, received ${node.kind}`);
  }
  return node;
}

describe('V3 notation scanner', () => {
  test('retains half-open spans and separates ! from = for contextual parsing', () => {
    expect(tokenizeDiceNotation('1d6r!=1')).toEqual([
      { kind: 'number', lexeme: '1', value: 1, span: { start: 0, end: 1 } },
      { kind: 'identifier', lexeme: 'd', value: 'd', span: { start: 1, end: 2 } },
      { kind: 'number', lexeme: '6', value: 6, span: { start: 2, end: 3 } },
      { kind: 'identifier', lexeme: 'r', value: 'r', span: { start: 3, end: 4 } },
      { kind: 'bang', lexeme: '!', span: { start: 4, end: 5 } },
      { kind: 'comparison', lexeme: '=', value: '=', span: { start: 5, end: 6 } },
      { kind: 'number', lexeme: '1', value: 1, span: { start: 6, end: 7 } },
      { kind: 'eof', lexeme: '', span: { start: 7, end: 7 } },
    ]);
  });

  test.each(['@', '$', '?', '1d6&2'])('rejects invalid token input %j', (input) => {
    expect(() => tokenizeDiceNotation(input)).toThrow(
      expect.objectContaining({ code: 'INVALID_NOTATION' }),
    );
  });

  test('recognizes whitespace and every comparison token', () => {
    expect(tokenizeDiceNotation(' 1 <= 2 >= 1 <> 3 != 4 < 5 > 0 = 1 ')
      .filter((token) => token.kind === 'comparison')
      .map((token) => token.lexeme))
      .toEqual(['<=', '>=', '<>', '=', '<', '>', '=']);
    expect(tokenizeDiceNotation('!=1')[0]?.kind).toBe('bang');
  });

  test('recognizes structural modifier words as complete identifiers', () => {
    expect(tokenizeDiceNotation('pool(+1)step(-2)advdis')
      .filter((token) => token.kind === 'identifier')
      .map((token) => token.lexeme))
      .toEqual(['pool', 'step', 'adv', 'dis']);
  });
});

describe('V3 notation parser', () => {
  test('enforces parser depth and node budgets before returning an AST', () => {
    expect(() => parseDiceNotation('1+2', { maxDepth: 10, maxNodes: 2 }))
      .toThrow(expect.objectContaining({ code: 'TOO_MANY_NODES' }));
    expect(() => parseDiceNotation('(((1)))', { maxDepth: 3, maxNodes: 100 }))
      .toThrow(expect.objectContaining({ code: 'AST_TOO_DEEP' }));
  });

  test('uses mathematical precedence and right-associative exponentiation', () => {
    const node = parseDiceNotation('1+2*3^2^2');
    expect(node).toMatchObject({
      kind: 'binary',
      operator: '+',
      right: {
        kind: 'binary',
        operator: '*',
        right: {
          kind: 'binary',
          operator: '^',
          right: { kind: 'binary', operator: '^' },
        },
      },
    });
    expect(parseDiceNotation('-2^2')).toMatchObject({
      kind: 'unary',
      operator: '-',
      operand: { kind: 'binary', operator: '^' },
    });
  });

  test('parses functions and parenthesized dice arguments', () => {
    const node = parseDiceNotation('max(abs(-2),(1+2)d(3+3))');
    expect(node).toMatchObject({
      kind: 'function',
      functionKind: 'binary',
      name: 'max',
      arguments: [
        { kind: 'function', functionKind: 'unary', name: 'abs' },
        {
          kind: 'dice',
          diceKind: 'standard',
          quantity: { kind: 'parenthesized' },
          sides: { kind: 'parenthesized' },
        },
      ],
    });
  });

  test('parses standard, percentile, and both Fudge variants', () => {
    expect(parseDice('2d20')).toMatchObject({ diceKind: 'standard' });
    expect(parseDice('d%')).toMatchObject({
      diceKind: 'percentile',
      quantity: { value: 1, implicit: true },
    });
    expect(parseDice('4dF.1')).toMatchObject({ diceKind: 'fudge', variant: 1 });
    expect(parseDice('4dF.2')).toMatchObject({ diceKind: 'fudge', variant: 2 });
    expect(parseDice('dF')).toMatchObject({
      diceKind: 'fudge', variant: 2, quantity: { implicit: true }, modifiers: [],
    });
  });

  test('parses all modifier defaults and signed compare points', () => {
    const node = parseDice('2d6!rukh1dl1min-1max+6cscfsa');
    expect(node.modifiers).toMatchObject([
      {
        kind: 'explode', compound: false, penetrate: false, maxExplosions: null, compare: null,
      },
      { kind: 'reroll', once: false, compare: null },
      { kind: 'unique', once: false, compare: null },
      { kind: 'keep', selection: 'highest', quantity: 1 },
      { kind: 'drop', selection: 'lowest', quantity: 1 },
      { kind: 'min', value: -1 },
      { kind: 'max', value: 6 },
      { kind: 'critical-success', compare: null },
      { kind: 'critical-failure', compare: null },
      { kind: 'sort', direction: 'ascending' },
    ]);
  });

  test('parses the complete modifier surface in source order', () => {
    const node = parseDice('8d10!!p>=10>=8f=1dl1kh2min1max10ro<2uo=3cs=10cf=1sd');
    expect(node.modifiers.map((modifier) => modifier.kind)).toEqual([
      'explode',
      'target',
      'drop',
      'keep',
      'min',
      'max',
      'reroll',
      'unique',
      'critical-success',
      'critical-failure',
      'sort',
    ]);
    expect(node.modifiers).toMatchObject([
      {
        compound: true,
        penetrate: true,
        maxExplosions: null,
        compare: { operator: '>=', value: 10 },
      },
      { success: { operator: '>=', value: 8 }, failure: { operator: '=', value: 1 } },
      { selection: 'lowest', quantity: 1 },
      { selection: 'highest', quantity: 2 },
      { value: 1 },
      { value: 10 },
      { once: true, compare: { operator: '<', value: 2 } },
      { once: true, compare: { operator: '=', value: 3 } },
      { compare: { operator: '=', value: 10 } },
      { compare: { operator: '=', value: 1 } },
      { direction: 'descending' },
    ]);
  });

  test.each([
    ['1d6!2', false, false, 2, null],
    ['1d6!!3', true, false, 3, null],
    ['1d6!p4', false, true, 4, null],
    ['1d6!!p5>=6', true, true, 5, { operator: '>=', value: 6 }],
    ['1d6!2!=5', false, false, 2, { operator: '!=', value: 5 }],
  ] as const)(
    'parses the explosion ceiling in %s',
    (input, compound, penetrate, maxExplosions, compare) => {
      expect(parseDice(input).modifiers[0]).toMatchObject({
        kind: 'explode',
        compound,
        penetrate,
        maxExplosions,
        compare,
      });
    },
  );

  test('parses structural pool adjustments and selections in source order', () => {
    const node = parseDice('2d20pool(+2)pool(-1)advdis');

    expect(node.modifiers).toMatchObject([
      { kind: 'pool-adjustment', delta: 2, span: { start: 4, end: 12 } },
      { kind: 'pool-adjustment', delta: -1, span: { start: 12, end: 20 } },
      { kind: 'pool-selection', selection: 'highest', span: { start: 20, end: 23 } },
      { kind: 'pool-selection', selection: 'lowest', span: { start: 23, end: 26 } },
    ]);
    expect(node).toMatchObject({ id: 'dice@0:26', span: { start: 0, end: 26 } });
  });

  test('parses signed dice steps in source order', () => {
    const node = parseDice('1d5step(+2)step(-1)');

    expect(node.modifiers).toMatchObject([
      { kind: 'dice-step', delta: 2, span: { start: 3, end: 11 } },
      { kind: 'dice-step', delta: -1, span: { start: 11, end: 19 } },
    ]);
    expect(node).toMatchObject({ id: 'dice@0:19', span: { start: 0, end: 19 } });
  });

  test('counts dice steps against the parser node budget', () => {
    expect(() => parseDiceNotation('1d5step(+1)', { maxDepth: 10, maxNodes: 3 }))
      .toThrow(expect.objectContaining({ code: 'TOO_MANY_NODES' }));
    expect(parseDiceNotation('1d5step(+1)', { maxDepth: 10, maxNodes: 4 }))
      .toMatchObject({ kind: 'dice' });
  });

  test.each([
    [
      '1d20+2pool(-1)',
      'binary@0:14',
      [{ kind: 'pool-adjustment', delta: -1, span: { start: 6, end: 14 } }],
    ],
    [
      '1d20+2adv',
      'binary@0:9',
      [{ kind: 'pool-selection', selection: 'highest', span: { start: 6, end: 9 } }],
    ],
    [
      '1d20+2pool(+2)advdis',
      'binary@0:20',
      [
        { kind: 'pool-adjustment', delta: 2, span: { start: 6, end: 14 } },
        { kind: 'pool-selection', selection: 'highest', span: { start: 14, end: 17 } },
        { kind: 'pool-selection', selection: 'lowest', span: { start: 17, end: 20 } },
      ],
    ],
  ])('attaches expression postfixes to the unique die in %s', (input, rootId, modifiers) => {
    expect(parseDiceNotation(input)).toMatchObject({
      kind: 'binary',
      id: rootId,
      span: { start: 0, end: input.length },
      left: {
        kind: 'dice',
        id: 'dice@0:4',
        span: { start: 0, end: 4 },
        modifiers,
      },
    });
  });

  test('finds a unique dice node recursively and only extends the root span', () => {
    expect(parseDiceNotation('(1d20+2)adv')).toMatchObject({
      kind: 'parenthesized',
      id: 'parenthesized@0:11',
      span: { start: 0, end: 11 },
      expression: {
        kind: 'binary',
        id: 'binary@1:7',
        span: { start: 1, end: 7 },
        left: {
          kind: 'dice',
          id: 'dice@1:5',
          span: { start: 1, end: 5 },
          modifiers: [{ kind: 'pool-selection', selection: 'highest' }],
        },
      },
    });
  });

  test('attaches a terminal dice step to the unique die in an expression', () => {
    expect(parseDiceNotation('1d5+2step(+1)')).toMatchObject({
      kind: 'binary',
      id: 'binary@0:13',
      span: { start: 0, end: 13 },
      left: {
        kind: 'dice',
        id: 'dice@0:3',
        span: { start: 0, end: 3 },
        modifiers: [{ kind: 'dice-step', delta: 1, span: { start: 5, end: 13 } }],
      },
    });
  });

  test.each([
    '1+2adv',
    '1d20+1d6+2adv',
    'max(1d20,1d6)+2pool(-1)',
    '1d5+1d6+2step(+1)',
  ])('rejects an ambiguous expression postfix target in %s', (input) => {
    expect(() => parseDiceNotation(input)).toThrow(expect.objectContaining({
      code: 'INVALID_NOTATION',
    }));
  });

  test('preserves immediate structural modifier binding inside arithmetic', () => {
    expect(parseDiceNotation('1d20adv+2')).toMatchObject({
      kind: 'binary',
      left: {
        kind: 'dice',
        id: 'dice@0:7',
        modifiers: [{ kind: 'pool-selection', selection: 'highest' }],
      },
      right: { kind: 'number' },
    });
  });

  test.each([
    ['1d6!+1', '+'],
    ['1d6!-1', '-'],
  ] as const)('preserves arithmetic after an uncapped explosion in %s', (input, operator) => {
    expect(parseDiceNotation(input)).toMatchObject({
      kind: 'binary',
      operator,
      left: {
        kind: 'dice',
        modifiers: [{ kind: 'explode', maxExplosions: null }],
      },
      right: { kind: 'number', value: 1 },
    });
  });

  test('preserves legacy explode and contextual not-equal syntax', () => {
    expect(parseDice('1d6!=1').modifiers[0]).toMatchObject({
      kind: 'explode',
      maxExplosions: null,
      compare: { operator: '=', value: 1 },
    });
    expect(parseDice('1d6r!=1').modifiers[0]).toMatchObject({
      kind: 'reroll',
      compare: { operator: '!=', value: 1 },
    });
  });

  test('parses roll groups and group modifiers', () => {
    const node = parseGroup('{1d6,2d8+3}kh1');
    expect(node.expressions).toHaveLength(2);
    expect(node.modifiers).toMatchObject([
      { kind: 'keep', selection: 'highest', quantity: 1 },
    ]);
  });

  test('assigns deterministic IDs and exact spans', () => {
    const first = parseDiceNotation('2d6+3');
    const second = parseDiceNotation('2d6+3');
    expect(first).toEqual(second);
    expect(first).toMatchObject({ id: 'binary@0:5', span: { start: 0, end: 5 } });
  });

  test.each([
    '', '0d6', '01d6', '1d0', '1d01', 'dF.3', 'dF.01', '{}', 'foo(1)', '1d6kh0', '1d6kh01',
    '(1+2', '1+2)', '{1d6,}', '{,1d6}', 'abs(1,2)', 'max(1)', '1d6xyz', '1d6sfoo',
    '1d6>=', '.', '1..2', '1d6min', '1d6max', '1d6d', '1d6!0', '1d6!01', '1d6!1.0', '1d6!1.5',
    '1d6!9007199254740992', '1d6!2p', '1d6pool(1)', '1d6pool(+0)', '1d6pool(-0)',
    '1d6pool(+01)', '1d6pool(+1.5)', '1d6pool(+9007199254740992)', '1d6pool(+)',
    '1d6step(1)', '1d6step(+0)', '1d6step(-0)', '1d6step(+01)', '1d6step(+1.5)',
    '1d6step(+9007199254740992)', '1d6step(+)',
  ])('rejects invalid notation %j', (input) => {
    try {
      parseDiceNotation(input);
      throw new Error('Expected notation to be rejected');
    } catch (error: unknown) {
      expect(isDiceRollError(error)).toBe(true);
      if (isDiceRollError(error)) {
        expect(error.code).toBe('INVALID_NOTATION');
        expect(error.span).not.toBeNull();
      }
    }
  });
});
