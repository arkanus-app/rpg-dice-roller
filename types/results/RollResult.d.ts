export interface RollResultValueObject {
    value?: unknown;
    initialValue?: unknown;
    calculationValue?: unknown;
    modifiers?: unknown;
    useInTotal?: unknown;
}
export interface RollResultJson {
    calculationValue: number;
    initialValue: number;
    modifierFlags: string;
    modifiers: string[];
    type: 'result';
    useInTotal: boolean;
    value: number;
}
/**
 * A `RollResult` represents the value and applicable modifiers for a single die roll.
 */
declare class RollResult {
    private calculationValueOverride;
    private modifierNames;
    private initialRollValue;
    private useRollInTotal;
    private rollValue;
    constructor(value: number | RollResultValueObject, modifiers?: unknown, useInTotal?: unknown);
    get calculationValue(): number;
    set calculationValue(value: unknown);
    get initialValue(): number;
    get modifierFlags(): string;
    get modifiers(): Set<string>;
    set modifiers(value: unknown);
    get useInTotal(): boolean;
    set useInTotal(value: unknown);
    get value(): number;
    set value(value: unknown);
    toJSON(): RollResultJson;
    toString(): string;
}
export default RollResult;
