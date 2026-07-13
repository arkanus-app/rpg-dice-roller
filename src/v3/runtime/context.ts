import type { DiceEventSink } from './journal.js';
import { ExecutionJournal } from './journal.js';
import { ExecutionBudget } from './budget.js';
import { createDiceLimits, type DiceLimitOverrides, type DiceLimits } from './limits.js';
import { MersenneTwister19937, type RandomSource } from './mt19937.js';
import {
  createReplayDescriptor,
  createReplaySeed,
  createSeedMaterial,
  validateReplayDescriptor,
  type CryptoSource,
  type RandomAlgorithm,
  type ReplayDescriptor,
  type SeedInput,
  type SeedMaterial,
} from './replay.js';
import { Xoshiro128StarStar } from './xoshiro128ss.js';
import { DiceRollError } from '../errors.js';

export interface ExecutionContextOptions {
  readonly limits?: DiceLimits | DiceLimitOverrides;
  /** Already resolved immutable limits used by the engine hot path. */
  readonly resolvedLimits?: DiceLimits;
  readonly seed?: SeedInput;
  readonly replay?: ReplayDescriptor;
  readonly randomAlgorithm?: RandomAlgorithm;
  readonly planFingerprint?: string;
  readonly collectEvents?: boolean;
  /** Intended for platform adapters and deterministic tests. */
  readonly cryptoSource?: CryptoSource | null;
}

/** All mutable state for exactly one compilation/execution. */
export class ExecutionContext {
  readonly limits: DiceLimits;

  readonly budget: ExecutionBudget;

  readonly random: RandomSource;

  readonly journal: DiceEventSink;

  readonly replay: ReplayDescriptor;

  constructor(options: ExecutionContextOptions = {}) {
    this.limits = options.resolvedLimits ?? createDiceLimits(options.limits);
    this.budget = new ExecutionBudget(this.limits);
    if (options.seed !== undefined && options.replay !== undefined) {
      throw new DiceRollError('seed and replay are mutually exclusive', {
        code: 'INVALID_REPLAY',
      });
    }
    if (options.replay !== undefined && options.randomAlgorithm !== undefined) {
      throw new DiceRollError('A replay descriptor determines its random algorithm', {
        code: 'INVALID_REPLAY',
      });
    }
    if (options.collectEvents !== undefined && typeof options.collectEvents !== 'boolean') {
      throw new DiceRollError('collectEvents must be a boolean', {
        code: 'ROLL_EXECUTION_LIMIT',
      });
    }

    let algorithm: RandomAlgorithm;
    let seed: SeedMaterial;
    if (options.replay === undefined) {
      algorithm = options.randomAlgorithm ?? 'mt19937';
      if (algorithm !== 'mt19937' && algorithm !== 'xoshiro128ss') {
        throw new DiceRollError('The requested random algorithm is not supported', {
          code: 'INVALID_REPLAY',
        });
      }
      seed = createSeedMaterial(
        options.seed,
        options.cryptoSource,
        this.limits.maxSeedLength,
      );
      this.replay = createReplayDescriptor(seed, {
        algorithm,
        ...(options.planFingerprint === undefined
          ? {}
          : { planFingerprint: options.planFingerprint }),
      });
    } else {
      const replay = validateReplayDescriptor(options.replay, options.planFingerprint);
      algorithm = replay.algorithm;
      seed = createReplaySeed(replay, options.planFingerprint);
      this.replay = replay;
    }
    this.random = algorithm === 'mt19937'
      ? new MersenneTwister19937(seed.words, this.budget)
      : new Xoshiro128StarStar(seed.words, this.budget);
    this.journal = new ExecutionJournal(this.budget, options.collectEvents ?? true);
  }
}

export function createExecutionContext(options: ExecutionContextOptions = {}): ExecutionContext {
  return new ExecutionContext(options);
}
