import { DiceRollError } from '../errors.js';
import type { ResolvedDie } from '../types.js';

export type DiceSystemId = 'assimilation' | 'daggerheart' | 'fate' | 'vampire-v5';

/**
 * A semantic projection of one numeric die produced by the V3 executor.
 *
 * `id` is unique inside the system roll while `sourceDieId` links back to
 * `DiceRollResult.dice`. Renderers should select artwork through `profileId`
 * and `faceKey`, without coupling the core package to image assets.
 */
export interface SystemDieResult<
  ProfileId extends string = string,
  DieKind extends string = string,
  FaceKey extends string = string,
  SymbolId extends string = string,
> {
  readonly id: string;
  readonly sourceDieId: string;
  readonly sides: number;
  readonly value: number;
  readonly rawValue: number;
  readonly profileId: ProfileId;
  readonly dieKind: DieKind;
  readonly faceKey: FaceKey;
  readonly symbols: readonly SymbolId[];
}

type SystemInput = Readonly<Record<string, unknown>>;

export function invalidSystemInput(
  system: DiceSystemId,
  field: string,
  reason: string,
): DiceRollError {
  return new DiceRollError(`Invalid ${system} roll input: ${field} ${reason}`, {
    code: 'INVALID_SYSTEM_INPUT',
    input: system,
    details: { system, field, reason },
  });
}

export function readSystemInput(value: unknown, system: DiceSystemId): SystemInput {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw invalidSystemInput(system, 'input', 'must be a non-null object');
    }
    return value as SystemInput;
  } catch (error: unknown) {
    if (error instanceof DiceRollError) {
      throw error;
    }
    throw invalidSystemInput(system, 'input', 'could not be read');
  }
}

function readSystemProperty(
  input: SystemInput,
  system: DiceSystemId,
  field: string,
): unknown {
  try {
    return input[field];
  } catch {
    throw invalidSystemInput(system, field, 'could not be read');
  }
}

function validateSystemInteger(
  value: unknown,
  system: DiceSystemId,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw invalidSystemInput(
      system,
      field,
      `must be a safe integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

export function readRequiredSystemInteger(
  input: SystemInput,
  system: DiceSystemId,
  field: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const value = readSystemProperty(input, system, field);
  if (value === undefined) {
    throw invalidSystemInput(system, field, 'is required');
  }
  return validateSystemInteger(value, system, field, minimum, maximum);
}

export function readOptionalSystemInteger(
  input: SystemInput,
  system: DiceSystemId,
  field: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const value = readSystemProperty(input, system, field);
  return value === undefined
    ? undefined
    : validateSystemInteger(value, system, field, minimum, maximum);
}

export function createSystemDieResult<
  ProfileId extends string,
  DieKind extends string,
  FaceKey extends string,
  SymbolId extends string,
>(
  die: ResolvedDie,
  profileId: ProfileId,
  dieKind: DieKind,
  faceKey: FaceKey,
  symbols: readonly SymbolId[],
): SystemDieResult<ProfileId, DieKind, FaceKey, SymbolId> {
  if (typeof die.sides !== 'number') {
    throw new TypeError('System dice must use numeric sides');
  }
  return {
    id: `${profileId}:${die.id}`,
    sourceDieId: die.id,
    sides: die.sides,
    value: die.value,
    rawValue: die.rawValue,
    profileId,
    dieKind,
    faceKey,
    symbols,
  };
}
