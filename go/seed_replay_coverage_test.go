package dicecore

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"
)

func TestSeedNativeIntegerTypesPreserveReferenceMaterial(t *testing.T) {
	// This material is fixed by the TypeScript oracle's numeric seed 1.
	const expectedMaterial = "07b060542b20b55e8668cccbaf9e3cad"
	expectedWords := [4]uint32{128999508, 723563870, 2255015115, 2946383021}
	for _, input := range []any{int(1), int64(1), int32(1), int16(1), int8(1), uint(1), uint64(1), uint32(1), uint16(1), uint8(1)} {
		t.Run(fmt.Sprintf("%T", input), func(t *testing.T) {
			seed, err := CreateProvidedSeed(input)
			if err != nil {
				t.Fatal(err)
			}
			if seed.CanonicalSeed != "number:1" || seed.Origin != SeedProvidedNumber || seed.SeedMaterial != expectedMaterial || seed.Words != expectedWords {
				t.Fatalf("native integer changed the numeric seed contract: %+v", seed)
			}
		})
	}
	for _, unsafeInteger := range []any{uint64(1 << 53), int64(-1 << 53)} {
		seed, err := CreateProvidedSeed(unsafeInteger)
		assertRandomErrorCode(t, err, "INVALID_SEED")
		if seed != (SeedMaterial{}) {
			t.Fatalf("unsafe native integer produced material: %+v", seed)
		}
	}
}

func TestSeedTextLimitBoundariesPreserveUTF16Lengths(t *testing.T) {
	cases := []struct {
		name  string
		input any
		units int64
	}{
		{name: "BMP UTF8", input: "aé", units: 2},
		{name: "astral UTF8", input: "🎲a", units: 3},
		{name: "BMP UTF16", input: UTF16Seed{'a', 'é'}, units: 2},
		{name: "astral UTF16", input: UTF16Seed{0xd83c, 0xdfb2, 'a'}, units: 3},
		{name: "isolated surrogate UTF16", input: UTF16Seed{0xd800, 'a'}, units: 2},
	}
	for _, example := range cases {
		t.Run(example.name, func(t *testing.T) {
			allowed, err := CreateProvidedSeed(example.input, example.units)
			if err != nil || !validReplayHex(allowed.SeedMaterial) {
				t.Fatalf("seed at exact UTF16 limit rejected: %+v, %v", allowed, err)
			}
			reference, err := CreateProvidedSeed(example.input)
			if err != nil || reference != allowed {
				t.Fatalf("lowering limit to input length changed material: %+v, %v", reference, err)
			}
			rejected, err := CreateProvidedSeed(example.input, example.units-1)
			assertRandomErrorCode(t, err, "INVALID_SEED")
			if rejected != (SeedMaterial{}) {
				t.Fatalf("oversized seed returned material: %+v", rejected)
			}
			var diceErr *DiceRollError
			if !errors.As(err, &diceErr) {
				t.Fatal(err)
			}
			// Details use int/int64 internally; compare their public JSON form.
			details, err := json.Marshal(diceErr.Details)
			if err != nil {
				t.Fatal(err)
			}
			var reported map[string]int64
			if err := json.Unmarshal(details, &reported); err != nil {
				t.Fatal(err)
			}
			want := map[string]int64{"seedLength": example.units, "maxSeedLength": example.units - 1}
			if diceErr.Message != "Text seed exceeds the maximum length" || !reflect.DeepEqual(reported, want) {
				t.Fatalf("incorrect boundary diagnostic: %q, %s", diceErr.Message, details)
			}
		})
	}
}

func TestSeedRejectsAmbiguousCryptoSourcesBeforeReading(t *testing.T) {
	first := bytes.NewReader(make([]byte, 16))
	second := bytes.NewReader(make([]byte, 16))
	seed, err := CreateAutomaticSeed(first, second)
	assertRandomErrorCode(t, err, "RNG_UNAVAILABLE")
	if seed != (SeedMaterial{}) || first.Len() != 16 || second.Len() != 16 {
		t.Fatalf("ambiguous sources must not draw entropy: %+v, unread=%d/%d", seed, first.Len(), second.Len())
	}
}

