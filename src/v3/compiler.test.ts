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

  test('uses the explosion ceiling per root in static cost estimates', () => {
    const plan = compileDicePlan('2#2d1!2', DEFAULT_DICE_LIMITS);

    expect(plan.cost).toEqual({
      staticDice: 2,
      worstCaseGeneratedDice: 4,
      worstCaseRandomCalls: 6,
      totalStaticDice: 4,
      totalWorstCaseGeneratedDice: 8,
      totalWorstCaseRandomCalls: 12,
    });
  });

  test('includes active explosion children in later random-modifier costs', () => {
    expect(compileDicePlan('1d1!2ro=1', DEFAULT_DICE_LIMITS).cost)
      .toMatchObject({ worstCaseGeneratedDice: 2, worstCaseRandomCalls: 6 });
    expect(compileDicePlan('1d1!2uo', DEFAULT_DICE_LIMITS).cost)
      .toMatchObject({ worstCaseGeneratedDice: 2, worstCaseRandomCalls: 5 });
    expect(compileDicePlan('1d1!!2ro>0', DEFAULT_DICE_LIMITS).cost)
      .toMatchObject({ worstCaseGeneratedDice: 2, worstCaseRandomCalls: 4 });
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

  test.each([
    ['2d8-pool(1)', '2d8pool(-1)', 1, null, null],
    ['1d20-pool(1)', '1d20pool(-1)', 2, 'lowest', 1],
    ['1d20-pool(2)', '1d20pool(-2)', 3, 'lowest', 1],
    ['1d20-pool(3)', '1d20pool(-3)', 4, 'lowest', 1],
    ['1d20+2-pool(1)', '1d20+2pool(-1)', 2, 'lowest', 1],
    ['2d8+pool(2)', '2d8pool(+2)', 4, null, null],
    ['2d8adv', '2d8adv', 3, 'highest', 2],
    ['2d8dis', '2d8dis', 3, 'lowest', 2],
    ['1d20advadv', '1d20advadv', 3, 'highest', 1],
    ['1d20disdis', '1d20disdis', 3, 'lowest', 1],
    ['1d20advdis', '1d20advdis', 1, null, null],
    ['1d20pool(-1)adv', '1d20pool(-1)adv', 1, null, null],
    ['1d20pool(-2)adv', '1d20pool(-2)adv', 2, 'lowest', 1],
    ['1d20pool(-2)advadv', '1d20pool(-2)advadv', 1, null, null],
    ['1d20pool(-2)dis', '1d20pool(-2)dis', 4, 'lowest', 1],
  ] as const)(
    'resolves structural pool conditions for %s before compiling runtime modifiers',
    (input, normalizedNotation, quantity, selection, keptQuantity) => {
      const plan = compileDicePlan(input, DEFAULT_DICE_LIMITS);
      const spec = [...getPlanProgram(plan).diceSpecs.values()][0];
      const keep = spec?.modifiers.find((modifier) => modifier.kind === 'keep');

      expect(plan).toMatchObject({
        notation: normalizedNotation,
        normalizedNotation,
        cost: {
          staticDice: quantity,
          worstCaseGeneratedDice: 0,
          worstCaseRandomCalls: quantity,
          totalStaticDice: quantity,
          totalWorstCaseGeneratedDice: 0,
          totalWorstCaseRandomCalls: quantity,
        },
      });
      expect(spec?.quantity).toBe(quantity);
      if (selection === null) {
        expect(keep).toBeUndefined();
      } else {
        expect(keep).toMatchObject({ selection, quantity: keptQuantity });
      }
    },
  );

  test('charges transformed pool dice against multi-roll initial-dice limits', () => {
    const plan = compileDicePlan('2#1d20-pool(3)', DEFAULT_DICE_LIMITS);

    expect(plan.cost).toEqual({
      staticDice: 4,
      worstCaseGeneratedDice: 0,
      worstCaseRandomCalls: 4,
      totalStaticDice: 8,
      totalWorstCaseGeneratedDice: 0,
      totalWorstCaseRandomCalls: 8,
    });
    expect(() => compileDicePlan(
      '2#1d20-pool(3)',
      createDiceLimits({ maxInitialDice: 8 }),
    )).not.toThrow();
    expect(() => compileDicePlan(
      '2#1d20-pool(3)',
      createDiceLimits({ maxInitialDice: 7 }),
    )).toThrow(expect.objectContaining({ code: 'TOO_MANY_INITIAL_DICE' }));
  });

  test.each([
    ['1d5step(+1)', 6],
    ['1d5step(+2)', 8],
    ['1d5step(-1)', 4],
    ['1d6step(+1)', 8],
    ['1d6step(-1)', 4],
    ['1d7step(+1)', 8],
    ['1d7step(-1)', 6],
    ['1d5step(+2)step(-1)', 6],
    ['1d5step(+1)step(-1)', 5],
    ['1d5+2step(+1)', 6],
  ] as const)('resolves aggregated dice steps in %s to d%s', (input, sides) => {
    const plan = compileDicePlan(input, DEFAULT_DICE_LIMITS);
    const program = getPlanProgram(plan);
    const spec = [...program.diceSpecs.values()][0];

    expect(spec).toMatchObject({
      quantity: 1,
      sides,
      minimum: 1,
      maximum: sides,
      possibleFaces: sides,
      modifiers: [],
    });
    expect(program.maximumSides).toBe(sides);
    expect(plan.cost).toMatchObject({
      staticDice: 1,
      worstCaseGeneratedDice: 0,
      worstCaseRandomCalls: 1,
      totalStaticDice: 1,
      totalWorstCaseGeneratedDice: 0,
      totalWorstCaseRandomCalls: 1,
    });
  });

  test('applies dice steps before side limits and runtime modifier analysis', () => {
    const steppedDown = compileDicePlan(
      '1d1000step(-1)',
      createDiceLimits({ maxSides: 100 }),
    );
    const spec = [...getPlanProgram(steppedDown).diceSpecs.values()][0];

    expect(spec?.sides).toBe(100);
    expect(() => compileDicePlan(
      '1d20step(+1)',
      createDiceLimits({ maxSides: 20 }),
    )).toThrow(expect.objectContaining({ code: 'DICE_SIDES_LIMIT_EXCEEDED' }));
    expect(() => compileDicePlan('6d5u', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'IMPOSSIBLE_UNIQUE' }));
    expect(() => compileDicePlan('6d5step(+1)u', DEFAULT_DICE_LIMITS)).not.toThrow();
  });

  test.each([
    ['1d100step(+1)', 'dice-step-out-of-range'],
    ['1d2step(-1)', 'dice-step-out-of-range'],
    ['1d5step(+7)', 'dice-step-out-of-range'],
    ['1d%step(+1)', 'dice-step-non-standard-die'],
    ['1dFstep(-1)', 'dice-step-non-standard-die'],
  ] as const)('rejects unsupported dice step %s with a stable reason', (input, reason) => {
    let error: unknown;
    try {
      compileDicePlan(input, DEFAULT_DICE_LIMITS);
    } catch (caught: unknown) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: 'UNSUPPORTED_NOTATION',
      details: { reason },
    });
  });

  test.each([
    '1d%step(+1)step(-1)',
    '1dFstep(-2)step(+2)',
  ])('allows a canceled dice-step balance on non-standard die %s', (input) => {
    expect(() => compileDicePlan(input, DEFAULT_DICE_LIMITS)).not.toThrow();
  });

  test('rejects keep or drop only while the structural selection balance is non-zero', () => {
    for (const notation of [
      '1d20advkh1',
      '1d20disdl1',
      '1d20pool(-2)kh1',
      '1d20pool(-2)advkh1',
      '2d8pool(-3)dh1',
    ]) {
      let error: unknown;
      try {
        compileDicePlan(notation, DEFAULT_DICE_LIMITS);
      } catch (caught: unknown) {
        error = caught;
      }
      expect(error).toMatchObject({
        code: 'UNSUPPORTED_NOTATION',
        details: { reason: 'conflicting-selection' },
      });
    }

    for (const notation of [
      '1d20advdiskh1',
      '1d20pool(-1)advkh1',
      '1d20pool(-2)advadvkh1',
      '2d8pool(-1)dl1',
    ]) {
      expect(() => compileDicePlan(notation, DEFAULT_DICE_LIMITS)).not.toThrow();
    }
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

  test('allows otherwise non-terminating explosions only with an explicit ceiling', () => {
    expect(() => compileDicePlan('1d1!', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'NON_TERMINATING_MODIFIER' }));
    expect(() => compileDicePlan('1d6!>=1', DEFAULT_DICE_LIMITS))
      .toThrow(expect.objectContaining({ code: 'NON_TERMINATING_MODIFIER' }));

    expect(() => compileDicePlan('1d1!2', DEFAULT_DICE_LIMITS)).not.toThrow();
    expect(() => compileDicePlan('1d6!2>=1', DEFAULT_DICE_LIMITS)).not.toThrow();
  });

  test('validates reroll and unique against the post-explosion dice domain', () => {
    for (const notation of [
      '1d1!1u',
      '1d2!2>=1u',
      '3d1!!1u',
      '3d2!pu',
      '4d2min1.5u',
      '3d2!p1u',
      '4d6min1.5!1>=1u',
      '5d2min2!!1u',
      '6d2min2!!2u',
      '3d1min2!!1=2u',
      '1d6min1.5max5.5!7>=1u',
      '1d257!257>=1u',
      '1d257!p258>=1u',
      '258d257!!1<0u',
    ]) {
      expect(() => compileDicePlan(notation, DEFAULT_DICE_LIMITS))
        .toThrow(expect.objectContaining({ code: 'IMPOSSIBLE_UNIQUE' }));
    }

    for (const notation of [
      '1d1!p1u',
      '1d1!!1r=1',
      '2d1!!1u',
      '1d6min6!!1r<=6',
      '1d2min2!!2r<=2',
      '1d1min2!p1=2r',
      '1d1min2!1=1r=1',
      '2d1min2!!1=1u',
      '1d4097!1<0u',
      '1d2min2!!4096u',
    ]) {
      expect(() => compileDicePlan(notation, DEFAULT_DICE_LIMITS)).not.toThrow();
    }
  });

  test('keeps reroll nontermination proofs across capped-analysis fallbacks', () => {
    for (const notation of [
      '1d257!!1<0r>=1',
      '1d6!!65<0r>=1',
      '1d47!!2>=1r>=1',
      '1d257min1!1<0r>=1',
      '1d257min2.5!1<0r!=2.5',
    ]) {
      expect(() => compileDicePlan(notation, DEFAULT_DICE_LIMITS))
        .toThrow(expect.objectContaining({ code: 'NON_TERMINATING_MODIFIER' }));
    }
  });

  test('fails closed when a capped modifier interaction exceeds semantic analysis limits', () => {
    for (const notation of [
      '1d2049min2049!!2r!=4098',
      '4098d1366min1366!!2u',
    ]) {
      expect(() => compileDicePlan(notation, DEFAULT_DICE_LIMITS)).toThrow(expect.objectContaining({
        code: 'UNSUPPORTED_NOTATION',
      }));
    }
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
