package dicecore

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
)

type RandomAlgorithm string

const (
	MT19937              RandomAlgorithm = "mt19937"
	Xoshiro128SS         RandomAlgorithm = "xoshiro128ss"
	EmptyPlanFingerprint                 = "00000000000000000000000000000000"
)

// ReplayDescriptor is the versioned wire contract shared with TypeScript.
// Its fixed seed material excludes the original user seed text.
type ReplayDescriptor struct {
	SchemaVersion    int             `json:"schemaVersion"`
	Algorithm        RandomAlgorithm `json:"algorithm"`
	AlgorithmVersion int             `json:"algorithmVersion"`
	ExecutionVersion int             `json:"executionVersion"`
	MathProfile      string          `json:"mathProfile"`
	Origin           SeedOrigin      `json:"origin"`
	SeedMaterial     string          `json:"seedMaterial"`
	PlanFingerprint  string          `json:"planFingerprint"`
}

type ReplayDescriptorOptions struct {
	Algorithm       RandomAlgorithm
	PlanFingerprint string
}

type ReplayState struct {
	Replay ReplayDescriptor
	Seed   SeedMaterial
}

func validReplayHex(value string) bool {
	if len(value) != 32 {
		return false
	}
	for i := range value {
		if !(value[i] >= '0' && value[i] <= '9') && !(value[i] >= 'a' && value[i] <= 'f') {
			return false
		}
	}
	return true
}

func supportedRandomAlgorithm(algorithm RandomAlgorithm) bool {
	return algorithm == MT19937 || algorithm == Xoshiro128SS
}

func invalidReplayError(message string) error {
	return newDiceError("INVALID_REPLAY", message, "", nil)
}

func CreateReplayDescriptor(seed SeedMaterial, options ReplayDescriptorOptions) (ReplayDescriptor, error) {
	algorithm := options.Algorithm
	if algorithm == "" {
		algorithm = MT19937
	}
	fingerprint := options.PlanFingerprint
	if fingerprint == "" {
		fingerprint = EmptyPlanFingerprint
	}
	if !supportedRandomAlgorithm(algorithm) || !validReplayHex(seed.SeedMaterial) || !validReplayHex(fingerprint) {
		return ReplayDescriptor{}, invalidReplayError("Replay seed material and plan fingerprint must be 128-bit hex strings")
	}
	return ReplayDescriptor{
		SchemaVersion: 2, Algorithm: algorithm, AlgorithmVersion: 1,
		ExecutionVersion: 1, MathProfile: MathProfile, Origin: seed.Origin,
		SeedMaterial: seed.SeedMaterial, PlanFingerprint: fingerprint,
	}, nil
}