func TestReplayCreationRejectsMalformedInputs(t *testing.T) {
	seed, err := CreateProvidedSeed("replay-validation")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name    string
		seed    SeedMaterial
		options ReplayDescriptorOptions
	}{
		{name: "unknown algorithm", seed: seed, options: ReplayDescriptorOptions{Algorithm: "unsupported"}},
		{name: "invalid seed material", seed: SeedMaterial{SeedMaterial: "not-a-seed", Origin: SeedProvidedString}},
		{name: "invalid plan fingerprint", seed: seed, options: ReplayDescriptorOptions{PlanFingerprint: "invalid"}},
	}
	for _, example := range cases {
		t.Run(example.name, func(t *testing.T) {
			replay, err := CreateReplayDescriptor(example.seed, example.options)
			assertRandomErrorCode(t, err, "INVALID_REPLAY")
			if replay != (ReplayDescriptor{}) {
				t.Fatalf("invalid creation returned replay: %+v", replay)
			}
		})
	}
}

func TestReplayRejectsAmbiguousBinding(t *testing.T) {
	replay, err := ValidateReplayDescriptor(testReplayDescriptor(), testReplayFingerprint, testReplayFingerprint)
	assertRandomErrorCode(t, err, "INVALID_REPLAY")
	if replay != (ReplayDescriptor{}) {
		t.Fatalf("ambiguous binding produced replay: %+v", replay)
	}
}

func TestReplaySupportsNativeIntegerVersions(t *testing.T) {
	want := testReplayDescriptor()
	input := map[string]any{
		"schemaVersion": 2, "algorithmVersion": 1, "executionVersion": 1,
		"algorithm": string(want.Algorithm), "mathProfile": want.MathProfile,
		"origin": string(want.Origin), "seedMaterial": want.SeedMaterial, "planFingerprint": want.PlanFingerprint,
	}
	replay, err := ValidateReplayDescriptor(input, testReplayFingerprint)
	if err != nil || replay != want {
		t.Fatalf("native int versions changed replay: %+v, %v", replay, err)
	}
	for _, invalidVersion := range []any{3, json.Number("malformed")} {
		input["schemaVersion"] = invalidVersion
		_, err := ValidateReplayDescriptor(input)
		assertRandomErrorCode(t, err, "UNSUPPORTED_REPLAY_VERSION")
	}
}

func TestReplayMalformedJSONPreservesExistingDescriptor(t *testing.T) {
	want := testReplayDescriptor()
	for _, malformed := range []string{"", "{", "[", `{"schemaVersion":`, "not JSON"} {
		t.Run(malformed, func(t *testing.T) {
			descriptor := want
			// Exercise the exported decoder directly: encoding/json rejects invalid
			// syntax itself before it invokes a custom UnmarshalJSON method.
			err := descriptor.UnmarshalJSON([]byte(malformed))
			assertRandomErrorCode(t, err, "INVALID_REPLAY")
			if descriptor != want {
				t.Fatalf("failed decoding mutated existing descriptor: %+v", descriptor)
			}
		})
	}
}

func TestReplayRandomRejectsUntrustedReplayBeforeDrawing(t *testing.T) {
	for _, example := range []struct {
		name        string
		descriptor  any
		fingerprint string
		code        string
	}{
		{name: "null descriptor", descriptor: nil, fingerprint: testReplayFingerprint, code: "INVALID_REPLAY"},
		{name: "different plan", descriptor: testReplayDescriptor(), fingerprint: EmptyPlanFingerprint, code: "REPLAY_PLAN_MISMATCH"},
	} {
		t.Run(example.name, func(t *testing.T) {
			budget := &testRandomBudget{limit: 10}
			random, err := NewReplayRandom(example.descriptor, budget, example.fingerprint)
			assertRandomErrorCode(t, err, example.code)
			if random != nil || budget.calls != 0 {
				t.Fatalf("invalid replay created a generator or consumed budget: %v, %d", random, budget.calls)
			}
		})
	}
}
