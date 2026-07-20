import { describe, expect, test } from 'vitest';
import {
  compileDicePlan,
  getPlanAst,
  getPlanProgram,
  inspectDicePlan,
} from './compiler.js';
import { DEFAULT_DICE_LIMITS, createDiceLimits } from './runtime/limits.js';

describe('V3 compiler', () => {
  test('compiles one AST into a deterministic immutable roll plan', () => {
    const plan = compileDicePlan('2#2d6!+1d8ro<2 [ataque]', DEFAULT_DICE_LIMITS);

    expect(plan).toMatchObject({
      type: 'roll-plan',
      schemaVersion: 3,
      compilerVersion: 1,
      notation: '2d6!+1d8ro<2',
      normalizedNotation: '2#2d6!+1d8ro<2',
      comment: 'ataque',
      isMultiRoll: true,
      rollCount: 2,
      cost: {
        staticDice: 3,
        worstCaseGeneratedDice: 200_000,
        worstCaseRandomCalls: 200_004,
        totalStaticDice: 6,
        totalWorstCaseGeneratedDice: 400_000,
        totalWorstCaseRandomCalls: 400_008,
      },
    });
    expect(plan.groups.map((group) => group.kind)).toEqual(['expression', 'dice', 'dice']);
    expect(getPlanAst(plan).kind).toBe('binary');
    expect(plan.planFingerprint).toMatch(/^[0-9a-f]{32}$/u);
    expect(Object.isFrozen(plan)).toBe(true);
  });

  test.each(['3-1#1d6', '(3-1)#1d6', '{3-1}#1d6', '[3-1]#1d6'])(
    'compiles computed multi-roll count %s',
    (input) => {
      expect(compileDicePlan(input, DEFAULT_DICE_LIMITS)).toMatchObject({
        notation: '1d6',
        normalizedNotation: '2#1d6',
        isMultiRoll: true,
        rollCount: 2,
        cost: { staticDice: 1, totalStaticDice: 2 },
      });
    },
  );

  test('validates roll, AST, and initial-dice limits', () => {
    expect(() => compileDicePlan('0#1d6', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'INVALID_NOTATION' }));
    expect(() => compileDicePlan('2#1d6', createDiceLimits({ maxRolls: 1 })))
      .toThrow(expect.objectContaining({ code: 'TOO_MANY_ROLLS' }));
    expect(() => compileDicePlan('2d6', createDiceLimits({ maxInitialDice: 1 })))
      .toThrow(expect.objectContaining({ code: 'TOO_MANY_INITIAL_DICE' }));
    expect(() => compileDicePlan('(((1)))', createDiceLimits({ maxAstDepth: 2 })))
      .toThrow(expect.objectContaining({ code: 'AST_TOO_DEEP' }));
  });

  test('validates constant dice arguments', () => {
    expect(() => compileDicePlan('1d(2-2)', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'INVALID_NOTATION' }));
    expect(() => compileDicePlan('(1-1)d6', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'INVALID_NOTATION' }));
  });

  test('returns structured inspection failures without throwing', () => {
    const inspection = inspectDicePlan('not-dice', DEFAULT_DICE_LIMITS);

    expect(inspection).toMatchObject({
      type: 'dice-notation-inspection',
      isValid: false,
      plan: null,
      groups: [],
      cost: null,
      error: { code: 'INVALID_NOTATION', input: 'not-dice' },
    });
  });

  test('rejects AST access for structurally cloned plans', () => {
    const plan = compileDicePlan('1d6', DEFAULT_DICE_LIMITS);
    const clone = { ...plan };

    expect(() => getPlanAst(clone))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_NOTATION' }));
  });

  test.each([
    ['abs(-2)', 2],
    ['ceil(1.2)', 2],
    ['cos(0)', 1],
    ['exp(0)', 1],
    ['floor(1.8)', 1],
    ['log(exp(1))', 1],
    ['round(1.6)', 2],
    ['sign(2)', 1],
    ['sqrt(4)', 2],
    ['max(1,2)', 2],
    ['min(2,3)', 2],
    ['pow(2,2)', 4],
  ])('evaluates constant function %s in dice quantities', (expression, quantity) => {
    expect(compileDicePlan(`(${expression})d6`, DEFAULT_DICE_LIMITS).cost.staticDice)
      .toBe(quantity);
  });

  test.each([
    ['8/2', 4], ['5%2', 1], ['2*2', 4], ['3-1', 2], ['1+2', 3], ['2^2', 4],
    ['2**2', 4], ['+2', 2],
  ])('evaluates constant operator %s in dice quantities', (expression, quantity) => {
    expect(compileDicePlan(`(${expression})d6`, DEFAULT_DICE_LIMITS).cost.staticDice)
      .toBe(quantity);
  });

  test('rejects zero and non-finite constant function results', () => {
    expect(() => compileDicePlan('(sin(0))d6', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'INVALID_NOTATION' }));
    expect(() => compileDicePlan('(tan(0))d6', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'INVALID_NOTATION' }));
    expect(() => compileDicePlan('(sqrt(-1))d6', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'NON_FINITE_RESULT' }));
    expect(() => compileDicePlan('1d(1/0)', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'NON_FINITE_RESULT' }));
  });

  test('validates input length, node count, and unsafe multi-roll counts', () => {
    expect(() => compileDicePlan('1d6', createDiceLimits({ maxInputLength: 2 })))
      .toThrow(expect.objectContaining({ code: 'INPUT_TOO_LONG' }));
    expect(() => compileDicePlan('1+2', createDiceLimits({ maxAstNodes: 2 })))
      .toThrow(expect.objectContaining({ code: 'TOO_MANY_NODES' }));
    expect(() => compileDicePlan('999999999999999999999#1d6', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'INVALID_NOTATION' }));
  });

  test('precompiles constant dice specs and ordered modifier pipelines', () => {
    const plan = compileDicePlan('(1+1)d(2*3)sdmin2min3', DEFAULT_DICE_LIMITS);
    const program = getPlanProgram(plan);
    const spec = [...program.diceSpecs.values()][0];

    expect(spec).toMatchObject({ quantity: 2, sides: 6, minimum: 1, maximum: 6 });
    expect(spec?.modifiers.map((modifier) => modifier.kind)).toEqual(['min', 'sort']);
    const minimum = spec?.modifiers[0];
    expect(minimum?.kind).toBe('min');
    expect(minimum?.kind === 'min' ? minimum.value : null).toBe(3);
    expect(program.postOrder.at(-1)).toBe(program.ast);
  });

  test('rejects oversized dice, non-terminating modifiers, and impossible unique at compile time', () => {
    expect(() => compileDicePlan('1d7', createDiceLimits({ maxSides: 6 })))
      .toThrow(expect.objectContaining({ code: 'DICE_SIDES_LIMIT_EXCEEDED' }));
    expect(() => compileDicePlan('1d1!', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'NON_TERMINATING_MODIFIER' }));
    expect(() => compileDicePlan('1d1r', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'NON_TERMINATING_MODIFIER' }));
    expect(() => compileDicePlan('7d6u', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'IMPOSSIBLE_UNIQUE' }));
  });

  test('proves terminating and non-terminating comparisons for every operator', () => {
    for (const notation of [
      '1d1r=1',
      '1d6r!=7',
      '1d6r<>7',
      '1d6r<7',
      '1d6r<=6',
      '1d6r>0',
      '1d6r>=1',
    ]) {
      expect(() => compileDicePlan(notation, DEFAULT_DICE_LIMITS))
        .toThrow(expect.objectContaining({ code: 'NON_TERMINATING_MODIFIER' }));
    }
    for (const notation of [
      '1d6r=1',
      '1d6r!=1',
      '1d6r<>1',
      '1d6r<6',
      '1d6r<=5',
      '1d6r>1',
      '1d6r>=2',
    ]) {
      expect(() => compileDicePlan(notation, DEFAULT_DICE_LIMITS)).not.toThrow();
    }
  });

  test('accepts only keep, drop, and sort on groups', () => {
    for (const notation of ['{1,2}min1', '{1,2}>=1', '{1,2}cs=1', '{1,2}!']) {
      expect(() => compileDicePlan(notation, DEFAULT_DICE_LIMITS))
        .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_GROUP_MODIFIER' }));
    }
    expect(() => compileDicePlan('{1,2}kh1sd', DEFAULT_DICE_LIMITS)).not.toThrow();
  });

  test('applies AST depth and node limits from inside the parser', () => {
    expect(() => compileDicePlan('1+2+3', createDiceLimits({ maxAstNodes: 4 })))
      .toThrow(expect.objectContaining({ code: 'TOO_MANY_NODES' }));
    expect(() => compileDicePlan('(((1)))', createDiceLimits({ maxAstDepth: 3 })))
      .toThrow(expect.objectContaining({ code: 'AST_TOO_DEEP' }));
  });
});
