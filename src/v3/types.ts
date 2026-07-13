import type { DiceRollError, SourceSpan } from './errors.js';
import type { DiceLimits } from './runtime/limits.js';
import type {
  RandomAlgorithm,
  ReplayDescriptor,
  SeedInput,
} from './runtime/replay.js';

export type DiceSides = number | 'F';

export type DiceState =
  | 'compound'
  | 'critical-failure'
  | 'critical-success'
  | 'dropped'
  | 'exploded'
  | 'maximum'
  | 'minimum'
  | 'penetrated'
  | 'rerolled'
  | 'target-failure'
  | 'target-neutral'
  | 'target-success'
  | 'unique-rerolled';

export type GroupState = 'dropped' | 'sorted-ascending' | 'sorted-descending';

export interface DiceInspectionCost {
  readonly staticDice: number;
  readonly worstCaseGeneratedDice: number;
  readonly worstCaseRandomCalls: number;
  readonly totalStaticDice: number;
  readonly totalWorstCaseGeneratedDice: number;
  readonly totalWorstCaseRandomCalls: number;
}

export interface RollPlanGroup {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly kind: 'dice' | 'expression' | 'function' | 'group';
  readonly notation: string;
  readonly span: SourceSpan;
  readonly childIds: readonly string[];
}

export interface RollPlan {
  readonly type: 'roll-plan';
  readonly schemaVersion: 3;
  readonly compilerVersion: 1;
  readonly planFingerprint: string;
  readonly input: string;
  readonly comment: string;
  readonly notation: string;
  readonly normalizedNotation: string;
  readonly isMultiRoll: boolean;
  readonly rollCount: number;
  readonly groups: readonly RollPlanGroup[];
  readonly cost: DiceInspectionCost;
}

export interface EntityRange {
  readonly start: number;
  readonly count: number;
}

export interface ResolvedDie {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly parentDieId: string | null;
  readonly rollIndex: number;
  readonly rollDieIndex: number;
  readonly groupId: string;
  readonly sides: DiceSides;
  readonly rawValue: number;
  readonly value: number;
  readonly contribution: number;
  readonly included: boolean;
  readonly states: readonly DiceState[];
}

export interface ResolvedGroup {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly rollIndex: number;
  readonly kind: 'dice' | 'expression' | 'function' | 'group';
  readonly notation: string;
  readonly span: SourceSpan;
  readonly value: number;
  readonly contribution: number;
  readonly included: boolean;
  readonly states: readonly GroupState[];
  readonly childIds: readonly string[];
}

export interface PoolSummary {
  readonly successes: number;
  readonly failures: number;
  readonly netSuccesses: number;
}

interface EventBase {
  readonly sequence: number;
  readonly rollIndex: number;
  readonly sourceNodeId: string;
}

interface DieEventBase extends EventBase {
  readonly subject: 'die';
  readonly dieId: string;
  readonly parentDieId: string | null;
}

interface GroupEventBase extends EventBase {
  readonly subject: 'group';
  readonly groupId: string;
}

export interface RollDiceEvent extends DieEventBase {
  readonly type: 'roll';
  readonly value: number;
}

export interface RerollDiceEvent extends DieEventBase {
  readonly type: 'reroll';
  readonly from: number;
  readonly to: number;
  readonly reason: 'reroll' | 'reroll-once' | 'unique' | 'unique-once';
}

export interface ExplodeDiceEvent extends DieEventBase {
  readonly type: 'explode';
  readonly childDieId: string;
  readonly value: number;
  readonly reason: 'explode' | 'compound' | 'penetrate';
}

export interface TransformDiceEvent extends DieEventBase {
  readonly type: 'transform';
  readonly from: number;
  readonly to: number;
  readonly reason: 'minimum' | 'maximum' | 'penetrate' | 'compound';
}

export interface TransformGroupEvent extends GroupEventBase {
  readonly type: 'transform';
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly reason: 'sort-ascending' | 'sort-descending';
}

export interface IncludeDiceEvent extends DieEventBase {
  readonly type: 'include';
  readonly contribution: number;
}

export interface IncludeGroupEvent extends GroupEventBase {
  readonly type: 'include';
  readonly value: number;
  readonly contribution: number;
}

export interface ExcludeDiceEvent extends DieEventBase {
  readonly type: 'exclude';
  readonly reason: 'drop' | 'keep' | 'compound-absorbed';
}

export interface ExcludeGroupEvent extends GroupEventBase {
  readonly type: 'exclude';
  readonly value: number;
  readonly reason: 'drop' | 'keep';
}

