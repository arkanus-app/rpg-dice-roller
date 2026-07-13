import { describe, expect, test } from 'vitest';
import {
  compileRpgDice,
  createDiceEngine,
  rollRpgDice,
  rollRpgDiceSummary,
} from './engine.js';
import type { DiceEvent, DiceState, GroupState } from './types.js';

interface ReducedDie {
  readonly id: string;
  readonly parentDieId: string | null;
  readonly rawValue: number;
  value: number;
  contribution: number;
  included: boolean;
  readonly states: Set<DiceState>;
}

interface ReducedGroup {
  value: number | null;
  contribution: number;
  included: boolean;
  readonly states: Set<GroupState>;
}

function reduceEvents(events: readonly DiceEvent[]): {
  readonly dice: ReadonlyMap<string, ReducedDie>;
  readonly groups: ReadonlyMap<string, ReducedGroup>;
} {
  const dice = new Map<string, ReducedDie>();
  const groups = new Map<string, ReducedGroup>();
  const group = (id: string): ReducedGroup => {
    const existing = groups.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const created: ReducedGroup = {
      value: null,
      contribution: 0,
      included: true,
      states: new Set(),
    };
    groups.set(id, created);
    return created;
  };

  for (const event of events) {
    if (event.subject === 'group') {
      const current = group(event.groupId);
      if (event.type === 'include') {
        current.value = event.value;
        current.contribution = event.contribution;
        current.included = true;
      } else if (event.type === 'exclude') {
        current.value = event.value;
        current.contribution = 0;
        current.included = false;
        current.states.add('dropped');
      } else if (event.type === 'transform') {
        current.states.add(event.reason === 'sort-ascending'
          ? 'sorted-ascending'
          : 'sorted-descending');
      }
      continue;
    }

    if (event.type === 'roll') {
      dice.set(event.dieId, {
        id: event.dieId,
        parentDieId: event.parentDieId,
        rawValue: event.value,
        value: event.value,
        contribution: event.value,
        included: true,
        states: new Set(),
      });
      continue;
    }
    const current = dice.get(event.dieId);
    if (current === undefined) {
      throw new Error(`Event references unknown die ${event.dieId}`);
    }
    switch (event.type) {
      case 'reroll':
        current.value = event.to;
        current.states.add(event.reason === 'unique' || event.reason === 'unique-once'
          ? 'unique-rerolled'
          : 'rerolled');
        break;
      case 'explode':
        current.states.add('exploded');
        if (event.reason === 'penetrate') {
          current.states.add('penetrated');
        }
        break;
      case 'transform':
        current.value = event.to;
        current.states.add(event.reason === 'penetrate'
          ? 'penetrated'
          : event.reason);
        break;
      case 'exclude':
        current.included = false;
        current.contribution = 0;
        if (event.reason === 'drop' || event.reason === 'keep') {
          current.states.add('dropped');
        }
        break;
      case 'classify':
        current.states.add(event.outcome === 'success'
          ? 'target-success'
          : event.outcome === 'failure'
            ? 'target-failure'
            : event.outcome === 'neutral' ? 'target-neutral' : event.outcome);
        break;
      case 'include':
        current.included = true;
        current.contribution = event.contribution;
        break;
    }
  }
  return { dice, groups };
}

