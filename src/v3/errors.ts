export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type DiceRollErrorCode =
  | 'DICE_NOTATION_REQUIRED'
  | 'INPUT_TOO_LONG'
  | 'AST_TOO_DEEP'
  | 'TOO_MANY_NODES'
  | 'TOO_MANY_ROLLS'
  | 'TOO_MANY_INITIAL_DICE'
  | 'GENERATED_DICE_LIMIT_EXCEEDED'
  | 'RANDOM_BUDGET_EXCEEDED'
  | 'EVENT_LIMIT_EXCEEDED'
  | 'MODIFIER_STEP_LIMIT_EXCEEDED'
  | 'RESOLVED_GROUP_LIMIT_EXCEEDED'
  | 'RESULT_LIMIT_EXCEEDED'
  | 'OUTPUT_LIMIT_EXCEEDED'
  | 'DICE_SIDES_LIMIT_EXCEEDED'
  | 'INVALID_NOTATION'
  | 'UNSUPPORTED_NOTATION'
  | 'UNSUPPORTED_GROUP_MODIFIER'
  | 'NON_TERMINATING_MODIFIER'
  | 'IMPOSSIBLE_UNIQUE'
  | 'ROLL_EXECUTION_LIMIT'
  | 'RNG_UNAVAILABLE'
  | 'INVALID_SEED'
  | 'INVALID_REPLAY'
  | 'REPLAY_PLAN_MISMATCH'
  | 'INVALID_LIMIT'
  | 'UNSUPPORTED_REPLAY_VERSION'
  | 'NON_FINITE_RESULT'
  | 'INVALID_ERROR_DATA';

export interface DiceErrorData {
  readonly name: 'DiceRollError';
  readonly code: DiceRollErrorCode;
  readonly message: string;
  readonly span: SourceSpan | null;
  readonly input: string;
  readonly details: JsonObject;
}

export interface DiceRollErrorOptions {
  readonly code: DiceRollErrorCode;
  readonly span?: SourceSpan | null;
  readonly input?: string;
  readonly details?: JsonObject;
}

const ERROR_CODES: ReadonlySet<string> = new Set<DiceRollErrorCode>([
  'DICE_NOTATION_REQUIRED',
  'INPUT_TOO_LONG',
  'AST_TOO_DEEP',
  'TOO_MANY_NODES',
  'TOO_MANY_ROLLS',
  'TOO_MANY_INITIAL_DICE',
  'GENERATED_DICE_LIMIT_EXCEEDED',
  'RANDOM_BUDGET_EXCEEDED',
  'EVENT_LIMIT_EXCEEDED',
  'MODIFIER_STEP_LIMIT_EXCEEDED',
  'RESOLVED_GROUP_LIMIT_EXCEEDED',
  'RESULT_LIMIT_EXCEEDED',
  'OUTPUT_LIMIT_EXCEEDED',
  'DICE_SIDES_LIMIT_EXCEEDED',
  'INVALID_NOTATION',
  'UNSUPPORTED_NOTATION',
  'UNSUPPORTED_GROUP_MODIFIER',
  'NON_TERMINATING_MODIFIER',
  'IMPOSSIBLE_UNIQUE',
  'ROLL_EXECUTION_LIMIT',
  'RNG_UNAVAILABLE',
  'INVALID_SEED',
  'INVALID_REPLAY',
  'REPLAY_PLAN_MISMATCH',
  'INVALID_LIMIT',
  'UNSUPPORTED_REPLAY_VERSION',
  'NON_FINITE_RESULT',
  'INVALID_ERROR_DATA',
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  try {
    return !Array.isArray(value);
  } catch {
    return false;
  }
}

function isSourceSpan(value: unknown): value is SourceSpan {
  if (!isRecord(value)) {
    return false;
  }

  try {
    return Number.isSafeInteger(value['start'])
      && Number.isSafeInteger(value['end'])
      && typeof value['start'] === 'number'
      && typeof value['end'] === 'number'
      && value['start'] >= 0
      && value['end'] >= value['start'];
  } catch {
    return false;
  }
}

function isJsonValue(value: unknown, ancestors: ReadonlySet<object>): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object') {
    return false;
  }
  if (ancestors.has(value)) {
    return false;
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.every((item) => isJsonValue(item, nextAncestors));
    }
    return Object.keys(value).every((key) => isJsonValue(
      (value as Readonly<Record<string, unknown>>)[key],
      nextAncestors,
    ));
  } catch {
    return false;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && isJsonValue(value, new Set<object>());
}

/** A stable, JSON-safe error raised by the V3 compiler or executor. */
export class DiceRollError extends Error {
  readonly code: DiceRollErrorCode;

  readonly span: SourceSpan | null;

  readonly input: string;

  readonly details: JsonObject;

  constructor(message: string, options: DiceRollErrorOptions) {
    super(message);
    this.name = 'DiceRollError';
    this.code = options.code;
    this.span = options.span ?? null;
    this.input = options.input ?? '';
    this.details = options.details ?? {};
  }

  static fromJSON(data: unknown): DiceRollError {
    if (!isDiceRollErrorData(data)) {
      throw new DiceRollError('Value is not valid serialized dice error data', {
        code: 'INVALID_ERROR_DATA',
      });
    }

    return new DiceRollError(data.message, {
      code: data.code,
      span: data.span,
      input: data.input,
      details: data.details,
    });
  }

  toJSON(): DiceErrorData {
    return {
      name: 'DiceRollError',
      code: this.code,
      message: this.message,
      span: this.span,
      input: this.input,
      details: this.details,
    };
  }
}

export function isDiceRollError(error: unknown): error is DiceRollError {
  return error instanceof DiceRollError;
}

/** Recognizes JSON-safe dice errors across workers, realms and process boundaries. */
export function isDiceRollErrorData(value: unknown): value is DiceErrorData {
  if (!isRecord(value)) {
    return false;
  }

  try {
    return value['name'] === 'DiceRollError'
      && typeof value['code'] === 'string'
      && ERROR_CODES.has(value['code'])
      && typeof value['message'] === 'string'
      && (value['span'] === null || isSourceSpan(value['span']))
      && typeof value['input'] === 'string'
      && isJsonObject(value['details']);
  } catch {
    return false;
  }
}