export interface ClassifyDiceEvent extends DieEventBase {
  readonly type: 'classify';
  readonly outcome:
    | 'success'
    | 'failure'
    | 'neutral'
    | 'critical-success'
    | 'critical-failure';
}

export type DiceEvent =
  | RollDiceEvent
  | RerollDiceEvent
  | ExplodeDiceEvent
  | TransformDiceEvent
  | TransformGroupEvent
  | IncludeDiceEvent
  | IncludeGroupEvent
  | ExcludeDiceEvent
  | ExcludeGroupEvent
  | ClassifyDiceEvent;

export interface ExecutionStats {
  readonly rolls: number;
  readonly initialDice: number;
  readonly generatedDice: number;
  readonly randomCalls: number;
  readonly modifierSteps: number;
  readonly events: number;
  readonly resolvedGroups: number;
  readonly resultItems: number;
}

export interface ResolvedRoll {
  readonly index: number;
  readonly total: number;
  readonly pool: PoolSummary | null;
  readonly diceRange: EntityRange;
  readonly groupRange: EntityRange;
  readonly eventRange: EntityRange;
}

interface RollResultBase {
  readonly schemaVersion: 3;
  readonly input: string;
  readonly notation: string;
  readonly normalizedNotation: string;
  readonly comment: string;
  readonly total: number;
  readonly replay: ReplayDescriptor;
  readonly stats: ExecutionStats;
  readonly pool: PoolSummary | null;
}

export interface DiceRollResult extends RollResultBase {
  readonly type: 'dice-roll';
  readonly output: string;
  readonly rolls: readonly ResolvedRoll[];
  readonly groups: readonly ResolvedGroup[];
  readonly dice: readonly ResolvedDie[];
  readonly events: readonly DiceEvent[];
}

export interface ResolvedRollSummary {
  readonly index: number;
  readonly total: number;
  readonly pool: PoolSummary | null;
}

export interface DiceRollSummary extends RollResultBase {
  readonly type: 'dice-roll-summary';
  readonly rolls: readonly ResolvedRollSummary[];
}

interface DiceNotationInspectionBase {
  readonly type: 'dice-notation-inspection';
  readonly input: string;
  readonly notation: string;
  readonly normalizedNotation: string;
  readonly comment: string;
}

interface ValidDiceNotationInspection extends DiceNotationInspectionBase {
  readonly isValid: true;
  readonly plan: RollPlan;
  readonly groups: readonly RollPlanGroup[];
  readonly cost: DiceInspectionCost;
  readonly error: null;
}

interface InvalidDiceNotationInspection extends DiceNotationInspectionBase {
  readonly isValid: false;
  readonly plan: null;
  readonly groups: readonly RollPlanGroup[];
  readonly cost: null;
  readonly error: DiceRollError;
}

export type DiceNotationInspection =
  | ValidDiceNotationInspection
  | InvalidDiceNotationInspection;

export type FreezeResultsMode = 'development' | 'always' | 'never';

export interface DiceCacheOptions {
  readonly maxInputEntries?: number;
  readonly maxProgramEntries?: number;
  readonly maxProgramNodes?: number;
}

export interface DiceCacheStats {
  readonly inputEntries: number;
  readonly programEntries: number;
  readonly programNodes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

export interface DiceEngineOptions {
  readonly limits?: Partial<DiceLimits>;
  readonly freezeResults?: FreezeResultsMode;
  readonly cache?: false | DiceCacheOptions;
  readonly randomAlgorithm?: RandomAlgorithm;
}

export interface CompileOptions {
  readonly limits?: Partial<DiceLimits>;
}

type SeededRollOptions = {
  readonly seed?: SeedInput;
  readonly replay?: never;
  readonly randomAlgorithm?: RandomAlgorithm;
};

type ReplayRollOptions = {
  readonly seed?: never;
  readonly replay: ReplayDescriptor;
  readonly randomAlgorithm?: never;
};

export type RollOptions = CompileOptions & (SeededRollOptions | ReplayRollOptions);

export interface DiceEngine {
  readonly limits: DiceLimits;
  clearCache(): void;
  compile(input: string, options?: CompileOptions): RollPlan;
  getCacheStats(): DiceCacheStats;
  inspect(input: string, options?: CompileOptions): DiceNotationInspection;
  normalize(input: string): string;
  roll(input: string | RollPlan, options?: RollOptions): DiceRollResult;
  rollSummary(input: string | RollPlan, options?: RollOptions): DiceRollSummary;
  verify(input: string, options?: CompileOptions): boolean;
}
