import { afterEach, describe, expect, test } from 'vitest';
import { compileRpgDice, rollRpgDice, rollRpgDiceSummary } from './engine.js';
import {
  freezeDiceRollResult,
  freezeDiceRollSummary,
  freezeRollPlan,
  shouldFreezeResults,
} from './freeze.js';

const originalNodeEnvironment = process.env['NODE_ENV'];

afterEach(() => {
  if (originalNodeEnvironment === undefined) {
    delete process.env['NODE_ENV'];
  } else {
    process.env['NODE_ENV'] = originalNodeEnvironment;
  }
});

describe('V3 runtime freezing', () => {
  test('freezes every nested full-result entity exactly once', () => {
    const pooled = freezeDiceRollResult(rollRpgDice('2d6>=4', { seed: 'freeze-pool' }));
    expect(Object.isFrozen(pooled)).toBe(true);
    expect(Object.isFrozen(pooled.rolls[0]?.pool)).toBe(true);
    expect(Object.isFrozen(pooled.dice[0]?.states)).toBe(true);
    expect(Object.isFrozen(pooled.groups[0]?.span)).toBe(true);

    const sorted = freezeDiceRollResult(rollRpgDice('{1d6,1d8}sd', { seed: 'freeze-sort' }));
    const groupTransform = sorted.events.find(
      (event) => event.type === 'transform' && event.subject === 'group',
    );
    expect(groupTransform?.subject).toBe('group');
    if (groupTransform?.subject === 'group') {
      expect(Object.isFrozen(groupTransform.from)).toBe(true);
      expect(Object.isFrozen(groupTransform.to)).toBe(true);
    }
  });

  test('freezes summaries and public plans deeply', () => {
    const summary = freezeDiceRollSummary(rollRpgDiceSummary('2d6>=4', { seed: 'freeze-summary' }));
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.rolls)).toBe(true);
    expect(Object.isFrozen(summary.rolls[0])).toBe(true);
    expect(Object.isFrozen(summary.rolls[0]?.pool)).toBe(true);

    const plan = freezeRollPlan(compileRpgDice('1d6+2'));
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.groups[0]?.span)).toBe(true);
    expect(Object.isFrozen(plan.groups[0]?.childIds)).toBe(true);
  });

  test('enables development freezing only for an explicit development environment', () => {
    expect(shouldFreezeResults('always')).toBe(true);
    expect(shouldFreezeResults('never')).toBe(false);
    process.env['NODE_ENV'] = 'production';
    expect(shouldFreezeResults('development')).toBe(false);
    process.env['NODE_ENV'] = 'development';
    expect(shouldFreezeResults('development')).toBe(true);
  });
});
