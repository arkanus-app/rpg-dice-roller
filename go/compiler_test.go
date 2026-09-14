package dicecore

import (
	"encoding/json"
	"testing"
)

func TestCompilerTypeScriptFixtures(t *testing.T) {
	for _, raw := range loadFixtureCases(t, "compiler.json") {
		var example struct {
			Name              string             `json:"name"`
			Input             string             `json:"input"`
			Limits            DiceLimitOverrides `json:"limits"`
			Outcome           json.RawMessage    `json:"outcome"`
			InspectionOutcome json.RawMessage    `json:"inspectionOutcome"`
		}
		if err := json.Unmarshal(raw, &example); err != nil {
			t.Fatal(err)
		}
		t.Run(example.Name, func(t *testing.T) {
			limits, err := CreateDiceLimits(example.Limits)
			if err != nil {
				t.Fatal(err)
			}
			plan, err := CompileDicePlan(example.Input, limits)
			var value any
			if err == nil {
				program, programErr := GetPlanProgram(plan)
				if programErr != nil {
					t.Fatal(programErr)
				}
				value = map[string]any{"plan": plan, "program": program}
			}
			assertFixtureOutcome(t, example.Outcome, value, err)
			assertFixtureOutcome(t, example.InspectionOutcome, InspectDiceNotation(example.Input, limits), nil)
		})
	}
}
