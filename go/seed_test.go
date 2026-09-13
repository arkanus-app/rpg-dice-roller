package dicecore

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func TestSeedCanonicalNumberSemantics(t *testing.T) {
	cases := []struct {
		input any
		want  string
	}{
		{42, "number:42"}, {"42", "string:42"}, {math.Copysign(0, -1), "number:-0"},
		{float64(0), "number:0"}, {1e-6, "number:0.000001"}, {1e-7, "number:1e-7"},
		{1e20, "number:100000000000000000000"}, {1e21, "number:1e+21"},
		{math.SmallestNonzeroFloat64, "number:5e-324"}, {-1e21, "number:-1e+21"},
	}
	for _, example := range cases {
		got, err := CanonicalizeSeed(example.input)
		if err != nil || got != example.want {
			t.Errorf("canonicalize %v: %q, %v; want %q", example.input, got, err, example.want)
		}
	}
	for _, invalid := range []any{nil, true, []int{1}, math.NaN(), math.Inf(1), math.Inf(-1), int64(1 << 53), "\xff"} {
		_, err := CreateProvidedSeed(invalid)
		assertRandomErrorCode(t, err, "INVALID_SEED")
	}
	number, _ := CreateProvidedSeed(42)
	text, _ := CreateProvidedSeed("42")
	if number.Words == text.Words || number.Origin != SeedProvidedNumber || text.Origin != SeedProvidedString {
		t.Fatal("number and string seed namespaces must remain distinct")
	}
}

func TestSeedUTF16AndLength(t *testing.T) {
	text, err := CreateProvidedSeed("🎲a", 3)
	if err != nil {
		t.Fatal(err)
	}
	units, err := CreateProvidedSeed(UTF16Seed{0xd83c, 0xdfb2, 'a'}, 3)
	if err != nil || units.Words != text.Words {
		t.Fatalf("Unicode hash differs from UTF16 hash: %+v, %v", units, err)
	}
	_, err = CreateProvidedSeed("🎲a", 2)
	assertRandomErrorCode(t, err, "INVALID_SEED")
	_, err = CreateProvidedSeed("a", 0)
	assertRandomErrorCode(t, err, "INVALID_LIMIT")
	_, err = CreateProvidedSeed("a", randomMaxSafeInteger+1)
	assertRandomErrorCode(t, err, "INVALID_LIMIT")
	_, err = CreateProvidedSeed("a", 1, 2)
	assertRandomErrorCode(t, err, "INVALID_LIMIT")
	one, _ := CreateProvidedSeed(UTF16Seed{0xd800})
	two, _ := CreateProvidedSeed("�")
	if one.Words == two.Words {
		t.Fatal("isolated surrogate must not hash as replacement character")
	}
}

func TestSeedAutomaticCryptoAndSerialization(t *testing.T) {
	fixture := []byte{0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4}
	seed, err := CreateAutomaticSeed(bytes.NewReader(fixture))
	if err != nil || seed.SeedMaterial != "00000001000000020000000300000004" || seed.Words != [4]uint32{1, 2, 3, 4} {
		t.Fatalf("automatic fixture: %+v, %v", seed, err)
	}
	_, err = CreateAutomaticSeed(nil)
	assertRandomErrorCode(t, err, "RNG_UNAVAILABLE")
	_, err = CreateAutomaticSeed(bytes.NewReader(fixture[:15]))
	assertRandomErrorCode(t, err, "RNG_UNAVAILABLE")
	automatic, err := CreateAutomaticSeed()
	if err != nil || !validReplayHex(automatic.SeedMaterial) {
		t.Fatalf("system crypto: %+v, %v", automatic, err)
	}
	provided, _ := CreateProvidedSeed("private-user-seed")
	replay, err := CreateReplayDescriptor(provided, ReplayDescriptorOptions{})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(replay)
	if err != nil || strings.Contains(string(encoded), "private-user-seed") || strings.Contains(string(encoded), "canonicalSeed") {
		t.Fatalf("descriptor leaked user seed: %s, %v", encoded, err)
	}
}
