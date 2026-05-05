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
declare class RollResults {
    private rollResults;
    constructor(rolls?: unknown);
    get length(): number;
    get rolls(): RollResult[];
    set rolls(rolls: unknown);
    get value(): number;
    addRoll(value: unknown): void;
    toJSON(): RollResultsJson;
    toString(): string;
}
export default RollResults;
