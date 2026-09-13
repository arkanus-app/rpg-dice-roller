package dicecore

import (
	"errors"
	"testing"
)

func TestLimits(t *testing.T) {
	if DefaultDiceLimits().MaxSides != 1<<32 || TrustedServerDiceLimits().MaxInitialDice != 5000 ||
		UntrustedServerDiceLimits().MaxInitialDice != 500 {
		t.Fatal("preset mismatch")
	}
	for _, preset := range []DiceLimits{DefaultDiceLimits(), TrustedServerDiceLimits(), UntrustedServerDiceLimits()} {
		if err := preset.Validate(); err != nil {
			t.Fatal(err)
		}
	}
	engine, err := CreateDiceLimits(DiceLimitOverrides{"maxRolls": 50, "maxEvents": 500})
	if err != nil {
		t.Fatal(err)
	}
	call, err := ResolveDiceLimits(engine, DiceLimitOverrides{"maxRolls": 10})
	if err != nil || call.MaxRolls != 10 || call.MaxEvents != 500 || engine.MaxRolls != 50 {
		t.Fatalf("%+v %v", call, err)
	}
	fields := DefaultDiceLimits()
	for _, field := range limitFields(&fields) {
		for _, invalid := range []int64{0, -1, maxSafeInteger + 1} {
			_, err := CreateDiceLimits(DiceLimitOverrides{field.name: invalid})
			requireErrorCode(t, err, "INVALID_LIMIT")
			_, err = ResolveDiceLimits(fields, DiceLimitOverrides{field.name: invalid})
			requireErrorCode(t, err, "INVALID_LIMIT")
		}
		_, err := ResolveDiceLimits(fields, DiceLimitOverrides{field.name: *field.value + 1})
		requireErrorCode(t, err, "INVALID_LIMIT")
	}
	_, err = ResolveDiceLimits(DiceLimits{}, nil)
	requireErrorCode(t, err, "INVALID_LIMIT")
	defaults, err := CreateDiceLimits(nil)
	if err != nil || defaults != DefaultDiceLimits() {
		t.Fatal(defaults, err)
	}
}

func TestBudget(t *testing.T) {
	limits := DefaultDiceLimits()
	for _, field := range limitFields(&limits) {
		*field.value = 2
	}
	b := NewExecutionBudget(limits)
	limits.MaxRolls = 100
	if b.Limits().MaxRolls != 2 {
		t.Fatal("budget shares external caps")
	}
	if err := b.AssertInputLength("🎲"); err != nil {
		t.Fatal(err)
	}
	requireErrorCode(t, b.AssertInputLength("🎲a"), "INPUT_TOO_LONG")
	requireErrorCode(t, b.ConsumeAstNode(0), "ROLL_EXECUTION_LIMIT")
	requireErrorCode(t, b.ConsumeAstNode(maxSafeInteger+1), "ROLL_EXECUTION_LIMIT")
	requireErrorCode(t, b.ConsumeAstNode(3), "AST_TOO_DEEP")
	for i := 0; i < 2; i++ {
		if err := b.ConsumeAstNode(2); err != nil {
			t.Fatal(err)
		}
	}
	requireErrorCode(t, b.ConsumeAstNode(1), "TOO_MANY_NODES")
	for _, tc := range []struct {
		consume func(int64) error
		code    string
	}{
		{b.ConsumeRolls, "TOO_MANY_ROLLS"}, {b.ConsumeInitialDice, "TOO_MANY_INITIAL_DICE"},
		{b.ConsumeGeneratedDice, "GENERATED_DICE_LIMIT_EXCEEDED"}, {b.ConsumeRandomCalls, "RANDOM_BUDGET_EXCEEDED"},
		{b.ConsumeEvents, "EVENT_LIMIT_EXCEEDED"}, {b.ConsumeModifierSteps, "MODIFIER_STEP_LIMIT_EXCEEDED"},
		{b.ConsumeResolvedGroups, "RESOLVED_GROUP_LIMIT_EXCEEDED"}, {b.ConsumeResultItems, "RESULT_LIMIT_EXCEEDED"},
	} {
		if err := tc.consume(0); err != nil {
			t.Fatal(err)
		}
		if err := tc.consume(2); err != nil {
			t.Fatal(err)
		}
		requireErrorCode(t, tc.consume(1), tc.code)
		requireErrorCode(t, tc.consume(-1), "ROLL_EXECUTION_LIMIT")
		requireErrorCode(t, tc.consume(maxSafeInteger+1), "ROLL_EXECUTION_LIMIT")
	}
	if err := b.AssertOutputLength(2); err != nil {
		t.Fatal(err)
	}
	requireErrorCode(t, b.AssertOutputLength(-1), "ROLL_EXECUTION_LIMIT")
	requireErrorCode(t, b.AssertOutputLength(3), "OUTPUT_LIMIT_EXCEEDED")
	snapshot := b.Snapshot()
	if snapshot.AstNodes != 2 || b.Stats().Rolls != 2 {
		t.Fatal(snapshot)
	}
	snapshot.Rolls = 99
	if b.Stats().Rolls != 2 {
		t.Fatal("snapshot modifies budget")
	}
	large := NewExecutionBudget(DefaultDiceLimits())
	large.limits.MaxRolls = maxSafeInteger
	if err := large.ConsumeRolls(maxSafeInteger); err != nil {
		t.Fatal(err)
	}
	requireErrorCode(t, large.ConsumeRolls(1), "TOO_MANY_ROLLS")
	var limitError *DiceRollError
	if err := large.ConsumeRolls(2); !errors.As(err, &limitError) ||
		limitError.Details["actual"] != int64(9007199254740992) || large.Stats().Rolls != maxSafeInteger {
		t.Fatalf("expected JS Number error details without mutating the counter: %v", err)
	}
}
