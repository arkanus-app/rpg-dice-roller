export {
  ASSIMILATION_D6_PROFILE,
  ASSIMILATION_D10_PROFILE,
  ASSIMILATION_D12_PROFILE,
  evaluateAssimilationSelection,
  rollAssimilation,
} from './assimilation.js';
export {
  VAMPIRE_V5_HUNGER_D10_PROFILE,
  VAMPIRE_V5_NORMAL_D10_PROFILE,
  rollVampireV5,
} from './vampire-v5.js';
export {
  FATE_DF_PROFILE,
  rollFateDice,
} from './fate.js';
export { rollMixedDice } from './mixed.js';

export type {
  AssimilationDieKind,
  AssimilationDieResult,
  AssimilationFaceKey,
  AssimilationProfileId,
  AssimilationRollInput,
  AssimilationRollResult,
  AssimilationSelectionResult,
  AssimilationSymbol,
} from './assimilation.js';
export type {
  DiceSystemId,
  SystemDieResult,
} from './common.js';
export type {
  FateDieKind,
  FateDieResult,
  FateFaceKey,
  FateRollInput,
  FateRollResult,
  FateSymbol,
  FateValue,
} from './fate.js';
export type {
  MixedAssimilationRollItem,
  MixedFateRollItem,
  MixedGenericDieResult,
  MixedGenericRollItem,
  MixedRollDieResult,
  MixedRollItem,
  MixedRollKind,
  MixedRollOptions,
  MixedRollReplayDescriptor,
  MixedRollReplayEntry,
  MixedRollResult,
  MixedSystemDieResult,
  MixedVampireV5RollItem,
} from './mixed.js';
export type {
  VampireV5DieKind,
  VampireV5DieResult,
  VampireV5FaceKey,
  VampireV5HungerDieResult,
  VampireV5HungerFaceKey,
  VampireV5NormalDieResult,
  VampireV5NormalFaceKey,
  VampireV5Outcome,
  VampireV5RollInput,
  VampireV5RollResult,
  VampireV5Symbol,
} from './vampire-v5.js';
