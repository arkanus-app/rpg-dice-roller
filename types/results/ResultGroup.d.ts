import RollResults from './RollResults.js';
export type ResultGroupItem = ResultGroup | RollResults | number | string;
export interface ResultGroupJson {
    calculationValue: number;
    isRollGroup: boolean;
    modifierFlags: string;
    modifiers: string[];
    results: ResultGroupItem[];
    type: 'result-group';
    useInTotal: boolean;
    value: number;
}
/**
 * A collection of results and expressions.
 * Usually used to represent the results of a `RollGroup` instance.
 */
declare class ResultGroup {
    private calculationValueOverride;
    private rollGroup;
    private modifierNames;
    private resultItems;
    private useGroupInTotal;
    constructor(results?: unknown, modifiers?: unknown, isRollGroup?: unknown, useInTotal?: unknown);
    get calculationValue(): number;
    set calculationValue(value: unknown);
    get isRollGroup(): boolean;
    set isRollGroup(value: unknown);
    get length(): number;
    get modifierFlags(): string;
    get modifiers(): Set<string>;
    set modifiers(value: unknown);
    get results(): ResultGroupItem[];
    set results(results: unknown);
    get useInTotal(): boolean;
    set useInTotal(value: unknown);
    get value(): number;
    addResult(value: unknown): void;
    toJSON(): ResultGroupJson;
    toString(): string;
}
export default ResultGroup;