describe('V3 optimized execution contract', () => {
  test('partitions root entities into contiguous per-roll ranges', () => {
    const result = rollRpgDice('3#2d6+1', { seed: 'ranges' });
    for (const [index, roll] of result.rolls.entries()) {
      const previous = result.rolls[index - 1];
      expect(roll.diceRange.start).toBe(previous === undefined
        ? 0
        : previous.diceRange.start + previous.diceRange.count);
      expect(roll.groupRange.start).toBe(previous === undefined
        ? 0
        : previous.groupRange.start + previous.groupRange.count);
      expect(roll.eventRange.start).toBe(previous === undefined
        ? 0
        : previous.eventRange.start + previous.eventRange.count);
      expect(result.dice.slice(
        roll.diceRange.start,
        roll.diceRange.start + roll.diceRange.count,
      ).every((die) => die.rollIndex === roll.index)).toBe(true);
    }
    const last = result.rolls.at(-1);
    expect(last?.diceRange.start === undefined
      ? 0
      : last.diceRange.start + last.diceRange.count).toBe(result.dice.length);
    expect(last?.groupRange.start === undefined
      ? 0
      : last.groupRange.start + last.groupRange.count).toBe(result.groups.length);
    expect(last?.eventRange.start === undefined
      ? 0
      : last.eventRange.start + last.eventRange.count).toBe(result.events.length);
  });

  test('keeps full and summary replay totals, pools, and logical stats identical', () => {
    const full = rollRpgDice('2#5d10>=8f=1', {
      randomAlgorithm: 'xoshiro128ss',
      seed: 'summary-parity',
    });
    const summary = rollRpgDiceSummary(compileRpgDice(full.input), { replay: full.replay });
    expect(summary).toMatchObject({
      type: 'dice-roll-summary',
      total: full.total,
      pool: full.pool,
      replay: full.replay,
      stats: full.stats,
    });
    expect(summary.rolls).toEqual(full.rolls.map((roll) => ({
      index: roll.index,
      total: roll.total,
      pool: roll.pool,
    })));
    expect('dice' in summary).toBe(false);
    expect('groups' in summary).toBe(false);
    expect('events' in summary).toBe(false);
    expect('output' in summary).toBe(false);

    const plainFull = rollRpgDice('3#10d20+2', { seed: 'fast-summary-parity' });
    const plainSummary = rollRpgDiceSummary(plainFull.input, { replay: plainFull.replay });
    expect(plainSummary.total).toBe(plainFull.total);
    expect(plainSummary.rolls.map((roll) => roll.total))
      .toEqual(plainFull.rolls.map((roll) => roll.total));
    expect(plainSummary.stats).toEqual(plainFull.stats);
  });

  test('replays the complete DTO byte-for-byte for both algorithms', () => {
    for (const algorithm of ['mt19937', 'xoshiro128ss'] as const) {
      const first = rollRpgDice('{4d6kh3,1d20}sd', {
        randomAlgorithm: algorithm,
        seed: `replay-${algorithm}`,
      });
      const replayed = rollRpgDice(first.input, { replay: first.replay });
      expect(JSON.stringify(replayed)).toBe(JSON.stringify(first));
      expect(() => rollRpgDice('1d6', { replay: first.replay }))
        .toThrow(expect.objectContaining({ code: 'REPLAY_PLAN_MISMATCH' }));
    }
  });

  test('reconstructs die and group state from the causal journal', () => {
    for (const notation of [
      '4d6min4max5kh3>=4cs=5cf=4',
      '1d6!!',
      '1d6!p',
      '{1d6,1d8}sd',
      '{1,2}kh1',
    ]) {
      const result = rollRpgDice(notation, { seed: `reducer:${notation}` });
      const reduced = reduceEvents(result.events);
      for (const die of result.dice) {
        const actual = reduced.dice.get(die.id);
        expect(actual).toBeDefined();
        expect(actual).toMatchObject({
          id: die.id,
          parentDieId: die.parentDieId,
          rawValue: die.rawValue,
          value: die.value,
          contribution: die.contribution,
          included: die.included,
        });
        expect([...actual?.states ?? []]).toEqual(die.states);
      }
      for (const group of result.groups) {
        const actual = reduced.groups.get(group.id);
        expect(actual).toBeDefined();
        expect(actual).toMatchObject({
          value: group.value,
          contribution: group.contribution,
          included: group.included,
        });
        expect([...actual?.states ?? []]).toEqual(group.states);
      }
    }
  });

  test('enforces every new cap at its exact boundary', () => {
    expect(() => createDiceEngine({ limits: { maxSides: 0xffff_ffff } })
      .compile('1d4294967295')).not.toThrow();
    expect(() => createDiceEngine({ limits: { maxSides: 0x1_0000_0000 } })
      .roll('1d4294967296', { seed: 1 })).not.toThrow();
    expect(() => compileRpgDice('1d4294967297'))
      .toThrow(expect.objectContaining({ code: 'DICE_SIDES_LIMIT_EXCEEDED' }));

    expect(() => createDiceEngine({ limits: { maxSeedLength: 4 } })
      .roll('1d6', { seed: '1234' })).not.toThrow();
    expect(() => createDiceEngine({ limits: { maxSeedLength: 3 } })
      .roll('1d6', { seed: '1234' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_SEED' }));

    expect(() => createDiceEngine({ limits: { maxModifierSteps: 3 } })
      .roll('4d6u', { seed: 's2' })).not.toThrow();
    expect(() => createDiceEngine({ limits: { maxModifierSteps: 2 } })
      .roll('4d6u', { seed: 's2' }))
      .toThrow(expect.objectContaining({ code: 'MODIFIER_STEP_LIMIT_EXCEEDED' }));

    expect(() => createDiceEngine({ limits: { maxResolvedGroups: 3 } })
      .roll('1+2', { seed: 1 })).not.toThrow();
    expect(() => createDiceEngine({ limits: { maxResolvedGroups: 2 } })
      .roll('1+2', { seed: 1 }))
      .toThrow(expect.objectContaining({ code: 'RESOLVED_GROUP_LIMIT_EXCEEDED' }));

    const baseline = rollRpgDice('1d6', { seed: 'result-cap' });
    expect(baseline.stats.resultItems).toBeGreaterThan(1);
    expect(() => createDiceEngine({ limits: { maxResultItems: baseline.stats.resultItems } })
      .roll('1d6', { seed: 'result-cap' })).not.toThrow();
    expect(() => createDiceEngine({ limits: { maxResultItems: baseline.stats.resultItems - 1 } })
      .roll('1d6', { seed: 'result-cap' }))
      .toThrow(expect.objectContaining({ code: 'RESULT_LIMIT_EXCEEDED' }));

    expect(() => createDiceEngine({ limits: { maxOutputLength: baseline.output.length } })
      .roll('1d6', { seed: 'result-cap' })).not.toThrow();
    expect(() => createDiceEngine({ limits: { maxOutputLength: baseline.output.length - 1 } })
      .roll('1d6', { seed: 'result-cap' }))
      .toThrow(expect.objectContaining({ code: 'OUTPUT_LIMIT_EXCEEDED' }));
  });
});
