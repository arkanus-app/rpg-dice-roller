package dicecore

import (
	"bytes"
	"errors"
	"testing"
)

func executorAssertError(t *testing.T, err error, code string) *DiceRollError {
	t.Helper()
	var diceErr *DiceRollError
	if !errors.As(err, &diceErr) || diceErr.Code != code {
		t.Fatalf("got %v, want %s", err, code)
	}
	return diceErr
}

func TestExecutionContextReplayAndDefaults(t *testing.T) {
	context, err := CreateExecutionContext()
	if err != nil {
		t.Fatal(err)
	}
	if context.Limits != DefaultDiceLimits() || context.Replay.Origin != SeedCrypto || context.Replay.Algorithm != MT19937 {
		t.Fatalf("incorrect default context: %+v", context)
	}
	for _, algorithm := range []RandomAlgorithm{MT19937, Xoshiro128SS} {
		t.Run(string(algorithm), func(t *testing.T) {
			original, err := CreateExecutionContext(ExecutionContextOptions{Seed: "same seed", RandomAlgorithm: algorithm})
			if err != nil {
				t.Fatal(err)
			}
			restored, err := CreateExecutionContext(ExecutionContextOptions{Replay: original.Replay})
			if err != nil {
				t.Fatal(err)
			}
			bound, err := CreateExecutionContext(ExecutionContextOptions{Replay: original.Replay, PlanFingerprint: original.Replay.PlanFingerprint})
			if err != nil {
				t.Fatal(err)
			}
			for range 20 {
				a, e := original.Random.NextUint32()
				if e != nil {
					t.Fatal(e)
				}
				b, e := restored.Random.NextUint32()
				if e != nil {
					t.Fatal(e)
				}
				c, e := bound.Random.NextUint32()
				if e != nil {
					t.Fatal(e)
				}
				if a != b || b != c {
					t.Fatal("replay stream diverged")
				}
			}
		})
	}
}

func TestExecutionContextLimitsAndEntropy(t *testing.T) {
	limits := UntrustedServerDiceLimits()
	collect := false
	context, err := CreateExecutionContext(ExecutionContextOptions{Limits: &limits, Seed: 42, CollectEvents: &collect})
	if err != nil {
		t.Fatal(err)
	}
	if context.Limits != limits {
		t.Fatal("limits not retained")
	}
	if _, err = context.Journal.Record(DiceEvent{"type": "roll"}); err != nil {
		t.Fatal(err)
	}
	if context.Journal.Length() != 1 || len(context.Journal.ToArray()) != 0 {
		t.Fatal("journal materialized suppressed event")
	}
	overridden, err := CreateExecutionContext(ExecutionContextOptions{LimitOverrides: DiceLimitOverrides{"maxRandomCalls": 1}, Seed: 42})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = overridden.Random.NextUint32(); err != nil {
		t.Fatal(err)
	}
	_, err = overridden.Random.NextUint32()
	executorAssertError(t, err, "RANDOM_BUDGET_EXCEEDED")
	data := []byte{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}
	context, err = CreateExecutionContext(ExecutionContextOptions{CryptoSource: bytes.NewReader(data)})
	if err != nil {
		t.Fatal(err)
	}
	if context.Replay.SeedMaterial != "000102030405060708090a0b0c0d0e0f" {
		t.Fatalf("unexpected crypto seed: %s", context.Replay.SeedMaterial)
	}
	if _, err := initializeExecutionContextRandom(&ExecutionContext{Budget: NewExecutionBudget(limits)}, MT19937, nil, nil); err == nil {
		t.Fatal("accepted missing generator words")
	}
}

func TestExecutionContextRejectsInvalidOptions(t *testing.T) {
	invalidLimits := DefaultDiceLimits()
	invalidLimits.MaxRolls = 0
	valid, err := CreateExecutionContext(ExecutionContextOptions{Seed: 1})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		option ExecutionContextOptions
		code   string
	}{
		{"limits", ExecutionContextOptions{Limits: &invalidLimits}, "INVALID_LIMIT"},
		{"overrides", ExecutionContextOptions{LimitOverrides: DiceLimitOverrides{"maxRolls": 0}}, "INVALID_LIMIT"},
		{"seed and replay", ExecutionContextOptions{Seed: 1, Replay: valid.Replay}, "INVALID_REPLAY"},
		{"replay and algorithm", ExecutionContextOptions{Replay: valid.Replay, RandomAlgorithm: Xoshiro128SS}, "INVALID_REPLAY"},
		{"algorithm", ExecutionContextOptions{Seed: 1, RandomAlgorithm: "unknown"}, "INVALID_REPLAY"},
		{"seed", ExecutionContextOptions{Seed: false}, "INVALID_SEED"},
		{"missing crypto", ExecutionContextOptions{CryptoSourceProvided: true}, "RNG_UNAVAILABLE"},
		{"short crypto", ExecutionContextOptions{CryptoSource: bytes.NewReader([]byte{1})}, "RNG_UNAVAILABLE"},
		{"fingerprint", ExecutionContextOptions{Seed: 1, PlanFingerprint: "bad"}, "INVALID_REPLAY"},
		{"replay", ExecutionContextOptions{Replay: "bad"}, "INVALID_REPLAY"},
		{"bound replay", ExecutionContextOptions{Replay: valid.Replay, PlanFingerprint: "11111111111111111111111111111111"}, "REPLAY_PLAN_MISMATCH"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			context, err := CreateExecutionContext(tc.option)
			executorAssertError(t, err, tc.code)
			if context != nil {
				t.Fatal("returned partial context on failure")
			}
		})
	}
}
