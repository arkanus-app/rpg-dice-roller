package dicecore

import "io"

// ExecutionContextOptions controls one execution's independent mutable state.
type ExecutionContextOptions struct {
	Limits               *DiceLimits
	LimitOverrides       DiceLimitOverrides
	ResolvedLimits       *DiceLimits
	Seed                 any
	Replay               any
	RandomAlgorithm      RandomAlgorithm
	PlanFingerprint      string
	CollectEvents        *bool
	CryptoSource         io.Reader
	CryptoSourceProvided bool
}

type ExecutionContext struct {
	Limits  DiceLimits
	Budget  *ExecutionBudget
	Random  RandomSource
	Journal *ExecutionJournal
	Replay  ReplayDescriptor
}

func CreateExecutionContext(options ...ExecutionContextOptions) (*ExecutionContext, error) {
	var option ExecutionContextOptions
	if len(options) > 0 {
		option = options[0]
	}
	limits := DefaultDiceLimits()
	if option.ResolvedLimits != nil {
		limits = *option.ResolvedLimits
	} else if option.Limits != nil {
		limits = *option.Limits
		if err := limits.Validate(); err != nil {
			return nil, err
		}
	} else {
		var err error
		limits, err = CreateDiceLimits(option.LimitOverrides)
		if err != nil {
			return nil, err
		}
	}
	if option.Seed != nil && option.Replay != nil {
		return nil, newDiceError("INVALID_REPLAY", "seed and replay are mutually exclusive", "", nil)
	}
	if option.Replay != nil && option.RandomAlgorithm != "" {
		return nil, newDiceError("INVALID_REPLAY", "A replay descriptor determines its random algorithm", "", nil)
	}
	context := &ExecutionContext{Limits: limits, Budget: NewExecutionBudget(limits)}
	var seed SeedMaterial
	var algorithm RandomAlgorithm
	var err error
	if option.Replay == nil {
		algorithm = option.RandomAlgorithm
		if algorithm == "" {
			algorithm = MT19937
		}
		if !supportedRandomAlgorithm(algorithm) {
			return nil, newDiceError("INVALID_REPLAY", "The requested random algorithm is not supported", "", nil)
		}
		if option.Seed != nil {
			seed, err = CreateProvidedSeed(option.Seed, limits.MaxSeedLength)
		} else if option.CryptoSourceProvided || option.CryptoSource != nil {
			seed, err = CreateAutomaticSeed(option.CryptoSource)
		} else {
			seed, err = CreateAutomaticSeed()
		}
		if err != nil {
			return nil, err
		}
		context.Replay, err = CreateReplayDescriptor(seed, ReplayDescriptorOptions{Algorithm: algorithm, PlanFingerprint: option.PlanFingerprint})
	} else {
		var restored ReplayState
		if option.PlanFingerprint != "" {
			restored, err = CreateReplayState(option.Replay, option.PlanFingerprint)
		} else {
			restored, err = CreateReplayState(option.Replay)
		}
		seed, context.Replay = restored.Seed, restored.Replay
		algorithm = restored.Replay.Algorithm
	}
	if err != nil {
		return nil, err
	}
	return initializeExecutionContextRandom(context, algorithm, seed.Words[:], option.CollectEvents)
}

// Initializing the generator is separate from resolving seed/replay material;
// generator validation errors leave no partially initialized context available.
func initializeExecutionContextRandom(context *ExecutionContext, algorithm RandomAlgorithm, words []uint32, collectEvents *bool) (*ExecutionContext, error) {
	var err error
	if algorithm == MT19937 {
		context.Random, err = NewMersenneTwister19937FromWords(words, context.Budget)
	} else {
		context.Random, err = NewXoshiro128StarStar(words, context.Budget)
	}
	if err != nil {
		return nil, err
	}
	materialize := true
	if collectEvents != nil {
		materialize = *collectEvents
	}
	context.Journal = NewExecutionJournal(context.Budget, materialize)
	return context, nil
}
