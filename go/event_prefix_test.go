package dicecore

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"testing"
)

// This ordinary struct is an independent encoding/json oracle for the existing
// die envelope: pointers preserve numeric zero and distinguish parent null.
type eventDieEnvelopeReference struct {
	Sequence     int64    `json:"sequence"`
	Type         string   `json:"type"`
	Subject      string   `json:"subject"`
	DieID        string   `json:"dieId"`
	ParentDieID  *string  `json:"parentDieId"`
	RollIndex    int64    `json:"rollIndex"`
	SourceNodeID string   `json:"sourceNodeId"`
	Value        *float64 `json:"value,omitempty"`
	Contribution *float64 `json:"contribution,omitempty"`
}

func assertEventMapJSON(t *testing.T, event ResolvedEvent) {
	t.Helper()
	got, err := event.MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	// asDiceEvent materializes a map on this copy, leaving the original event's
	// native encoding path available for later mutation and ownership checks.
	want, err := json.Marshal(event.asDiceEvent())
	var decoded, reference any
	if err != nil || json.Unmarshal(got, &decoded) != nil || json.Unmarshal(want, &reference) != nil || !reflect.DeepEqual(decoded, reference) {
		t.Fatalf("typed/map event mismatch: %s, want %s (%v)", got, want, err)
	}
}

func TestEventDieEnvelopeMatchesStandardJSON(t *testing.T) {
	values := []float64{0, math.Copysign(0, -1), 6, -6, 1.25, math.Nextafter(6, 7), 1e-7, 1e21,
		9007199254740991, -9007199254740991, 9007199254740992, math.SmallestNonzeroFloat64, math.MaxFloat64}
	texts := []string{"", "roll-1:die-2", "quote\"slash\\", "<>&", "🎲ação", "\u2028\u2029", "\x00\n\t", "invalid\xffutf8"}
	counters := []int64{0, 42, math.MinInt64, math.MaxInt64}
	for _, kind := range []string{"roll", "include"} {
		for _, parent := range []bool{false, true} {
			for textIndex, text := range texts {
				for valueIndex, value := range values {
					event := ResolvedEvent{Sequence: counters[valueIndex%len(counters)], RollIndex: counters[textIndex%len(counters)],
						Type: kind, Subject: "die", DieID: text, ParentDieID: text, HasParent: parent, SourceNodeID: text,
						Value: value, Contribution: value}
					if valueIndex%2 == 0 {
						// Irrelevant payload fields, including non-finite values, stay omitted.
						event.Details = &ResolvedEventDetails{GroupID: text, From: math.NaN(), To: math.Inf(1)}
					}
					reference := eventDieEnvelopeReference{Sequence: event.Sequence, Type: kind, Subject: "die", DieID: text,
						RollIndex: event.RollIndex, SourceNodeID: text}
					if parent {
						reference.ParentDieID = &event.ParentDieID
					}
					if kind == "roll" {
						reference.Value = &event.Value
					} else {
						reference.Contribution = &event.Contribution
					}
					want, err := json.Marshal(reference)
					if err != nil {
						t.Fatal(err)
					}
					got, err := json.Marshal(event)
					if err != nil || !bytes.Equal(got, want) {
						t.Fatalf("%s parent=%v value=%g text=%q: %s, want %s (%v)", kind, parent, value, text, got, want, err)
					}
					prefix := []byte(`[{"previous":true},`)
					appended, err := event.appendJSON(append([]byte{}, prefix...))
					if err != nil || !bytes.Equal(appended, append(prefix, want...)) {
						t.Fatalf("append changed preceding JSON or event envelope: %s (%v)", appended, err)
					}
					assertEventMapJSON(t, event)
				}
			}
		}
	}
}

func TestEventDieEnvelopePreservesNonFiniteErrors(t *testing.T) {
	for _, kind := range []string{"roll", "include"} {
		for _, value := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
			event := ResolvedEvent{Type: kind, Subject: "die", Value: value, Contribution: value}
			wire, err := event.MarshalJSON()
			var unsupported *json.UnsupportedValueError
			if wire != nil || !errors.As(err, &unsupported) {
				t.Fatalf("%s lost unsupported-number error: %s (%v)", kind, wire, err)
			}
			_, referenceErr := json.Marshal(value)
			if err.Error() != referenceErr.Error() {
				t.Fatalf("changed numeric error: %v, want %v", err, referenceErr)
			}
			if kind == "roll" {
				event.Value = 4
			} else {
				event.Contribution = 4
			}
			assertEventMapJSON(t, event) // The unused numeric field must stay omitted.
		}
	}
}

func TestEventDieEnvelopeMutationsAndFallbacks(t *testing.T) {
	event := ResolvedEvent{Sequence: 1, Type: "roll", Subject: "die", Value: 6}
	assertEventMapJSON(t, event)
	event.Type, event.Value, event.Contribution = "include", math.NaN(), 1.25
	event.HasParent, event.ParentDieID, event.DieID, event.SourceNodeID = true, "<parent>", "🎲", "node\"changed"
	assertEventMapJSON(t, event)
	event.Value = 3
	event.Details = &ResolvedEventDetails{GroupID: "group", FromIDs: []string{"a", "b"}, ToIDs: []string{}}
	for _, subject := range []string{"group", "", "die\"", "die "} {
		event.Subject = subject
		for _, kind := range []string{"roll", "include", "transform", "custom\""} {
			event.Type = kind
			assertEventMapJSON(t, event)
		}
	}
	event.Subject, event.Type, event.Value = "die", "roll", math.NaN()
	event.legacy = DiceEvent{"type": "legacy", "custom": []any{true, nil}}
	assertEventMapJSON(t, event)
	event.legacy["custom"] = "mutated"
	assertEventMapJSON(t, event)
}
