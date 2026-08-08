export {
  compileRpgDice,
  createDiceEngine,
  inspectRpgDiceNotation,
  rollRpgDice,
  rollRpgDiceDetails,
  rollRpgDiceSummary,
  verifyRpgDiceNotation,
} from './engine.js';
export {
  DiceRollError,
  isDiceRollError,
  isDiceRollErrorData,
} from './errors.js';
export { normalizeRpgDiceNotation } from './normalization.js';
export { DEFAULT_DICE_LIMITS, DICE_LIMIT_PRESETS } from './runtime/limits.js';

export type {
  DiceErrorData,
  DiceRollErrorCode,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  SourceSpan,
} from './errors.js';
export type { DiceLimits, DiceLimitPreset } from './runtime/limits.js';
export type {
  RandomAlgorithm,
  ReplayDescriptor,
  SeedInput,
  SeedOrigin,
} from './runtime/replay.js';
export type {
  ClassifyDiceEvent,
  CompileOptions,
  DiceCacheOptions,
  DiceCacheStats,
  DiceEngine,
  DiceEngineOptions,
  DiceEvent,
  DiceInspectionCost,
  DiceNotationInspection,
  DiceRollResult,
  DiceRollDetails,
  DiceRollSummary,
  DiceSides,
  DiceState,
  EntityRange,
  ExcludeDiceEvent,
  ExcludeGroupEvent,
  ExplodeDiceEvent,
  FreezeResultsMode,
  GroupState,
  IncludeDiceEvent,
  IncludeGroupEvent,
  ExecutionStats,
  PoolSummary,
  RerollDiceEvent,
  ResolvedDie,
  ResolvedGroup,
  ResolvedRoll,
  ResolvedRollSummary,
  RollDiceEvent,
  RollOptions,
  RollPlan,
  RollPlanGroup,
  TransformDiceEvent,
  TransformGroupEvent,
} from './types.js';
