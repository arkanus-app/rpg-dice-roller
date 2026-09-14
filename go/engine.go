package dicecore

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

// Engine owns bounded compilation caches. Rolls have independent execution state
// and may run concurrently. Public plans and results are caller-owned values.
type Engine struct {
	limits       DiceLimits
	algorithm    RandomAlgorithm
	freezeMode   FreezeResultsMode
	mu           sync.Mutex
	inputCache   *WeightedLruCache[engineInputKey, *RollPlan]
	programCache *WeightedLruCache[string, *CompiledDiceProgram]
}

func resolveEngineCache(options any) ([3]int64, error) {
	caps := [3]int64{500, 200, 100000}
	if disabled, ok := options.(bool); ok && !disabled {
		return [3]int64{}, nil
	}
	var overrides DiceCacheOptions
	switch value := options.(type) {
	case nil:
	case DiceCacheOptions:
		overrides = value
	default:
		return caps, fmt.Errorf("cache must be false or a cache options object")
	}
	for index, key := range []string{"maxInputEntries", "maxProgramEntries", "maxProgramNodes"} {
		if value, ok := overrides[key]; ok {
			if value < 0 || value > maxSafeInteger {
				return caps, fmt.Errorf("%s must be a non-negative safe integer", key)
			}
			caps[index] = value
		}
	}
	return caps, nil
}

func CreateDiceEngine(options ...DiceEngineOptions) (*Engine, error) {
	if len(options) > 1 {
		return nil, newDiceError("INVALID_LIMIT", "Only one engine options value may be provided", "", nil)
	}
	var option DiceEngineOptions
	if len(options) == 1 {
		option = options[0]
	}
	if option.FreezeResults != "" && option.FreezeResults != "always" && option.FreezeResults != "never" && option.FreezeResults != "development" {
		return nil, newDiceError("INVALID_LIMIT", "freezeResults uses an unsupported mode", "", nil)
	}
	if option.RandomAlgorithm != "" && !supportedRandomAlgorithm(option.RandomAlgorithm) {
		return nil, newDiceError("INVALID_REPLAY", "The requested random algorithm is not supported", "", nil)
	}
	limits, err := CreateDiceLimits(option.Limits)
	if err != nil {
		return nil, err
	}
	caps, err := resolveEngineCache(option.Cache)
	if err != nil {
		return nil, err
	}
	algorithm := option.RandomAlgorithm
	if algorithm == "" {
		algorithm = MT19937
	}
	freeze := option.FreezeResults
	if freeze == "" {
		freeze = "never"
	}
	return &Engine{limits: limits, algorithm: algorithm, freezeMode: freeze,
		inputCache:   NewWeightedLruCache[engineInputKey, *RollPlan](caps[0], maxSafeInteger),
		programCache: NewWeightedLruCache[string, *CompiledDiceProgram](caps[1], caps[2])}, nil
}

var sharedDiceEngine = sync.OnceValue(func() *Engine {
	engine, _ := CreateDiceEngine()
	return engine
})

func DefaultDiceEngine() *Engine          { return sharedDiceEngine() }
func (engine *Engine) Limits() DiceLimits { return engine.limits }

func (engine *Engine) ClearCache() {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	engine.inputCache.Clear()
	engine.programCache.Clear()
}

func (engine *Engine) GetCacheStats() DiceCacheStats {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	input, program := engine.inputCache.Stats(), engine.programCache.Stats()
	return DiceCacheStats{InputEntries: input.Entries, ProgramEntries: program.Entries, ProgramNodes: program.Weight,
		Hits: input.Hits + program.Hits, Misses: input.Misses + program.Misses, Evictions: input.Evictions + program.Evictions}
}

// A native comparable key avoids formatting seven integers and allocating a
// concatenated string for every cache hit. The dimensions match the compiler.
type engineInputKey struct {
	input  string
	limits [7]int64
}

func engineLimitsKey(input string, limits DiceLimits) engineInputKey {
	return engineInputKey{input, [7]int64{limits.MaxInputLength, limits.MaxAstDepth, limits.MaxAstNodes,
		limits.MaxRolls, limits.MaxInitialDice, limits.MaxSides, limits.MaxModifierSteps}}
}

// cloneEnginePlan keeps the cache's canonical plan private while preserving the
// compiler binding. Caller mutation cannot affect later compilations or rolls.
func cloneEnginePlan(plan *RollPlan) *RollPlan {
	clone := *plan
	clone.Groups = make([]RollPlanGroup, len(plan.Groups))
	for index, group := range plan.Groups {
		clone.Groups[index] = group
		clone.Groups[index].ChildIDs = append([]string{}, group.ChildIDs...)
	}
	clone.identity = &clone
	clone.canonical = plan
	return &clone
}

