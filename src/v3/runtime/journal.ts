import type {
  ClassifyDiceEvent,
  DiceEvent,
  ExcludeDiceEvent,
  ExcludeGroupEvent,
  ExplodeDiceEvent,
  IncludeDiceEvent,
  IncludeGroupEvent,
  RerollDiceEvent,
  RollDiceEvent,
  TransformDiceEvent,
  TransformGroupEvent,
} from '../types.js';
import type { EventBudget } from './budget.js';

type WithoutSequence<T extends DiceEvent> = Omit<T, 'sequence'>;

export type DiceEventInput =
  | WithoutSequence<RollDiceEvent>
  | WithoutSequence<RerollDiceEvent>
  | WithoutSequence<ExplodeDiceEvent>
  | WithoutSequence<TransformDiceEvent>
  | WithoutSequence<TransformGroupEvent>
  | WithoutSequence<IncludeDiceEvent>
  | WithoutSequence<IncludeGroupEvent>
  | WithoutSequence<ExcludeDiceEvent>
  | WithoutSequence<ExcludeGroupEvent>
  | WithoutSequence<ClassifyDiceEvent>;

export interface DiceEventSink {
  readonly length: number;
  record(event: DiceEventInput): DiceEvent | null;
  slice(start: number, end?: number): readonly DiceEvent[];
  toArray(): readonly DiceEvent[];
}

/** Counts every logical event and optionally materializes the public journal. */
export class ExecutionJournal implements DiceEventSink {
  private readonly journal: DiceEvent[] = [];

  private readonly budget: EventBudget | null;

  private readonly materialize: boolean;

  private eventCount = 0;

  constructor(budget: EventBudget | null = null, materialize = true) {
    this.budget = budget;
    this.materialize = materialize;
  }

  get length(): number {
    return this.eventCount;
  }

  record(input: DiceEventInput): DiceEvent | null {
    this.budget?.consumeEvents();
    this.budget?.consumeResultItems();
    this.eventCount += 1;
    if (!this.materialize) {
      return null;
    }
    const event = { sequence: this.eventCount, ...input } as DiceEvent;
    this.journal.push(event);
    return event;
  }

  slice(start: number, end = this.journal.length): readonly DiceEvent[] {
    if (!this.materialize) {
      return [];
    }
    return this.journal.slice(start, end);
  }

  toArray(): readonly DiceEvent[] {
    if (!this.materialize) {
      return [];
    }
    return this.journal.slice();
  }
}
