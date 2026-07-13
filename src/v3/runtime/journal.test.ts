import { describe, expect, it } from 'vitest';
import { ExecutionBudget } from './budget.js';
import { ExecutionJournal } from './journal.js';
import { createDiceLimits } from './limits.js';

describe('ExecutionJournal', () => {
  it('records immutable, chronological, causal events', () => {
    const budget = new ExecutionBudget(createDiceLimits({ maxEvents: 2 }));
    const journal = new ExecutionJournal(budget);
    journal.record({
      type: 'roll',
      subject: 'die',
      dieId: 'die-1',
      parentDieId: null,
      rollIndex: 0,
      sourceNodeId: 'node-1',
      value: 6,
    });
    journal.record({
      type: 'explode',
      subject: 'die',
      dieId: 'die-1',
      parentDieId: null,
      rollIndex: 0,
      sourceNodeId: 'node-1',
      childDieId: 'die-2',
      value: 4,
      reason: 'explode',
    });

    const events = journal.toArray();
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events[1]).toEqual(expect.objectContaining({
      type: 'explode',
      dieId: 'die-1',
      parentDieId: null,
      childDieId: 'die-2',
    }));
    expect(budget.snapshot().events).toBe(2);
  });

  it('applies the event budget before mutating the journal', () => {
    const budget = new ExecutionBudget(createDiceLimits({ maxEvents: 1 }));
    const journal = new ExecutionJournal(budget);
    const event = {
      type: 'roll' as const,
      subject: 'die' as const,
      dieId: 'die-1',
      parentDieId: null,
      rollIndex: 0,
      sourceNodeId: 'node-1',
      value: 1,
    };
    journal.record(event);

    expect(() => journal.record(event)).toThrowError(
      expect.objectContaining({ code: 'EVENT_LIMIT_EXCEEDED' }),
    );
    expect(journal.toArray()).toHaveLength(1);
  });

  it('counts events without materializing them in summary mode', () => {
    const budget = new ExecutionBudget(createDiceLimits({ maxEvents: 2 }));
    const journal = new ExecutionJournal(budget, false);
    const recorded = journal.record({
      type: 'roll',
      subject: 'die',
      dieId: 'die-1',
      parentDieId: null,
      rollIndex: 0,
      sourceNodeId: 'node-1',
      value: 6,
    });

    expect(recorded).toBeNull();
    expect(journal.length).toBe(1);
    expect(journal.toArray()).toEqual([]);
    expect(journal.slice(0)).toEqual([]);
    expect(budget.stats().events).toBe(1);
  });
});
