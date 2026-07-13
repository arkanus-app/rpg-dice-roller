import { DiceRollError } from '../errors.js';

export interface DiceLimits {
  readonly maxInputLength: number;
  readonly maxAstDepth: number;
  readonly maxAstNodes: number;
  readonly maxRolls: number;
  readonly maxInitialDice: number;
  readonly maxGeneratedDice: number;
  readonly maxRandomCalls: number;
  readonly maxEvents: number;
  readonly maxSides: number;
  readonly maxSeedLength: number;
  readonly maxModifierSteps: number;
  readonly maxResolvedGroups: number;
  readonly maxResultItems: number;
  readonly maxOutputLength: number;
}

export type DiceLimitOverrides = Partial<DiceLimits>;

export const DEFAULT_DICE_LIMITS: DiceLimits = Object.freeze({
  maxInputLength: 4_096,
  maxAstDepth: 64,
  maxAstNodes: 10_000,
  maxRolls: 100,
  maxInitialDice: 10_000,
  maxGeneratedDice: 20_000,
  maxRandomCalls: 100_000,
  maxEvents: 100_000,
  maxSides: 0x1_0000_0000,
  maxSeedLength: 1_024,
  maxModifierSteps: 100_000,
  maxResolvedGroups: 100_000,
  maxResultItems: 250_000,
  maxOutputLength: 1_000_000,
});

type DiceLimitName = keyof DiceLimits;

function validateLimit(name: DiceLimitName, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DiceRollError(`${name} must be a positive safe integer`, {
      code: 'INVALID_LIMIT',
      details: {
        limit: name,
        value: Number.isFinite(value) ? value : String(value),
      },
    });
  }

  return value;
}

function readOverride(
  overrides: DiceLimitOverrides,
  name: DiceLimitName,
  fallback: number,
): number {
  let value: unknown;
  try {
    value = overrides[name];
  } catch {
    throw new DiceRollError(`Unable to read ${name}`, {
      code: 'INVALID_LIMIT',
      details: { limit: name },
    });
  }
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number') {
    throw new DiceRollError(`${name} must be a number`, {
      code: 'INVALID_LIMIT',
      details: { limit: name, valueType: typeof value },
    });
  }
  return validateLimit(name, value);
}

function assertOverridesObject(overrides: unknown): asserts overrides is DiceLimitOverrides {
  try {
    if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
      throw new DiceRollError('Dice limit overrides must be a non-null object', {
        code: 'INVALID_LIMIT',
      });
    }
  } catch (error: unknown) {
    if (error instanceof DiceRollError) {
      throw error;
    }
    throw new DiceRollError('Dice limit overrides could not be read', {
      code: 'INVALID_LIMIT',
    });
  }
}

function resolveOverride(
  engineLimits: DiceLimits,
  overrides: DiceLimitOverrides,
  name: DiceLimitName,
): number {
  const value = readOverride(overrides, name, engineLimits[name]);
  if (value > engineLimits[name]) {
    throw new DiceRollError(`${name} cannot exceed the engine cap`, {
      code: 'INVALID_LIMIT',
      details: {
        limit: name,
        requested: value,
        engineCap: engineLimits[name],
      },
    });
  }
  return value;
}

function freezeLimits(limits: DiceLimits): DiceLimits {
  return Object.freeze(limits);
}

/** Creates the immutable caps owned by a DiceEngine instance. */
export function createDiceLimits(overrides: unknown = {}): DiceLimits {
  assertOverridesObject(overrides);
  return freezeLimits({
    maxInputLength: readOverride(overrides, 'maxInputLength', DEFAULT_DICE_LIMITS.maxInputLength),
    maxAstDepth: readOverride(overrides, 'maxAstDepth', DEFAULT_DICE_LIMITS.maxAstDepth),
    maxAstNodes: readOverride(overrides, 'maxAstNodes', DEFAULT_DICE_LIMITS.maxAstNodes),
    maxRolls: readOverride(overrides, 'maxRolls', DEFAULT_DICE_LIMITS.maxRolls),
    maxInitialDice: readOverride(overrides, 'maxInitialDice', DEFAULT_DICE_LIMITS.maxInitialDice),
    maxGeneratedDice: readOverride(
      overrides,
      'maxGeneratedDice',
      DEFAULT_DICE_LIMITS.maxGeneratedDice,
    ),
    maxRandomCalls: readOverride(overrides, 'maxRandomCalls', DEFAULT_DICE_LIMITS.maxRandomCalls),
    maxEvents: readOverride(overrides, 'maxEvents', DEFAULT_DICE_LIMITS.maxEvents),
    maxSides: readOverride(overrides, 'maxSides', DEFAULT_DICE_LIMITS.maxSides),
    maxSeedLength: readOverride(overrides, 'maxSeedLength', DEFAULT_DICE_LIMITS.maxSeedLength),
    maxModifierSteps: readOverride(
      overrides,
      'maxModifierSteps',
      DEFAULT_DICE_LIMITS.maxModifierSteps,
    ),
    maxResolvedGroups: readOverride(
      overrides,
      'maxResolvedGroups',
      DEFAULT_DICE_LIMITS.maxResolvedGroups,
    ),
    maxResultItems: readOverride(
      overrides,
      'maxResultItems',
      DEFAULT_DICE_LIMITS.maxResultItems,
    ),
    maxOutputLength: readOverride(
      overrides,
      'maxOutputLength',
      DEFAULT_DICE_LIMITS.maxOutputLength,
    ),
  });
}

/**
 * Resolves per-call limits against immutable engine caps.
 * A call may lower a cap, but attempting to raise one is a configuration error.
 */
export function resolveDiceLimits(
  engineLimits: DiceLimits,
  callOverrides: unknown = {},
): DiceLimits {
  assertOverridesObject(callOverrides);

  return freezeLimits({
    maxInputLength: resolveOverride(engineLimits, callOverrides, 'maxInputLength'),
    maxAstDepth: resolveOverride(engineLimits, callOverrides, 'maxAstDepth'),
    maxAstNodes: resolveOverride(engineLimits, callOverrides, 'maxAstNodes'),
    maxRolls: resolveOverride(engineLimits, callOverrides, 'maxRolls'),
    maxInitialDice: resolveOverride(engineLimits, callOverrides, 'maxInitialDice'),
    maxGeneratedDice: resolveOverride(engineLimits, callOverrides, 'maxGeneratedDice'),
    maxRandomCalls: resolveOverride(engineLimits, callOverrides, 'maxRandomCalls'),
    maxEvents: resolveOverride(engineLimits, callOverrides, 'maxEvents'),
    maxSides: resolveOverride(engineLimits, callOverrides, 'maxSides'),
    maxSeedLength: resolveOverride(engineLimits, callOverrides, 'maxSeedLength'),
    maxModifierSteps: resolveOverride(engineLimits, callOverrides, 'maxModifierSteps'),
    maxResolvedGroups: resolveOverride(engineLimits, callOverrides, 'maxResolvedGroups'),
    maxResultItems: resolveOverride(engineLimits, callOverrides, 'maxResultItems'),
    maxOutputLength: resolveOverride(engineLimits, callOverrides, 'maxOutputLength'),
  });
}
