import { isNumeric } from '../utilities/math.js';
import getModifierFlags from '../modifiers/modifier-flags.js';

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
class RollResult {
  private calculationValueOverride: number | null = null;

  private modifierNames = new Set<string>();

  private initialRollValue = 0;

  private useRollInTotal = true;

  private rollValue: number | null = null;

  constructor(
    value: number | RollResultValueObject,
    modifiers: unknown = [],
    useInTotal: unknown = true,
  ) {
    if (isNumeric(value)) {
      this.initialRollValue = Number(value);
      this.modifiers = modifiers || [];
      this.useInTotal = useInTotal;
    } else if (value && (typeof value === 'object') && !Array.isArray(value)) {
      const initialVal = isNumeric(value.initialValue) ? value.initialValue : value.value;
      if (!isNumeric(initialVal)) {
        throw new TypeError(`Result value is invalid: ${initialVal}`);
      }

      this.initialRollValue = Number(initialVal);

      if (
        isNumeric(value.value)
        && (Number(value.value) !== this.initialRollValue)
      ) {
        this.value = value.value;
      }

      if (
        isNumeric(value.calculationValue)
        && (parseFloat(`${value.calculationValue}`) !== this.value)
      ) {
        this.calculationValue = value.calculationValue;
      }

      this.modifiers = value.modifiers || modifiers || [];
      this.useInTotal = (typeof value.useInTotal === 'boolean')
        ? value.useInTotal
        : (useInTotal || false);
    } else if (value === Infinity) {
      throw new RangeError('Result value must be a finite number');
    } else {
      throw new TypeError(`Result value is invalid: ${value}`);
    }
  }

  get calculationValue(): number {
    return isNumeric(this.calculationValueOverride)
      ? parseFloat(`${this.calculationValueOverride}`)
      : this.value;
  }

  set calculationValue(value: unknown) {
    const isValNumeric = isNumeric(value);
    if (value === Infinity) {
      throw new RangeError('Result calculation value must be a finite number');
    }
    if (value && !isValNumeric) {
      throw new TypeError(`Result calculation value is invalid: ${value}`);
    }

    this.calculationValueOverride = isValNumeric ? parseFloat(`${value}`) : null;
  }

  get initialValue(): number {
    return this.initialRollValue;
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
      return;
    }

    if (!value && (value !== 0)) {
      this.modifierNames = new Set();
      return;
    }

    throw new TypeError(`modifiers must be a Set or array of modifier names: ${value}`);
  }

  get useInTotal(): boolean {
    return !!this.useRollInTotal;
  }

  set useInTotal(value: unknown) {
    this.useRollInTotal = !!value;
  }

  get value(): number {
    return isNumeric(this.rollValue) ? Number(this.rollValue) : this.initialRollValue;
  }

  set value(value: unknown) {
    if (value === Infinity) {
      throw new RangeError('Result value must be a finite number');
    }
    if (!isNumeric(value)) {
      throw new TypeError(`Result value is invalid: ${value}`);
    }

    this.rollValue = Number(value);
  }

  toJSON(): RollResultJson {
    const {
      calculationValue, initialValue, modifierFlags, modifiers, useInTotal, value,
    } = this;

    return {
      calculationValue,
      initialValue,
      modifierFlags,
      modifiers: [...modifiers],
      type: 'result',
      useInTotal,
      value,
    };
  }

  toString(): string {
    return this.value + this.modifierFlags;
  }
}

export default RollResult;
