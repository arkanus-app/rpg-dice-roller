package dicecore

const maxSafeInteger int64 = 9_007_199_254_740_991

// DiceLimits are value-owned caps. A caller cannot mutate an existing budget by
// changing the struct from which it was created.
type DiceLimits struct {
	MaxInputLength    int64 `json:"maxInputLength"`
	MaxAstDepth       int64 `json:"maxAstDepth"`
	MaxAstNodes       int64 `json:"maxAstNodes"`
	MaxRolls          int64 `json:"maxRolls"`
	MaxInitialDice    int64 `json:"maxInitialDice"`
	MaxGeneratedDice  int64 `json:"maxGeneratedDice"`
	MaxRandomCalls    int64 `json:"maxRandomCalls"`
	MaxEvents         int64 `json:"maxEvents"`
	MaxSides          int64 `json:"maxSides"`
	MaxSeedLength     int64 `json:"maxSeedLength"`
	MaxModifierSteps  int64 `json:"maxModifierSteps"`
	MaxResolvedGroups int64 `json:"maxResolvedGroups"`
	MaxResultItems    int64 `json:"maxResultItems"`
	MaxOutputLength   int64 `json:"maxOutputLength"`
}

// DiceLimitOverrides distinguishes an omitted field from an invalid zero cap.
type DiceLimitOverrides map[string]int64

func DefaultDiceLimits() DiceLimits {
	return DiceLimits{4096, 64, 10_000, 100, 10_000, 20_000, 100_000, 100_000,
		1 << 32, 1024, 100_000, 100_000, 250_000, 1_000_000}
}

func TrustedServerDiceLimits() DiceLimits {
	return DiceLimits{2048, 64, 5000, 100, 5000, 10_000, 50_000, 50_000,
		1 << 32, 1024, 50_000, 50_000, 125_000, 500_000}
}

func UntrustedServerDiceLimits() DiceLimits {
	return DiceLimits{1000, 32, 1000, 50, 500, 1000, 5000, 10_000,
		1_000_000, 256, 5000, 10_000, 25_000, 100_000}
}

type limitField struct {
	name  string
	value *int64
}

func limitFields(limits *DiceLimits) []limitField {
	return []limitField{
		{"maxInputLength", &limits.MaxInputLength}, {"maxAstDepth", &limits.MaxAstDepth},
		{"maxAstNodes", &limits.MaxAstNodes}, {"maxRolls", &limits.MaxRolls},
		{"maxInitialDice", &limits.MaxInitialDice}, {"maxGeneratedDice", &limits.MaxGeneratedDice},
		{"maxRandomCalls", &limits.MaxRandomCalls}, {"maxEvents", &limits.MaxEvents},
		{"maxSides", &limits.MaxSides}, {"maxSeedLength", &limits.MaxSeedLength},
		{"maxModifierSteps", &limits.MaxModifierSteps}, {"maxResolvedGroups", &limits.MaxResolvedGroups},
		{"maxResultItems", &limits.MaxResultItems}, {"maxOutputLength", &limits.MaxOutputLength},
	}
}

func validateLimit(name string, value int64) error {
	if value < 1 || value > maxSafeInteger {
		return newDiceError("INVALID_LIMIT", name+" must be a positive safe integer", "",
			map[string]any{"limit": name, "value": value})
	}
	return nil
}

// Validate checks caps assembled directly as a Go struct.
func (limits DiceLimits) Validate() error {
	for _, field := range limitFields(&limits) {
		if err := validateLimit(field.name, *field.value); err != nil {
			return err
		}
	}
	return nil
}

// CreateDiceLimits creates engine caps from defaults. Unlike per-call overrides,
// engine caps may be raised to another positive, JavaScript-safe integer.
func CreateDiceLimits(overrides DiceLimitOverrides) (DiceLimits, error) {
	limits := DefaultDiceLimits()
	for _, field := range limitFields(&limits) {
		if value, ok := overrides[field.name]; ok {
			if err := validateLimit(field.name, value); err != nil {
				return DiceLimits{}, err
			}
			*field.value = value
		}
	}
	return limits, nil
}

// ResolveDiceLimits allows a call to lower engine caps, never to raise them.
func ResolveDiceLimits(engine DiceLimits, overrides DiceLimitOverrides) (DiceLimits, error) {
	if err := engine.Validate(); err != nil {
		return DiceLimits{}, err
	}
	for _, field := range limitFields(&engine) {
		if value, ok := overrides[field.name]; ok {
			if err := validateLimit(field.name, value); err != nil {
				return DiceLimits{}, err
			}
			if value > *field.value {
				return DiceLimits{}, newDiceError("INVALID_LIMIT", field.name+" cannot exceed the engine cap", "",
					map[string]any{"limit": field.name, "requested": value, "engineCap": *field.value})
			}
			*field.value = value
		}
	}
	return engine, nil
}
