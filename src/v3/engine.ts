import { WeightedLruCache } from './cache.js';
import {
  compileDiceProgram,
  compilePreparedDicePlan,
  hasPlanProgram,
  prepareDicePlanInput,
  validateKnownPlan,
  type CompiledDiceProgram,
} from './compiler.js';
import { DiceRollError, isDiceRollError } from './errors.js';
import { executeRollPlan, executeRollPlanSummary } from './executor.js';
import {
  freezeDiceRollResult,
  freezeDiceRollSummary,
  shouldFreezeResults,
} from './freeze.js';
import { normalizeRpgDiceNotation, parseNormalizedDiceInput } from './normalization.js';
import {
  createDiceLimits,
  resolveDiceLimits,
  type DiceLimits,
} from './runtime/limits.js';
import {
  validateReplayDescriptor,
  type RandomAlgorithm,
  type ReplayDescriptor,
  type SeedInput,
} from './runtime/replay.js';
import type {
  CompileOptions,
  DiceCacheOptions,
  DiceCacheStats,
  DiceEngine,
  DiceEngineOptions,
  DiceNotationInspection,
  DiceRollResult,
  DiceRollSummary,
  FreezeResultsMode,
  RollOptions,
  RollPlan,
} from './types.js';

const DEFAULT_INPUT_CACHE_ENTRIES = 500;
const DEFAULT_PROGRAM_CACHE_ENTRIES = 200;
const DEFAULT_PROGRAM_CACHE_NODES = 100_000;
const UNBOUNDED_ENTRY_WEIGHT = Number.MAX_SAFE_INTEGER;

interface ResolvedCacheOptions {
  readonly maxInputEntries: number;
  readonly maxProgramEntries: number;
  readonly maxProgramNodes: number;
}

interface ExternalPlanEnvelope {
  readonly input: string;
  readonly planFingerprint: string;
}

interface RuntimeRollOptions {
  readonly limits: unknown;
  readonly randomAlgorithm: RandomAlgorithm | undefined;
  readonly replay: unknown;
  readonly seed: SeedInput | undefined;
}

interface RuntimeEngineOptions {
  readonly cache: unknown;
  readonly freezeResults: FreezeResultsMode | undefined;
  readonly limits: unknown;
  readonly randomAlgorithm: RandomAlgorithm | undefined;
}

function validateCacheLimit(name: keyof DiceCacheOptions, value: unknown, fallback: number): number {
  const resolved = value ?? fallback;
  if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return resolved;
}

function resolveCacheOptions(options: unknown): ResolvedCacheOptions {
  if (options === false) {
    return { maxInputEntries: 0, maxProgramEntries: 0, maxProgramNodes: 0 };
  }
  let cache: object;
  try {
    if (options !== undefined && (!isObject(options) || Array.isArray(options))) {
      throw new RangeError('cache must be false or a cache options object');
    }
    cache = options === undefined ? {} : options;
  } catch (error: unknown) {
    if (error instanceof RangeError) {
      throw error;
    }
    throw new RangeError('cache options could not be read');
  }
  let maxInputEntries: unknown;
  let maxProgramEntries: unknown;
  let maxProgramNodes: unknown;
  try {
    maxInputEntries = readProperty(cache, 'maxInputEntries');
    maxProgramEntries = readProperty(cache, 'maxProgramEntries');
    maxProgramNodes = readProperty(cache, 'maxProgramNodes');
  } catch {
    throw new RangeError('cache options could not be read');
  }
  return {
    maxInputEntries: validateCacheLimit(
      'maxInputEntries', maxInputEntries, DEFAULT_INPUT_CACHE_ENTRIES,
    ),
    maxProgramEntries: validateCacheLimit(
      'maxProgramEntries', maxProgramEntries, DEFAULT_PROGRAM_CACHE_ENTRIES,
    ),
    maxProgramNodes: validateCacheLimit(
      'maxProgramNodes', maxProgramNodes, DEFAULT_PROGRAM_CACHE_NODES,
    ),
  };
}

function limitsCacheKey(limits: DiceLimits): string {
  return [
    limits.maxInputLength,
    limits.maxAstDepth,
    limits.maxAstNodes,
    limits.maxRolls,
    limits.maxInitialDice,
    limits.maxSides,
    limits.maxModifierSteps,
  ].join(':');
}

