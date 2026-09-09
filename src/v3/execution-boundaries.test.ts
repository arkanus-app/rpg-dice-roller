import { describe, expect, test } from 'vitest';
import { createDiceEngine } from './engine.js';
import { compileDicePlan, getPlanProgram } from './compiler.js';
import { executeRollPlan, executeRollPlanSummary } from './executor.js';
import { createDiceLimits } from './runtime/limits.js';
import { normalizeRpgDiceNotation } from './normalization.js';
import { parseDiceNotation } from './syntax/parser.js';
import { tokenizeDiceNotation } from './syntax/scanner.js';
import { isDiceRollError } from './errors.js';

describe('expression and modifier boundary regressions', () => {
  test.each(['(+d6)', '(-d6)', 'abs(d6)', 'd6**2', '{d6,d8}',
    '{d6,1}sa', '{d6,1}sd', '{1,d6}kh1', '{d6,1}dl1',
    '(+d6kh1)', '(-d6kh1)', 'abs(d6kh1)', 'd6>=+3', 'd6>=-3',
    '4d1kh1dh4', '{{d1,d1}kh1,d1}dl2', '{d1,d1}kh1dh2', '2d1uo>1',
    'd6cs', 'd6cf', 'd6cs>=3', 'd6cf<=3',
  ])('preserves result and counters in all modes for %s', (notation) => {
    const engine = createDiceEngine();
    const full = engine.roll(notation, { seed: 'boundary' });
    const summary = engine.rollSummary(notation, { seed: 'boundary' });
    const details = engine.rollDetails(notation, { seed: 'boundary' });
    expect(summary.total).toBe(full.total);
    expect(summary.stats).toEqual(full.stats);
    expect(details.total).toBe(full.total);
    expect(details.dice).toEqual(full.dice);
  });

  test.each([['4d6 k', '4d6k1'], ['4d6 k2', '4d6k2'], ['4d6 km', '4d6kl1'], ['4d6 km2', '4d6kl2']])('normalizes %s', (input, expected) => {
    expect(normalizeRpgDiceNotation(input)).toBe(expected);
  });

  test('rejects non-finite numeric tokens and excessive tree depth', () => {
    expect(() => tokenizeDiceNotation('9'.repeat(400))).toThrow(expect.objectContaining({ code: 'INVALID_NOTATION' }));
    expect(() => parseDiceNotation('1+2+3+4', { maxDepth: 3, maxNodes: 100 })).toThrow(expect.objectContaining({ code: 'AST_TOO_DEEP' }));
  });

  test('handles every truncated prefix without reading beyond the EOF sentinel', () => {
    for (const notation of ['2d6!!p2>=3', 'dF.1ro!=0', 'max(d6,d8)', '{d6,d8}kh1',
      'd6pool(-2)adv', 'd6step(+1)', 'd6>=+3f<=-1', 'd6uo!=1', 'd6cs>=2cf<=1']) {
      for (let end = 0; end <= notation.length; end += 1) {
        const input = notation.slice(0, end);
        try {
          const ast = parseDiceNotation(input);
          expect(ast.span.end).toBeLessThanOrEqual(input.length);
        } catch (error: unknown) {
          expect(isDiceRollError(error)).toBe(true);
          if (isDiceRollError(error)) {
            expect(error.code).toBe('INVALID_NOTATION');
            expect(error.span?.end).toBeLessThanOrEqual(input.length);
          }
        }
      }
    }
  });

  test.each(['(d6)d6', 'd(d6)', '9007199254740991d6pool(+1)', '1d6pool(-9007199254740991)', 'd6step(+9007199254740991)step(+1)'])('rejects nonconstant or overflowing dice arguments in %s', (notation) => {
    expect(() => compileDicePlan(notation, createDiceLimits())).toThrow();
  });

  test('rejects corrupted internal dice specifications in both execution paths', () => {
    for (const execute of [executeRollPlan, executeRollPlanSummary]) {
      const plan = compileDicePlan('d6', createDiceLimits());
      const program = getPlanProgram(plan);
      (program.diceSpecs as Map<string, unknown>).clear();
      expect(() => execute(plan, { seed: 'boundary', limits: createDiceLimits() })).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_NOTATION', message: 'Compiled dice specification is missing' }));
    }
  });

  test('rejects a missing internal group pipeline', () => {
    const plan = compileDicePlan('{d6,d8}kh1', createDiceLimits());
    (getPlanProgram(plan).groupModifiers as Map<string, unknown>).clear();
    expect(() => executeRollPlan(plan, { seed: 'boundary', limits: createDiceLimits() })).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_NOTATION' }));
  });

  test('direct execution defaults to automatic MT19937 seeding', () => {
    const limits = createDiceLimits();
    expect(executeRollPlan(compileDicePlan('d6', limits), { limits }).replay).toMatchObject({ algorithm: 'mt19937', origin: 'crypto' });
  });
});
