package dicecore

import (
	"errors"
	"testing"
)

func TestEngineResolvedLimitsRetainPublicValidation(t *testing.T) {
	var uninitialized Engine
	_, err := uninitialized.Compile("1d6")
	var diceErr *DiceRollError
	if !errors.As(err, &diceErr) || diceErr.Code != "INVALID_LIMIT" {
		t.Fatalf("uninitialized engine must reject invalid limits: %v", err)
	}
	engine, err := CreateDiceEngine(DiceEngineOptions{Limits: DiceLimitOverrides{"maxInitialDice": 2}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = engine.Compile("2d6"); err != nil {
		t.Fatal(err)
	}
	// A cache hit must not allow either raising caps or bypassing a lowered cap.
	for _, limit := range []int64{0, 1, 3} {
		_, err = engine.RollSummary("2d6", RollOptions{Seed: "caps", Limits: DiceLimitOverrides{"maxInitialDice": limit}})
		if err == nil {
			t.Fatalf("invalid per-call cap %d accepted", limit)
		}
	}
	if _, err = engine.RollSummary("2d6", RollOptions{Seed: "caps"}); err != nil {
		t.Fatal(err)
	}
}
