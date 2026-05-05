import { evaluate, isNumeric } from '../utilities/math.js';
import getModifierFlags from '../modifiers/modifier-flags.js';
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

function addResultValues(left: string | number, right: string | number): string | number {
  if ((typeof left === 'number') && (typeof right === 'number')) {
    return left + right;
  }

  return `${left}${right}`;
}

/**
 * A collection of results and expressions.
 * Usually used to represent the results of a `RollGroup` instance.
 */
class ResultGroup {
  private calculationValueOverride: number | null = null;

  private rollGroup = false;

  private modifierNames = new Set<string>();

  private resultItems: ResultGroupItem[] = [];

  private useGroupInTotal = true;

  constructor(
    results: unknown = [],
    modifiers: unknown = [],
    isRollGroup: unknown = false,
    useInTotal: unknown = true,
  ) {
    this.isRollGroup = isRollGroup;
    this.modifiers = modifiers;
    this.results = results;
    this.useInTotal = useInTotal;
  }

  get calculationValue(): number {
    return isNumeric(this.calculationValueOverride)
      ? parseFloat(`${this.calculationValueOverride}`)
      : this.value;
  }

  set calculationValue(value: unknown) {
    const isValNumeric = isNumeric(value);
    if (value === Infinity) {
      throw new RangeError('Results calculation value must be a finite number');
    }
    if (value && !isValNumeric) {
      throw new TypeError(`Results calculation value is invalid: ${value}`);
    }

    this.calculationValueOverride = isValNumeric ? parseFloat(`${value}`) : null;
  }

  get isRollGroup(): boolean {
    return this.rollGroup;
  }

  set isRollGroup(value: unknown) {
    this.rollGroup = !!value;
  }

  get length(): number {
    return this.results.length || 0;
  }

  get modifierFlags(): string {
    return getModifierFlags(...this.modifiers);
  }

  get modifiers(): Set<string> {
    return this.modifierNames;
  }

  set modifiers(value: unknown) {
    if ((Array.isArray(value) || (value instanceof Set)) && [...value].every((item) => typeof item === 'string')) {
      this.modifierNames = new Set([...value] as string[]);
    } else if (!value && (value !== 0)) {
      this.modifierNames = new Set();
    } else {
      throw new TypeError(`modifiers must be a Set or array of modifier names: ${value}`);
    }
  }

  get results(): ResultGroupItem[] {
    return [...this.resultItems];
  }

  set results(results: unknown) {
    if (!results || !Array.isArray(results)) {
      throw new TypeError(`results must be an array: ${results}`);
    }

    this.resultItems = [];
    results.forEach((result) => {
      this.addResult(result);
    });
  }

  get useInTotal(): boolean {
    return !!this.useGroupInTotal;
  }

  set useInTotal(value: unknown) {
    this.useGroupInTotal = !!value;
  }

  get value(): number {
    const { results } = this;
    if (!results.length) {
      return 0;
    }

    const [firstResult] = results;
    const value = results.reduce<string | number>((total, result) => {
      let val: string | number;

      if (result instanceof ResultGroup) {
        val = result.useInTotal ? result.calculationValue : 0;
      } else if (result instanceof RollResults) {
        val = result.value;
      } else {
        val = result;
      }

      return addResultValues(total, val);
    }, (typeof firstResult === 'string') ? '' : 0);

    if (typeof value === 'string') {
      return evaluate(value);
    }

    return value;
  }

  addResult(value: unknown): void {
    let val: ResultGroupItem;

    if ((value instanceof ResultGroup) || (value instanceof RollResults)) {
      val = value;
    } else if ((typeof value === 'string') || isNumeric(value)) {
      val = value as string | number;
    } else {
      throw new TypeError('value must be one of ResultGroup, RollResults, string, or number');
    }

    this.resultItems.push(val);
  }

  toJSON(): ResultGroupJson {
    const {
      calculationValue, isRollGroup, modifierFlags, modifiers, results, useInTotal, value,
    } = this;

    return {
      calculationValue,
      isRollGroup,
      modifierFlags,
      modifiers: [...modifiers],
      results,
      type: 'result-group',
      useInTotal,
      value,
    };
  }

  toString(): string {
    let output: string;

    if (this.isRollGroup) {
      output = `{${this.results.join(', ')}}`;
    } else {
      output = this.results.join('');
    }

    if (this.modifierFlags) {
      output = `(${output})${this.modifierFlags}`;
    }

    return output;
  }
}

export default ResultGroup;