func (engine *Engine) Compile(input string, options ...CompileOptions) (*RollPlan, error) {
	if len(options) > 1 {
		return nil, newDiceError("INVALID_LIMIT", "Only one compile options value may be provided", "", nil)
	}
	var overrides DiceLimitOverrides
	if len(options) == 1 {
		overrides = options[0].Limits
	}
	limits, err := engine.resolveLimits(overrides)
	if err != nil {
		return nil, err
	}
	plan, err := engine.compileResolved(input, limits)
	if err != nil {
		return nil, err
	}
	return cloneEnginePlan(plan), nil
}

func (engine *Engine) resolveLimits(overrides DiceLimitOverrides) (DiceLimits, error) {
	// Constructor-owned limits are already validated and immutable. Keep the
	// full validation path for per-call overrides and an uninitialized Engine.
	if len(overrides) == 0 && engine.inputCache != nil {
		return engine.limits, nil
	}
	return ResolveDiceLimits(engine.limits, overrides)
}

func (engine *Engine) compileResolved(input string, limits DiceLimits) (*RollPlan, error) {
	length := int64(len(syntaxUnits(input)))
	if length > limits.MaxInputLength {
		return nil, newDiceError("INPUT_TOO_LONG", "Dice input exceeds the configured length limit", input,
			map[string]any{"actual": length, "limit": limits.MaxInputLength})
	}
	engine.mu.Lock()
	defer engine.mu.Unlock()
	key := engineLimitsKey(input, limits)
	if cached, ok := engine.inputCache.Get(key); ok {
		return cached, nil
	}
	prepared, err := PrepareDicePlanInput(input, limits)
	if err != nil {
		return nil, err
	}
	programKey := prepared.Normalized.Notation
	program, ok := engine.programCache.Get(programKey)
	if !ok {
		program, err = CompileDiceProgram(programKey, input, limits)
		if err != nil {
			return nil, err
		}
		engine.programCache.Set(programKey, program, program.NodeCount)
	}
	plan, err := BindDicePlan(prepared, program, limits)
	if err != nil {
		return nil, err
	}
	engine.inputCache.Set(key, plan)
	return plan, nil
}

func (engine *Engine) Inspect(input string, options ...CompileOptions) *DiceNotationInspection {
	plan, err := engine.Compile(input, options...)
	if err == nil {
		cost := plan.Cost
		return &DiceNotationInspection{Type: "dice-notation-inspection", Input: plan.Input, Notation: plan.Notation,
			NormalizedNotation: plan.NormalizedNotation, Comment: plan.Comment, IsValid: true, Plan: plan,
			Groups: plan.Groups, Cost: &cost}
	}
	return invalidEngineInspection(input, err)
}

func invalidEngineInspection(input string, err error) *DiceNotationInspection {
	var diceErr *DiceRollError
	if !errors.As(err, &diceErr) {
		diceErr = newDiceError("INVALID_NOTATION", "Invalid dice notation", input, map[string]any{"cause": err.Error()})
	}
	normalized := NormalizedDiceInput{Input: input, RollCount: 1}
	if diceErr.Code != "INPUT_TOO_LONG" {
		normalized = ParseNormalizedInput(input)
	}
	return &DiceNotationInspection{Type: "dice-notation-inspection", Input: input, Notation: normalized.Notation,
		NormalizedNotation: normalized.NormalizedNotation, Comment: normalized.Comment, Groups: []RollPlanGroup{}, Error: diceErr}
}

func (engine *Engine) Normalize(input string) string { return NormalizeRPGDiceNotation(input) }
func (engine *Engine) Verify(input string, options ...CompileOptions) bool {
	return engine.Inspect(input, options...).IsValid
}

func readEngineRollOptions(options []RollOptions) (RollOptions, error) {
	if len(options) > 1 {
		return RollOptions{}, newDiceError("INVALID_REPLAY", "Only one roll options value may be provided", "", nil)
	}
	var option RollOptions
	if len(options) == 1 {
		option = options[0]
	}
	if option.Seed != nil {
		switch option.Seed.(type) {
		case string, UTF16Seed:
		default:
			if _, ok := seedNumber(option.Seed); !ok {
				return option, newDiceError("INVALID_SEED", "Seeds must be finite numbers or strings", "", nil)
			}
		}
	}
	if option.RandomAlgorithm != "" && !supportedRandomAlgorithm(option.RandomAlgorithm) {
		return option, newDiceError("INVALID_REPLAY", "The requested random algorithm is not supported", "", nil)
	}
	if option.Replay != nil && (option.Seed != nil || option.RandomAlgorithm != "") {
		return option, newDiceError("INVALID_REPLAY", "Replay cannot be combined with seed or randomAlgorithm", "", nil)
	}
	return option, nil
}

