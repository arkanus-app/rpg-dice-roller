package dicecore

import (
	"encoding/json"
	"reflect"
	"testing"
)

const testReplayFingerprint = "0123456789abcdef0123456789abcdef"

func testReplayDescriptor() ReplayDescriptor {
	return ReplayDescriptor{
		SchemaVersion: 2, Algorithm: MT19937, AlgorithmVersion: 1, ExecutionVersion: 1,
		MathProfile: "decimal12-v1", Origin: SeedProvidedString,
		SeedMaterial: "0123456789abcdef0123456789abcdef", PlanFingerprint: testReplayFingerprint,
	}
}

func TestReplayRestoresBothAlgorithms(t *testing.T) {
	seed, _ := CreateProvidedSeed("encounter-42")
	for _, algorithm := range []RandomAlgorithm{MT19937, Xoshiro128SS} {
		replay, err := CreateReplayDescriptor(seed, ReplayDescriptorOptions{Algorithm: algorithm, PlanFingerprint: testReplayFingerprint})
		if err != nil {
			t.Fatal(err)
		}
		state, err := CreateReplayState(replay, testReplayFingerprint)
		if err != nil || state.Replay != replay || state.Seed.Words != seed.Words || state.Seed.Origin != seed.Origin {
			t.Fatalf("replay state: %+v, %v", state, err)
		}
		first, err := NewReplayRandom(replay, nil, testReplayFingerprint)
		if err != nil {
			t.Fatal(err)
		}
		var second RandomSource
		if algorithm == MT19937 {
			second, _ = NewMersenneTwister19937FromWords(seed.Words[:], nil)
		} else {
			second, _ = NewXoshiro128StarStar(seed.Words[:], nil)
		}
		if !reflect.DeepEqual(randomValues(t, first, 700), randomValues(t, second, 700)) {
			t.Fatalf("restored %s sequence diverges", algorithm)
		}
		encoded, _ := json.Marshal(replay)
		var decoded ReplayDescriptor
		if err := json.Unmarshal(encoded, &decoded); err != nil || decoded != replay {
			t.Fatalf("JSON roundtrip: %+v, %v", decoded, err)
		}
	}
}

func TestReplayStrictValidation(t *testing.T) {
	valid := testReplayDescriptor()
	if !IsReplayDescriptor(valid) || !IsReplayDescriptor(&valid) {
		t.Fatal("valid descriptor rejected")
	}
	_, err := ValidateReplayDescriptor(valid, "ffffffffffffffffffffffffffffffff")
	assertRandomErrorCode(t, err, "REPLAY_PLAN_MISMATCH")
	for _, value := range []any{nil, []any{}, "invalid", (*ReplayDescriptor)(nil), map[string]any(nil)} {
		_, err := ValidateReplayDescriptor(value)
		assertRandomErrorCode(t, err, "INVALID_REPLAY")
	}
	for _, mutate := range []func(*ReplayDescriptor){
		func(d *ReplayDescriptor) { d.SchemaVersion = 1 },
		func(d *ReplayDescriptor) { d.AlgorithmVersion = 2 },
		func(d *ReplayDescriptor) { d.ExecutionVersion = 2 },
		func(d *ReplayDescriptor) { d.MathProfile = "other" },
		func(d *ReplayDescriptor) { d.Algorithm = "unknown" },
	} {
		descriptor := valid
		mutate(&descriptor)
		_, err := ValidateReplayDescriptor(descriptor)
		assertRandomErrorCode(t, err, "UNSUPPORTED_REPLAY_VERSION")
	}
	for _, mutate := range []func(*ReplayDescriptor){
		func(d *ReplayDescriptor) { d.SeedMaterial = "abc" },
		func(d *ReplayDescriptor) { d.SeedMaterial = "0123456789ABCDEF0123456789ABCDEF" },
		func(d *ReplayDescriptor) { d.PlanFingerprint = "bad" },
		func(d *ReplayDescriptor) { d.Origin = "unknown" },
	} {
		descriptor := valid
		mutate(&descriptor)
		_, err := ValidateReplayDescriptor(descriptor)
		assertRandomErrorCode(t, err, "INVALID_REPLAY")
	}
	encoded, _ := json.Marshal(valid)
	var object map[string]any
	_ = json.Unmarshal(encoded, &object)
	object["extra"] = true
	_, err = ValidateReplayDescriptor(object)
	assertRandomErrorCode(t, err, "INVALID_REPLAY")
	extra, _ := json.Marshal(object)
	var decoded ReplayDescriptor
	assertRandomErrorCode(t, json.Unmarshal(extra, &decoded), "INVALID_REPLAY")
	delete(object, "extra")
	delete(object, "origin")
	_, err = ValidateReplayDescriptor(object)
	assertRandomErrorCode(t, err, "INVALID_REPLAY")
	if err := decoded.UnmarshalJSON(append(encoded, []byte(" {}")...)); err == nil {
		t.Fatal("trailing JSON accepted")
	}
}
