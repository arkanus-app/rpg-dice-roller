package dicecore

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func compilerAssertCode(t *testing.T, err error, code string) {
	t.Helper()
	var typed *DiceRollError
	if !errors.As(err, &typed) || typed.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}

func TestCompilerPlanIdentity(t *testing.T) {
	limits := DefaultDiceLimits()
	plan, err := CompileDicePlan("2#2d6+1 [test]", limits)
	if err != nil {
		t.Fatal(err)
	}
	program, err := GetPlanProgram(plan)
	if err != nil {
		t.Fatal(err)
	}
	ast, err := GetPlanAST(plan)
	if err != nil || ast != program.AST {
		t.Fatalf("bound AST identity lost: %v", err)
	}
	encoded, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	var external RollPlan
	if err := json.Unmarshal(encoded, &external); err != nil {
		t.Fatal(err)
	}
	copy := *plan
	for _, unknown := range []*RollPlan{nil, &external, &copy} {
		if HasPlanProgram(unknown) {
			t.Fatal("unbound or copied plan became executable")
		}
		_, err := GetPlanProgram(unknown)
		compilerAssertCode(t, err, "UNSUPPORTED_NOTATION")
		_, err = GetPlanAST(unknown)
		compilerAssertCode(t, err, "UNSUPPORTED_NOTATION")
		err = ValidatePlanLimits(unknown, limits)
		compilerAssertCode(t, err, "UNSUPPORTED_NOTATION")
	}
}

func TestCompilerCachedPlanCaps(t *testing.T) {
	defaults := DefaultDiceLimits()
	plan, err := CompileDicePlan("2#2d6+1", defaults)
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidatePlanLimits(plan, defaults); err != nil {
		t.Fatal(err)
	}
	for _, example := range []struct {
		limits DiceLimitOverrides
		code   string
	}{
		{DiceLimitOverrides{"maxInputLength": 2}, "INPUT_TOO_LONG"},
		{DiceLimitOverrides{"maxRolls": 1}, "TOO_MANY_ROLLS"},
		{DiceLimitOverrides{"maxAstNodes": 1}, "TOO_MANY_NODES"},
		{DiceLimitOverrides{"maxAstDepth": 1}, "AST_TOO_DEEP"},
		{DiceLimitOverrides{"maxSides": 5}, "DICE_SIDES_LIMIT_EXCEEDED"},
		{DiceLimitOverrides{"maxInitialDice": 3}, "TOO_MANY_INITIAL_DICE"},
	} {
		limits, err := CreateDiceLimits(example.limits)
		if err != nil {
			t.Fatal(err)
		}
		compilerAssertCode(t, ValidatePlanLimits(plan, limits), example.code)
	}
	prepared, err := PrepareDicePlanInput("d8", defaults)
	if err != nil {
		t.Fatal(err)
	}
	program, err := GetPlanProgram(plan)
	if err != nil {
		t.Fatal(err)
	}
	_, err = BindDicePlan(prepared, program, defaults)
	compilerAssertCode(t, err, "UNSUPPORTED_NOTATION")
}

func TestCompilerBindsCommentIndependentProgram(t *testing.T) {
	limits := DefaultDiceLimits()
	first, err := PrepareDicePlanInput("2#d6 [first]", limits)
	if err != nil {
		t.Fatal(err)
	}
	second, err := PrepareDicePlanInput("3#d6 [second]", limits)
	if err != nil {
		t.Fatal(err)
	}
	program, err := CompileDiceProgram("d6", first.Normalized.Input, limits)
	if err != nil {
		t.Fatal(err)
	}
	a, err := BindDicePlan(first, program, limits)
	if err != nil {
		t.Fatal(err)
	}
	b, err := BindDicePlan(second, program, limits)
	if err != nil {
		t.Fatal(err)
	}
	if a.program != b.program || a.PlanFingerprint == b.PlanFingerprint || a.Comment != "first" || b.Comment != "second" || a.Cost.TotalStaticDice != 2 || b.Cost.TotalStaticDice != 3 {
		t.Fatalf("envelope binding drifted: %+v, %+v", a, b)
	}
	if !reflect.DeepEqual(a.Groups, b.Groups) {
		t.Fatal("comment and repetition changed formula groups")
	}
}

func TestCompilerFailureBoundary(t *testing.T) {
	for _, example := range []struct {
		failure any
		cause   string
	}{
		{errors.New("parser dependency failed"), "parser dependency failed"},
		{"non-error dependency failure", "Unknown parser error"},
	} {
		func() {
			var err error
			func() { defer compilerRecover(&err, "original input"); panic(example.failure) }()
			compilerAssertCode(t, err, "INVALID_NOTATION")
			typed := err.(*DiceRollError)
			if typed.Input != "original input" || typed.Details["cause"] != example.cause {
				t.Fatalf("incorrect normalized dependency error: %+v", typed)
			}
		}()
	}
}

func TestCompilerUnknownComparisonCannotProveMatch(t *testing.T) {
	unknown := &ComparePointNode{Operator: "unknown", Value: 1}
	if comparisonAlwaysMatchesRange(unknown, 1, 1, true) || comparisonCanMatchRange(unknown, compilerNumericRange{1, 1, true}) {
		t.Fatal("unknown operator must not become a proof about die outcomes")
	}
}