function inputCacheKey(input: string, limits: DiceLimits): string {
  return `${limitsCacheKey(limits)}\u0000${input}`;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function hasProperty(value: object, key: string): value is object & Readonly<Record<string, unknown>> {
  return key in value;
}

function readProperty(value: object, key: string): unknown {
  return hasProperty(value, key) ? value[key] : undefined;
}

function readOptionsProperty(options: unknown, key: string, code: 'INVALID_LIMIT' | 'INVALID_REPLAY'): unknown {
  try {
    if (!isObject(options) || Array.isArray(options)) {
      throw new DiceRollError('Dice options must be a non-null object', { code });
    }
    return readProperty(options, key);
  } catch (error: unknown) {
    if (isDiceRollError(error)) {
      throw error;
    }
    throw new DiceRollError(`Unable to read dice option ${key}`, {
      code,
      details: { option: key },
    });
  }
}

function readCompileLimits(options: unknown): unknown {
  return readOptionsProperty(options, 'limits', 'INVALID_LIMIT');
}

function readRuntimeRollOptions(options: unknown): RuntimeRollOptions {
  const limits = readOptionsProperty(options, 'limits', 'INVALID_LIMIT');
  const seed = readOptionsProperty(options, 'seed', 'INVALID_REPLAY');
  const replay = readOptionsProperty(options, 'replay', 'INVALID_REPLAY');
  const randomAlgorithm = readOptionsProperty(options, 'randomAlgorithm', 'INVALID_REPLAY');
  if (seed !== undefined && typeof seed !== 'string' && typeof seed !== 'number') {
    throw new DiceRollError('Seeds must be finite numbers or strings', { code: 'INVALID_SEED' });
  }
  if (randomAlgorithm !== undefined
    && randomAlgorithm !== 'mt19937'
    && randomAlgorithm !== 'xoshiro128ss') {
    throw new DiceRollError('The requested random algorithm is not supported', {
      code: 'INVALID_REPLAY',
    });
  }
  if (replay !== undefined && (seed !== undefined || randomAlgorithm !== undefined)) {
    throw new DiceRollError('Replay cannot be combined with seed or randomAlgorithm', {
      code: 'INVALID_REPLAY',
    });
  }
  return { limits, randomAlgorithm, replay, seed };
}

function readRuntimeEngineOptions(options: unknown): RuntimeEngineOptions {
  const limits = readOptionsProperty(options, 'limits', 'INVALID_LIMIT');
  const cache = readOptionsProperty(options, 'cache', 'INVALID_LIMIT');
  const freezeResults = readOptionsProperty(options, 'freezeResults', 'INVALID_LIMIT');
  const randomAlgorithm = readOptionsProperty(options, 'randomAlgorithm', 'INVALID_REPLAY');
  if (freezeResults !== undefined
    && freezeResults !== 'development'
    && freezeResults !== 'always'
    && freezeResults !== 'never') {
    throw new DiceRollError('freezeResults uses an unsupported mode', { code: 'INVALID_LIMIT' });
  }
  if (randomAlgorithm !== undefined
    && randomAlgorithm !== 'mt19937'
    && randomAlgorithm !== 'xoshiro128ss') {
    throw new DiceRollError('The requested random algorithm is not supported', {
      code: 'INVALID_REPLAY',
    });
  }
  return { cache, freezeResults, limits, randomAlgorithm };
}

function resolveCallLimits(engineLimits: DiceLimits, overrides: unknown): DiceLimits {
  return overrides === undefined
    ? engineLimits
    : resolveDiceLimits(engineLimits, overrides);
}

function replayForPlan(replay: unknown, plan: RollPlan): ReplayDescriptor {
  return validateReplayDescriptor(replay, plan.planFingerprint);
}

function readExternalPlan(value: unknown): ExternalPlanEnvelope {
  try {
    if (!isObject(value)
      || readProperty(value, 'type') !== 'roll-plan'
      || readProperty(value, 'schemaVersion') !== 3
      || readProperty(value, 'compilerVersion') !== 1) {
      throw new DiceRollError('Roll plan is invalid or uses an unsupported schema', {
        code: 'UNSUPPORTED_NOTATION',
      });
    }
    const input = readProperty(value, 'input');
    const planFingerprint = readProperty(value, 'planFingerprint');
    if (typeof input !== 'string' || typeof planFingerprint !== 'string'
      || planFingerprint.length !== 32
      || !/^[0-9a-f]{32}$/u.test(planFingerprint)) {
      throw new DiceRollError('Roll plan envelope is malformed', {
        code: 'UNSUPPORTED_NOTATION',
      });
    }
    return { input, planFingerprint };
  } catch (error: unknown) {
    if (isDiceRollError(error)) {
      throw error;
    }
    throw new DiceRollError('Roll plan could not be read safely', {
      code: 'UNSUPPORTED_NOTATION',
      details: { cause: error instanceof Error ? error.message : 'External plan access failed' },
    });
  }
}

function validInspection(plan: RollPlan): DiceNotationInspection {
  return {
    type: 'dice-notation-inspection',
    input: plan.input,
    notation: plan.notation,
    normalizedNotation: plan.normalizedNotation,
    comment: plan.comment,
    isValid: true,
    plan,
    groups: plan.groups,
    cost: plan.cost,
    error: null,
  };
}

function invalidInspection(input: string, error: unknown): DiceNotationInspection {
  const safeInput = typeof input === 'string' ? input : '';
  const normalizedError = isDiceRollError(error)
    ? error
    : new DiceRollError('Invalid dice notation', {
        code: 'INVALID_NOTATION',
        input: safeInput,
        details: { cause: error instanceof Error ? error.message : 'Unknown compiler error' },
      });
  const normalized = normalizedError.code === 'INPUT_TOO_LONG'
    ? {
        input: safeInput,
        notation: '',
        normalizedNotation: '',
        comment: '',
        rollCount: 1,
        isMultiRoll: false,
      }
    : parseNormalizedDiceInput(safeInput);
  return {
    type: 'dice-notation-inspection',
    input: safeInput,
    notation: normalized.notation,
    normalizedNotation: normalized.normalizedNotation,
    comment: normalized.comment,
    isValid: false,
    plan: null,
    groups: [],
    cost: null,
    error: normalizedError,
  };
}

class DefaultDiceEngine implements DiceEngine {
  readonly limits: DiceLimits;

  private readonly freezeResults: FreezeResultsMode;

  private readonly randomAlgorithm: RandomAlgorithm;

  private readonly inputCache: WeightedLruCache<string, RollPlan>;

  private readonly programCache: WeightedLruCache<string, CompiledDiceProgram>;

  private readonly ownedPlans = new WeakSet<RollPlan>();

  constructor(options: DiceEngineOptions) {
    const runtimeOptions = readRuntimeEngineOptions(options);
    this.limits = createDiceLimits(runtimeOptions.limits ?? {});
    this.freezeResults = runtimeOptions.freezeResults ?? 'never';
    this.randomAlgorithm = runtimeOptions.randomAlgorithm ?? 'mt19937';
    const cache = resolveCacheOptions(runtimeOptions.cache);
    this.inputCache = new WeightedLruCache(
      cache.maxInputEntries,
      UNBOUNDED_ENTRY_WEIGHT,
    );
    this.programCache = new WeightedLruCache(
      cache.maxProgramEntries,
      cache.maxProgramNodes,
    );
  }

  clearCache(): void {
    this.inputCache.clear();
    this.programCache.clear();
  }

  getCacheStats(): DiceCacheStats {
    const input = this.inputCache.stats();
    const program = this.programCache.stats();
    return {
      inputEntries: input.entries,
      programEntries: program.entries,
      programNodes: program.weight,
      hits: input.hits + program.hits,
      misses: input.misses + program.misses,
      evictions: input.evictions + program.evictions,
    };
  }

  compile(input: string, options: CompileOptions = {}): RollPlan {
    if (typeof input !== 'string') {
      throw new DiceRollError('Dice input must be a string', {
        code: 'INVALID_NOTATION',
        details: { receivedType: typeof input },
      });
    }
    const limits = resolveCallLimits(this.limits, readCompileLimits(options));
    if (input.length > limits.maxInputLength) {
      throw new DiceRollError('Dice input exceeds the configured length limit', {
        code: 'INPUT_TOO_LONG',
        input,
        details: { actual: input.length, limit: limits.maxInputLength },
      });
    }
    const key = inputCacheKey(input, limits);
    const cached = this.inputCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const prepared = prepareDicePlanInput(input, limits);
    const programKey = prepared.normalized.notation;
    let program = this.programCache.get(programKey);
    if (program === undefined) {
      program = compileDiceProgram(programKey, input, limits);
      this.programCache.set(programKey, program, program.nodeCount);
    }
    const plan = compilePreparedDicePlan(prepared, limits, program);
    this.ownedPlans.add(plan);
    this.inputCache.set(key, plan);
    return plan;
  }

  inspect(input: string, options: CompileOptions = {}): DiceNotationInspection {
    try {
      return validInspection(this.compile(input, options));
    } catch (error: unknown) {
      return invalidInspection(input, error);
    }
  }

  normalize(input: string): string {
    return normalizeRpgDiceNotation(input);
  }

  roll(input: string | RollPlan, options: RollOptions = {}): DiceRollResult {
    const runtimeOptions = readRuntimeRollOptions(options);
    const limits = resolveCallLimits(this.limits, runtimeOptions.limits);
    const plan = this.resolvePlan(input, limits);
    const result = runtimeOptions.replay !== undefined
      ? executeRollPlan(plan, { limits, replay: replayForPlan(runtimeOptions.replay, plan) })
      : runtimeOptions.seed === undefined
        ? executeRollPlan(plan, {
            limits,
            randomAlgorithm: runtimeOptions.randomAlgorithm ?? this.randomAlgorithm,
          })
        : executeRollPlan(plan, {
            limits,
            seed: runtimeOptions.seed,
            randomAlgorithm: runtimeOptions.randomAlgorithm ?? this.randomAlgorithm,
          });
    return shouldFreezeResults(this.freezeResults) ? freezeDiceRollResult(result) : result;
  }

  rollSummary(input: string | RollPlan, options: RollOptions = {}): DiceRollSummary {
    const runtimeOptions = readRuntimeRollOptions(options);
    const limits = resolveCallLimits(this.limits, runtimeOptions.limits);
    const plan = this.resolvePlan(input, limits);
    const result = runtimeOptions.replay !== undefined
      ? executeRollPlanSummary(plan, {
          limits,
          replay: replayForPlan(runtimeOptions.replay, plan),
        })
      : runtimeOptions.seed === undefined
        ? executeRollPlanSummary(plan, {
            limits,
            randomAlgorithm: runtimeOptions.randomAlgorithm ?? this.randomAlgorithm,
          })
        : executeRollPlanSummary(plan, {
            limits,
            seed: runtimeOptions.seed,
            randomAlgorithm: runtimeOptions.randomAlgorithm ?? this.randomAlgorithm,
          });
    return shouldFreezeResults(this.freezeResults) ? freezeDiceRollSummary(result) : result;
  }

  verify(input: string, options: CompileOptions = {}): boolean {
    return this.inspect(input, options).isValid;
  }

  private resolvePlan(input: string | RollPlan, limits: DiceLimits): RollPlan {
    if (typeof input === 'string') {
      return this.compile(input, { limits });
    }
    if (hasPlanProgram(input)) {
      if (!this.ownedPlans.has(input) || limits !== this.limits) {
        validateKnownPlan(input, limits);
      }
      return input;
    }
    const envelope = readExternalPlan(input);
    const plan = this.compile(envelope.input, { limits });
    if (envelope.planFingerprint !== plan.planFingerprint) {
      throw new DiceRollError('Roll plan does not match its source input', {
        code: 'UNSUPPORTED_NOTATION',
        input: envelope.input,
        details: {
          expectedFingerprint: plan.planFingerprint,
          receivedFingerprint: envelope.planFingerprint,
        },
      });
    }
    return plan;
  }
}

export function createDiceEngine(options: DiceEngineOptions = {}): DiceEngine {
  return new DefaultDiceEngine(options);
}

const defaultDiceEngine = createDiceEngine();

export function compileRpgDice(input: string, options: CompileOptions = {}): RollPlan {
  return defaultDiceEngine.compile(input, options);
}

export function inspectRpgDiceNotation(
  input: string,
  options: CompileOptions = {},
): DiceNotationInspection {
  return defaultDiceEngine.inspect(input, options);
}

export function rollRpgDice(
  input: string | RollPlan,
  options: RollOptions = {},
): DiceRollResult {
  return defaultDiceEngine.roll(input, options);
}

export function rollRpgDiceSummary(
  input: string | RollPlan,
  options: RollOptions = {},
): DiceRollSummary {
  return defaultDiceEngine.rollSummary(input, options);
}

export function verifyRpgDiceNotation(input: string, options: CompileOptions = {}): boolean {
  return defaultDiceEngine.verify(input, options);
}