func (engine *Engine) prepareRoll(input any, options []RollOptions) (*RollPlan, ExecuteRollPlanOptions, error) {
	option, err := readEngineRollOptions(options)
	if err != nil {
		return nil, ExecuteRollPlanOptions{}, err
	}
	limits, err := engine.resolveLimits(option.Limits)
	if err != nil {
		return nil, ExecuteRollPlanOptions{}, err
	}
	plan, err := engine.resolvePlan(input, limits)
	if err != nil {
		return nil, ExecuteRollPlanOptions{}, err
	}
	algorithm := option.RandomAlgorithm
	if option.Replay == nil && algorithm == "" {
		algorithm = engine.algorithm
	}
	return plan, ExecuteRollPlanOptions{Limits: limits, Seed: option.Seed, Replay: option.Replay, RandomAlgorithm: algorithm}, nil
}

func (engine *Engine) Roll(input any, options ...RollOptions) (*DiceRollResult, error) {
	plan, execution, err := engine.prepareRoll(input, options)
	if err != nil {
		return nil, err
	}
	return ExecuteRollPlan(plan, execution)
}

func (engine *Engine) RollDetails(input any, options ...RollOptions) (*DiceRollDetails, error) {
	plan, execution, err := engine.prepareRoll(input, options)
	if err != nil {
		return nil, err
	}
	return ExecuteRollPlanDetails(plan, execution)
}

func (engine *Engine) RollSummary(input any, options ...RollOptions) (*DiceRollSummary, error) {
	plan, execution, err := engine.prepareRoll(input, options)
	if err != nil {
		return nil, err
	}
	return ExecuteRollPlanSummary(plan, execution)
}

func readExternalRollPlan(input any) (string, string, error) {
	var envelope struct {
		Type            string          `json:"type"`
		SchemaVersion   int             `json:"schemaVersion"`
		CompilerVersion int             `json:"compilerVersion"`
		Input           json.RawMessage `json:"input"`
		PlanFingerprint json.RawMessage `json:"planFingerprint"`
	}
	// Inspect only the trusted envelope; unrelated data may contain values that
	// cannot be serialized and is never executable program state.
	if object, ok := input.(map[string]any); ok {
		input = map[string]any{"type": object["type"], "schemaVersion": object["schemaVersion"],
			"compilerVersion": object["compilerVersion"], "input": object["input"], "planFingerprint": object["planFingerprint"]}
	}
	data, err := json.Marshal(input)
	if err != nil {
		return "", "", newDiceError("UNSUPPORTED_NOTATION", "Roll plan could not be read safely", "", map[string]any{"cause": err.Error()})
	}
	if json.Unmarshal(data, &envelope) != nil || envelope.Type != "roll-plan" || envelope.SchemaVersion != 3 || envelope.CompilerVersion != 1 {
		return "", "", newDiceError("UNSUPPORTED_NOTATION", "Roll plan is invalid or uses an unsupported schema", "", nil)
	}
	var notation, fingerprint *string
	if json.Unmarshal(envelope.Input, &notation) != nil || json.Unmarshal(envelope.PlanFingerprint, &fingerprint) != nil ||
		notation == nil || fingerprint == nil || !validReplayHex(*fingerprint) {
		return "", "", newDiceError("UNSUPPORTED_NOTATION", "Roll plan envelope is malformed", "", nil)
	}
	return *notation, *fingerprint, nil
}

func (engine *Engine) resolvePlan(input any, limits DiceLimits) (*RollPlan, error) {
	if notation, ok := input.(string); ok {
		return engine.compileResolved(notation, limits)
	}
	if plan, ok := input.(*RollPlan); ok && HasPlanProgram(plan) {
		if plan.canonical != nil {
			plan = plan.canonical
		}
		if err := ValidatePlanLimits(plan, limits); err != nil {
			return nil, err
		}
		return plan, nil
	}
	notation, fingerprint, err := readExternalRollPlan(input)
	if err != nil {
		return nil, err
	}
	plan, err := engine.compileResolved(notation, limits)
	if err != nil {
		return nil, err
	}
	if fingerprint != plan.PlanFingerprint {
		return nil, newDiceError("UNSUPPORTED_NOTATION", "Roll plan does not match its source input", notation,
			map[string]any{"expectedFingerprint": plan.PlanFingerprint, "receivedFingerprint": fingerprint})
	}
	return plan, nil
}

func CompileRPGDice(input string, options ...CompileOptions) (*RollPlan, error) {
	return DefaultDiceEngine().Compile(input, options...)
}
func InspectRPGDiceNotation(input string, options ...CompileOptions) *DiceNotationInspection {
	return DefaultDiceEngine().Inspect(input, options...)
}
func VerifyRPGDiceNotation(input string, options ...CompileOptions) bool {
	return DefaultDiceEngine().Verify(input, options...)
}
func RollRPGDice(input any, options ...RollOptions) (*DiceRollResult, error) {
	return DefaultDiceEngine().Roll(input, options...)
}
func RollRPGDiceDetails(input any, options ...RollOptions) (*DiceRollDetails, error) {
	return DefaultDiceEngine().RollDetails(input, options...)
}
func RollRPGDiceSummary(input any, options ...RollOptions) (*DiceRollSummary, error) {
	return DefaultDiceEngine().RollSummary(input, options...)
}
