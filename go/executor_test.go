package dicecore

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func TestExecutorTypeScriptFixtures(t *testing.T) {
	for _, raw := range loadFixtureCases(t, "executor.json") {
		var fixture struct {
			Name            string                     `json:"name"`
			Input           string                     `json:"input"`
			Seed            any                        `json:"seed"`
			Algorithm       RandomAlgorithm            `json:"algorithm"`
			ExecutionLimits DiceLimitOverrides         `json:"executionLimits"`
			Outcomes        map[string]json.RawMessage `json:"outcomes"`
		}
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
		t.Run(fixture.Name, func(t *testing.T) {
			for _, mode := range []string{"full", "details", "summary"} {
				t.Run(mode, func(t *testing.T) {
					plan, err := CompileDicePlan(fixture.Input, DefaultDiceLimits())
					var result any
					if err == nil {
						limits, limitErr := CreateDiceLimits(fixture.ExecutionLimits)
						if limitErr != nil {
							t.Fatal(limitErr)
						}
						options := ExecuteRollPlanOptions{Limits: limits, Seed: fixture.Seed, RandomAlgorithm: fixture.Algorithm}
						switch mode {
						case "full":
							result, err = ExecuteRollPlan(plan, options)
						case "details":
							result, err = ExecuteRollPlanDetails(plan, options)
						case "summary":
							result, err = ExecuteRollPlanSummary(plan, options)
						}
					}
					assertFixtureOutcome(t, fixture.Outcomes[mode], result, err)
				})
			}
		})
	}
}

func TestExecutorReplayAcrossProjections(t *testing.T) {
	for _, input := range []string{"2#4d6kh3", "2#8d6!!p2ro<2kh5>=5f=1", "{1d6,2d8+3}kh1sd"} {
		t.Run(input, func(t *testing.T) {
			plan, err := CompileDicePlan(input, DefaultDiceLimits())
			if err != nil {
				t.Fatal(err)
			}
			original, err := ExecuteRollPlan(plan, ExecuteRollPlanOptions{Limits: DefaultDiceLimits(), Seed: "replay", RandomAlgorithm: Xoshiro128SS})
			if err != nil {
				t.Fatal(err)
			}
			options := ExecuteRollPlanOptions{Limits: DefaultDiceLimits(), Replay: original.Replay}
			replayed, err := ExecuteRollPlan(plan, options)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(original, replayed) {
				t.Fatal("full replay differs")
			}
			details, err := ExecuteRollPlanDetails(plan, options)
			if err != nil {
				t.Fatal(err)
			}
			summary, err := ExecuteRollPlanSummary(plan, options)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(original.Dice, details.Dice) || original.Total != details.Total || original.Total != summary.Total || !reflect.DeepEqual(details.Rolls, summary.Rolls) || !reflect.DeepEqual(original.Pool, summary.Pool) || original.Stats != details.Stats || original.Stats != summary.Stats {
				t.Fatal("projection changed semantic results or accounting")
			}
		})
	}
}

func TestExecutorRejectsIncompleteProgram(t *testing.T) {
	for _, mode := range []string{"full", "details", "summary"} {
		t.Run(mode, func(t *testing.T) {
			plan, err := CompileDicePlan("1d6", DefaultDiceLimits())
			if err != nil {
				t.Fatal(err)
			}
			program, err := GetPlanProgram(plan)
			if err != nil {
				t.Fatal(err)
			}
			delete(program.DiceSpecs, program.AST.ID)
			options := ExecuteRollPlanOptions{Limits: DefaultDiceLimits(), Seed: 1}
			switch mode {
			case "full":
				_, err = ExecuteRollPlan(plan, options)
			case "details":
				_, err = ExecuteRollPlanDetails(plan, options)
			case "summary":
				_, err = ExecuteRollPlanSummary(plan, options)
			}
			failure := executorAssertError(t, err, "UNSUPPORTED_NOTATION")
			if failure.Span == nil || failure.Message != "Compiled dice specification is missing" {
				t.Fatalf("missing diagnostic: %+v", failure)
			}
		})
	}
	for _, unsupported := range []bool{false, true} {
		plan, err := CompileDicePlan("{1d6,1d8}", DefaultDiceLimits())
		if err != nil {
			t.Fatal(err)
		}
		program, err := GetPlanProgram(plan)
		if err != nil {
			t.Fatal(err)
		}
		code := "UNSUPPORTED_NOTATION"
		if unsupported {
			program.GroupModifiers[program.AST.ID] = []*ModifierNode{{Kind: "min", Value: 2, Span: program.AST.Span}}
			code = "UNSUPPORTED_GROUP_MODIFIER"
		} else {
			delete(program.GroupModifiers, program.AST.ID)
		}
		_, err = ExecuteRollPlan(plan, ExecuteRollPlanOptions{Limits: DefaultDiceLimits(), Seed: 1})
		executorAssertError(t, err, code)
	}
}

func TestExecutorExclusionIsIdempotent(t *testing.T) {
	plan, err := CompileDicePlan("{1d6,1d8}", DefaultDiceLimits())
	if err != nil {
		t.Fatal(err)
	}
	program, err := GetPlanProgram(plan)
	if err != nil {
		t.Fatal(err)
	}
	state := &rollState{context: executorCreateContext(plan, ExecuteRollPlanOptions{Limits: DefaultDiceLimits(), Seed: 1}, true), plan: plan, program: program, rollIndex: 1, groupByID: map[string]*workingGroup{}}
	evaluation := evaluateWorkingNode(program.AST, state)
	excludeWorkingGroupTree(evaluation.groupID, state, "drop")
	count := state.context.Journal.Length()
	excludeWorkingGroupTree(evaluation.groupID, state, "keep")
	excludeWorkingGroupTree("missing", state, "keep")
	if state.context.Journal.Length() != count || state.groupByID[evaluation.groupID].Included {
		t.Fatal("repeat group exclusion changed accounting")
	}
}

type executorRuntimeFailure struct{}

func (*executorRuntimeFailure) Error() string { return "executor invariant" }
func (*executorRuntimeFailure) RuntimeError() {}

func TestExecutorRecoveryPreservesErrorsAndPanics(t *testing.T) {
	for _, failure := range []any{"unexpected panic", &executorRuntimeFailure{}} {
		var caught any
		func() {
			defer func() { caught = recover() }()
			var result *DiceRollResult
			var err error
			defer recoverExecutor(&result, &err)
			panic(failure)
		}()
		if caught != failure {
			t.Fatalf("panic changed: got %v, want %v", caught, failure)
		}
	}
	failure := errors.New("Random integer bounds must be ordered safe integers")
	run := func() (result *DiceRollResult, err error) {
		defer recoverExecutor(&result, &err)
		result = &DiceRollResult{Type: "partial"}
		panic(failure)
	}
	result, err := run()
	if result != nil || err != failure {
		t.Fatalf("plain generator error was not returned intact: %v %v", result, err)
	}
}
