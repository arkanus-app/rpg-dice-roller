package dicecore

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"
)

func TestFinalizedStatesBelongToEachResultEntity(t *testing.T) {
	for _, input := range []string{"2#{4d1kh2,3d1kh1}kh1", "2#8d6!!p2ro<2kh5>=5f=1", "1d6"} {
		t.Run(input, func(t *testing.T) {
			plan, err := CompileDicePlan(input, DefaultDiceLimits())
			if err != nil {
				t.Fatal(err)
			}
			full, err := ExecuteRollPlan(plan, ExecuteRollPlanOptions{Limits: DefaultDiceLimits(), Seed: "owned-states"})
			if err != nil {
				t.Fatal(err)
			}
			replay := ExecuteRollPlanOptions{Limits: DefaultDiceLimits(), Replay: full.Replay}
			details, err := ExecuteRollPlanDetails(plan, replay)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(full.Dice, details.Dice) {
				t.Fatal("full/details state mismatch")
			}
			original, err := json.Marshal(full)
			if err != nil {
				t.Fatal(err)
			}
			events, err := json.Marshal(full.Events)
			if err != nil {
				t.Fatal(err)
			}
			var states []*[]string
			for i := range full.Dice {
				states = append(states, &full.Dice[i].States)
			}
			for i := range full.Groups {
				states = append(states, &full.Groups[i].States)
			}
			before := make([][]string, len(states))
			for i, values := range states {
				if *values == nil {
					t.Fatalf("entity %d has null states instead of []", i)
				}
				before[i] = append([]string{}, (*values)...)
			}
			for i, values := range states {
				if len(*values) > 0 {
					(*values)[0] = "caller-mutation"
				}
				*values = append(*values, "caller-append")
				for j, other := range states {
					if i != j && !reflect.DeepEqual(*other, before[j]) {
						t.Fatalf("state mutation of entity %d changed entity %d", i, j)
					}
				}
				*values = append([]string{}, before[i]...)
			}
			afterEvents, err := json.Marshal(full.Events)
			if err != nil || !bytes.Equal(events, afterEvents) {
				t.Fatal("state mutation changed events", err)
			}
			if !reflect.DeepEqual(full.Dice, details.Dice) {
				t.Fatal("mutations leaked between projections")
			}
			// Retained results must remain independent of later execution and replay.
			for _, values := range states {
				*values = append(*values, "retained-mutation")
			}
			again, err := ExecuteRollPlan(plan, replay)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(again)
			if err != nil || !bytes.Equal(original, encoded) {
				t.Fatal("retained result mutation changed replay", err)
			}
		})
	}
}
