import { afterEach, describe, expect, test, vi } from 'vitest';
import * as parser from './syntax/parser.js';
import * as normalization from './normalization.js';
import { compileDicePlan, getPlanProgram, inspectDicePlan } from './compiler.js';
import { createDiceEngine } from './engine.js';
import { executeRollPlan } from './executor.js';
import { createDiceLimits } from './runtime/limits.js';
import type { RuntimeModifierNode } from './syntax/ast.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('compiler dependency failures', () => {
  test.each([new Error('parser failed'), 'non-error failure'])('normalizes unexpected parser failures: %s', (failure) => {
    vi.spyOn(parser, 'parseDiceNotation').mockImplementation(() => { throw failure as Error; });
    expect(() => compileDicePlan('d6', createDiceLimits())).toThrow(expect.objectContaining({
      code: 'INVALID_NOTATION', input: 'd6', details: { cause: failure instanceof Error ? failure.message : 'Unknown parser error' },
    }));
  });

  test('still produces an inspection if normalization fails', () => {
    vi.spyOn(normalization, 'parseNormalizedDiceInput').mockImplementation(() => { throw new Error('normalizer failed'); });
    expect(inspectDicePlan('d6', createDiceLimits())).toMatchObject({ isValid: false, input: 'd6', notation: '', plan: null, error: { code: 'INVALID_NOTATION' } });
  });

  test.each([new Error('compiler failed'), 'non-error failure'])('contains unexpected engine compiler failures: %s', (failure) => {
    const engine = createDiceEngine();
    vi.spyOn(engine, 'compile').mockImplementation(() => { throw failure as Error; });
    expect(engine.inspect('d6')).toMatchObject({ isValid: false, error: {
      code: 'INVALID_NOTATION', details: { cause: failure instanceof Error ? failure.message : 'Unknown compiler error' },
    } });
  });

  test.each(['min2', 'max2', '>=2', 'cs', 'cf', '!1', 'ro', 'uo'])('rejects an unsupported internal group pipeline: %s', (suffix) => {
    const limits = createDiceLimits();
    const source = getPlanProgram(compileDicePlan(`d6${suffix}`, limits));
    const modifiers = [...source.diceSpecs.values()][0]?.modifiers;
    expect(modifiers).toHaveLength(1);
    const plan = compileDicePlan('{d6,d8}', limits);
    const program = getPlanProgram(plan);
    (program.groupModifiers as Map<string, readonly RuntimeModifierNode[]>).set(program.ast.id, modifiers as readonly RuntimeModifierNode[]);
    expect(() => executeRollPlan(plan, { limits, seed: 'contract' })).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_GROUP_MODIFIER' }));
  });
});