// ValidateReplayDescriptor accepts a native descriptor or decoded JSON object.
// JSON decoding also uses this validator, including rejection of extra keys.
// The optional expected fingerprint binds replay to the compiled roll plan.
func ValidateReplayDescriptor(value any, expectedPlanFingerprint ...string) (ReplayDescriptor, error) {
	if len(expectedPlanFingerprint) > 1 {
		return ReplayDescriptor{}, invalidReplayError("Only one expected plan fingerprint may be provided")
	}
	var descriptor ReplayDescriptor
	exact := true
	switch input := value.(type) {
	case ReplayDescriptor:
		descriptor = input
	case *ReplayDescriptor:
		if input == nil {
			return ReplayDescriptor{}, invalidReplayError("Replay descriptor must be a non-null object")
		}
		descriptor = *input
	case map[string]any:
		if input == nil {
			return ReplayDescriptor{}, invalidReplayError("Replay descriptor must be a non-null object")
		}
		// Version validation precedes shape validation, as in TypeScript.
		if !replayVersion(input["schemaVersion"], 2) || !replayVersion(input["algorithmVersion"], 1) ||
			!replayVersion(input["executionVersion"], 1) || input["mathProfile"] != MathProfile ||
			(input["algorithm"] != "mt19937" && input["algorithm"] != "xoshiro128ss") {
			return ReplayDescriptor{}, newDiceError("UNSUPPORTED_REPLAY_VERSION", "The replay algorithm or version is not supported", "", nil)
		}
		algorithm, _ := input["algorithm"].(string)
		origin, originOK := input["origin"].(string)
		seed, seedOK := input["seedMaterial"].(string)
		fingerprint, fingerprintOK := input["planFingerprint"].(string)
		exact = len(input) == 8 && originOK && seedOK && fingerprintOK
		descriptor = ReplayDescriptor{
			SchemaVersion: 2, AlgorithmVersion: 1, ExecutionVersion: 1, MathProfile: MathProfile,
			Algorithm: RandomAlgorithm(algorithm), Origin: SeedOrigin(origin), SeedMaterial: seed, PlanFingerprint: fingerprint,
		}
	default:
		return ReplayDescriptor{}, invalidReplayError("Replay descriptor must be a non-null object")
	}
	if descriptor.SchemaVersion != 2 || descriptor.AlgorithmVersion != 1 || descriptor.ExecutionVersion != 1 ||
		descriptor.MathProfile != MathProfile || !supportedRandomAlgorithm(descriptor.Algorithm) {
		return ReplayDescriptor{}, newDiceError("UNSUPPORTED_REPLAY_VERSION", "The replay algorithm or version is not supported", "", nil)
	}
	if !exact || !validReplayHex(descriptor.SeedMaterial) || !validReplayHex(descriptor.PlanFingerprint) ||
		(descriptor.Origin != SeedProvidedNumber && descriptor.Origin != SeedProvidedString && descriptor.Origin != SeedCrypto) {
		return ReplayDescriptor{}, invalidReplayError("Replay descriptor contains malformed or unexpected fields")
	}
	if len(expectedPlanFingerprint) == 1 && descriptor.PlanFingerprint != expectedPlanFingerprint[0] {
		return ReplayDescriptor{}, newDiceError("REPLAY_PLAN_MISMATCH", "Replay descriptor belongs to a different roll plan", "", map[string]any{
			"expectedPlanFingerprint": expectedPlanFingerprint[0], "actualPlanFingerprint": descriptor.PlanFingerprint,
		})
	}
	return descriptor, nil
}

func replayVersion(value any, expected int) bool {
	switch number := value.(type) {
	case float64:
		return number == float64(expected)
	case int:
		return number == expected
	case json.Number:
		parsed, err := number.Float64()
		return err == nil && parsed == float64(expected)
	default:
		return false
	}
}

func IsReplayDescriptor(value any) bool {
	_, err := ValidateReplayDescriptor(value)
	return err == nil
}

// UnmarshalJSON validates the complete external envelope instead of silently
// dropping unknown fields as encoding/json normally does for a struct.
func (descriptor *ReplayDescriptor) UnmarshalJSON(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return invalidReplayError("Replay descriptor could not be read")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return invalidReplayError("Replay descriptor could not be read")
	}
	validated, err := ValidateReplayDescriptor(value)
	if err != nil {
		return err
	}
	*descriptor = validated
	return nil
}

func CreateReplayState(value any, expectedPlanFingerprint ...string) (ReplayState, error) {
	replay, err := ValidateReplayDescriptor(value, expectedPlanFingerprint...)
	if err != nil {
		return ReplayState{}, err
	}
	material, _ := hex.DecodeString(replay.SeedMaterial) // validated lowercase hex
	var words [4]uint32
	for i := range words {
		words[i] = binary.BigEndian.Uint32(material[i*4:])
	}
	return ReplayState{Replay: replay, Seed: SeedMaterial{
		CanonicalSeed: "replay:" + replay.SeedMaterial, SeedMaterial: replay.SeedMaterial,
		Origin: replay.Origin, Words: words,
	}}, nil
}

func CreateReplaySeed(value any, expectedPlanFingerprint ...string) (SeedMaterial, error) {
	state, err := CreateReplayState(value, expectedPlanFingerprint...)
	return state.Seed, err
}

// NewReplayRandom restores a fresh generator from a validated descriptor.
// All state is private to this generator and its supplied execution budget.
func NewReplayRandom(value any, budget RandomCallBudget, expectedPlanFingerprint ...string) (RandomSource, error) {
	state, err := CreateReplayState(value, expectedPlanFingerprint...)
	if err != nil {
		return nil, err
	}
	if state.Replay.Algorithm == MT19937 {
		return NewMersenneTwister19937FromWords(state.Seed.Words[:], budget)
	}
	return NewXoshiro128StarStar(state.Seed.Words[:], budget)
}
