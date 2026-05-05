import RollResult from './RollResult.js';

export type RollResultsInput = Array<RollResult | number>;

export interface RollResultsJson {
  rolls: RollResult[];
  type: 'roll-results';
  value: number;
}

/**
 * A collection of die roll results.
 */
class RollResults {
  private rollResults: RollResult[] = [];

  constructor(rolls: unknown = []) {
    this.rolls = rolls;
  }

  get length(): number {
    return this.rolls.length || 0;
  }

  get rolls(): RollResult[] {
    return [...this.rollResults];
  }

  set rolls(rolls: unknown) {
    if (!rolls || !Array.isArray(rolls)) {
      throw new TypeError(`rolls must be an array: ${rolls}`);
    }

    this.rollResults = [];
    rolls.forEach((result) => {
      this.addRoll(result);
    });
  }

  get value(): number {
    return this.rolls.reduce(
      (value, roll) => value + (roll.useInTotal ? roll.calculationValue : 0),
      0,
    );
  }

  addRoll(value: unknown): void {
    const result = (value instanceof RollResult) ? value : new RollResult(value as number);
    this.rollResults.push(result);
  }

  toJSON(): RollResultsJson {
    const { rolls, value } = this;

    return {
      rolls,
      type: 'roll-results',
      value,
    };
  }

  toString(): string {
    return `[${this.rolls.join(', ')}]`;
  }
}

export default RollResults;
