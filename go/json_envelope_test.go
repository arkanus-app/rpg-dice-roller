package dicecore

import (
	"bytes"
	"encoding/json"
	"math"
	"testing"
)

func jsonEnvelopePopulatedResult() *DiceRollResult {
	full := nativeJSONPopulatedResult("envelope <>& ação 🎲", 1.25, 0)
	parent := "parent\"\\\x00🎲"
	full.Dice = []ResolvedDie{
		{ID: "die-1", SourceNodeID: "node-1", RollIndex: math.MinInt64, RollDieIndex: math.MaxInt64,
			GroupID: "group-1", Sides: int64(6), RawValue: math.Copysign(0, -1), Value: math.SmallestNonzeroFloat64,
			Contribution: math.MaxFloat64, Included: true, States: nil},
		{ID: "die-2\"\\", SourceNodeID: "node-2<>&", ParentDieID: &parent, RollIndex: 2, RollDieIndex: 3,
			GroupID: "group-2", Sides: "F🎲", RawValue: -math.MaxFloat64, Value: 2.125,
			Contribution: -4.875, Included: false, States: []string{}},
		{ID: "die-3\xff", SourceNodeID: "node-3\u2028", RollIndex: -4, RollDieIndex: 5,
			GroupID: "group-3\u2029", Sides: nil, RawValue: 1e-7, Value: 1e21,
			Contribution: math.Copysign(0, -1), Included: true, States: []string{"", "dropped", "<>&", "ação 🎲", "invalid\xff"}},
	}
	return full
}

func TestJSONDieEnvelopeNestedPrefixes(t *testing.T) {
	for _, shape := range []string{"nil", "empty", "multiple"} {
		t.Run(shape, func(t *testing.T) {
			full := jsonEnvelopePopulatedResult()
			switch shape {
			case "nil":
				full.Dice = nil
			case "empty":
				full.Dice = []ResolvedDie{}
			}
			details, _ := nativeJSONProjections(full)
			for _, value := range []any{full, *full, details, *details} {
				assertNativeJSONParity(t, value)
			}

			// Exercise the native writer within an outer object. Marshaling a
			// map containing results would use the standard fallback instead.
			envelope := struct {
				Before  string           `json:"before"`
				Full    *DiceRollResult  `json:"full"`
				Details *DiceRollDetails `json:"details"`
				After   float64          `json:"after"`
			}{"outer prefix", full, details, math.Copysign(0, -1)}
			want, err := json.Marshal(envelope)
			if err != nil {
				t.Fatal(err)
			}
			for _, spare := range []int{0, len(want) + 128} {
				prefix := []byte("retained\x00\xff:\n")
				destination := make([]byte, len(prefix), len(prefix)+spare)
				copy(destination, prefix)
				output := eventJSON{data: destination, start: 3}
				previous := output.beginObject()
				output.text("before", envelope.Before)
				output.key("full")
				output.fullRoll(full)
				output.key("details")
				output.detailedRoll(details)
				output.number("after", envelope.After)
				output.endObject(previous)
				if output.err != nil {
					t.Fatal(output.err)
				}
				expected := append(append([]byte{}, prefix...), want...)
				if output.start != 3 || !bytes.Equal(output.data, expected) || !bytes.Equal(destination, prefix) {
					t.Fatalf("nested envelope changed writer state, prefix or bytes: start=%d, got %q, want %q", output.start, output.data, expected)
				}
			}
		})
	}
}

func TestJSONDieEnvelopeErrorPrecedence(t *testing.T) {
	mutations := []struct {
		name  string
		apply func(*DiceRollResult)
	}{
		{"header-before-dice", func(r *DiceRollResult) {
			r.Total = math.NaN()
			r.Dice[0].RawValue = math.Inf(1)
			r.Events[0].Value = math.Inf(-1)
		}},
		{"group-before-dice", func(r *DiceRollResult) {
			r.Groups[0].Contribution = math.Inf(-1)
			r.Dice[0].Value = math.NaN()
			r.Events[0].Value = math.Inf(1)
		}},
		{"first-die-raw", func(r *DiceRollResult) {
			r.Dice[0].RawValue = math.NaN()
			r.Dice[0].Value = math.Inf(1)
			r.Dice[0].Contribution = math.Inf(-1)
		}},
		{"first-die-value", func(r *DiceRollResult) {
			r.Dice[0].Value = math.Inf(1)
			r.Dice[0].Contribution = math.NaN()
		}},
		{"first-die-contribution", func(r *DiceRollResult) {
			r.Dice[0].Contribution = math.Inf(-1)
			r.Dice[1].RawValue = math.NaN()
		}},
		{"middle-die", func(r *DiceRollResult) {
			r.Dice[1].Value = math.NaN()
			r.Dice[2].Contribution = math.Inf(1)
			r.Events[0].Value = math.Inf(-1)
		}},
		{"last-die", func(r *DiceRollResult) {
			r.Dice[2].Contribution = math.NaN()
			r.Events[0].Value = math.Inf(1)
		}},
		{"event-after-dice", func(r *DiceRollResult) {
			r.Events[0].Value = math.Inf(1)
			r.Events[1].Contribution = math.NaN()
		}},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			full := jsonEnvelopePopulatedResult()
			mutation.apply(full)
			details, _ := nativeJSONProjections(full)
			for _, value := range []any{full, *full, details, *details} {
				// Also compares the exact wrapped error chain and checks that
				// AppendJSON returns its original destination on failure.
				assertNativeJSONParity(t, value)
			}
		})
	}
}
