package dicecore

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestResolvedEventDiscriminatedJSONAndMapJournal(t *testing.T) {
	cases := []struct {
		name, subject, kind, fields string
	}{
		{"roll", "die", "roll", `"value":0`},
		{"reroll", "die", "reroll", `"from":1.5,"to":0,"reason":"reason"`},
		{"explode", "die", "explode", `"childDieId":"child","value":0,"reason":"reason"`},
		{"transform-die", "die", "transform", `"from":1.5,"to":0,"reason":"reason"`},
		{"transform-group", "group", "transform", `"from":["a","b"],"to":[],"reason":"reason"`},
		{"include-die", "die", "include", `"contribution":0`},
		{"include-group", "group", "include", `"value":0,"contribution":0`},
		{"exclude-die", "die", "exclude", `"reason":"reason"`},
		{"exclude-group", "group", "exclude", `"reason":"reason","value":0`},
		{"classify", "die", "classify", `"outcome":"neutral"`},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			event := ResolvedEvent{Sequence: 1, RollIndex: 2, Type: item.kind, Subject: item.subject, SourceNodeID: "node", DieID: "die", Details: &ResolvedEventDetails{GroupID: "group", From: 1.5, ChildDieID: "child", Reason: "reason", Outcome: "neutral", FromIDs: []string{"a", "b"}, ToIDs: []string{}}}
			base := `{"sequence":1,"type":"` + item.kind + `","subject":"` + item.subject + `",`
			if item.subject == "die" {
				base += `"dieId":"die","parentDieId":null,`
			} else {
				base += `"groupId":"group",`
			}
			want := base + `"rollIndex":2,"sourceNodeId":"node",` + item.fields + `}`
			got, err := json.Marshal(event)
			if err != nil || string(got) != want {
				t.Fatalf("discriminated JSON: %s, %v; want %s", got, err, want)
			}
			var restored ResolvedEvent
			if err := json.Unmarshal(got, &restored); err != nil {
				t.Fatal(err)
			}
			restoredJSON, err := json.Marshal(restored)
			if err != nil || string(restoredJSON) != want {
				t.Fatalf("typed event roundtrip: %s, %v; want %s", restoredJSON, err, want)
			}
			journal := NewExecutionJournal(nil)
			if err := journal.recordResolved(event); err != nil {
				t.Fatal(err)
			}
			mapped := journal.ToArray()[0]
			var expected DiceEvent
			if err := json.Unmarshal([]byte(want), &expected); err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(mapped)
			var decoded DiceEvent
			if err != nil || json.Unmarshal(encoded, &decoded) != nil || !reflect.DeepEqual(decoded, expected) {
				t.Fatalf("map bridge differs: %s, %v", encoded, err)
			}
			// The journal's old API returns new slices containing the same maps.
			mapped["custom"] = "retained"
			if journal.Slice(0)[0]["custom"] != "retained" {
				t.Fatal("map identities changed across public journal reads")
			}
			encoded, err = json.Marshal(journal.takeResolvedEvents()[0])
			if err != nil || !strings.Contains(string(encoded), `"custom":"retained"`) {
				t.Fatal("map mutation was lost when encoding a mixed journal", err)
			}
		})
	}
}

func TestResolvedEventJSONEscapesAndNumberBoundaries(t *testing.T) {
	values := []float64{0, math.Copysign(0, -1), 1, -1, 6, 0.5, -9.75, 1e-6, 1e-7, 1e-9, 1e-10, 1e20, 1e21, math.SmallestNonzeroFloat64, math.MaxFloat64,
		9007199254740991, -9007199254740991, 9007199254740992, -9007199254740992, math.Nextafter(6, 7), math.Nextafter(-6, -7)}
	for _, value := range values {
		event := ResolvedEvent{Type: "roll", Subject: "die", Value: value}
		wire, err := event.MarshalJSON()
		want, _ := json.Marshal(value)
		if err != nil || !strings.HasSuffix(string(wire), `"value":`+string(want)+`}`) {
			t.Fatalf("number %g: %s, %v; want %s", value, wire, err, want)
		}
	}
	for _, value := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if _, err := (ResolvedEvent{Subject: "die", Type: "transform", Details: &ResolvedEventDetails{From: value, To: value}}).MarshalJSON(); err == nil {
			t.Fatal("unsupported JSON number accepted", value)
		}
	}
	for _, value := range []string{"ascii", "", "with\"quote", "with\\slash", "\n\x00\t\r\b\f", "🎲ação", "<>&", "\u2028\u2029", "invalid\xffutf8"} {
		want, _ := json.Marshal(value)
		got := appendEventString(nil, value)
		if string(got) != string(want) {
			t.Fatalf("string JSON: %q, want %q", got, want)
		}
	}
	parent := ResolvedEvent{Type: "roll", Subject: "die", ParentDieID: "parent", HasParent: true}
	wire, err := parent.MarshalJSON()
	if err != nil || !strings.Contains(string(wire), `"parentDieId":"parent"`) || parent.asDiceEvent()["parentDieId"] != "parent" {
		t.Fatal("parent ID encoding", err)
	}
	var parentCopy ResolvedEvent
	if err := json.Unmarshal(wire, &parentCopy); err != nil || !parentCopy.HasParent || parentCopy.ParentDieID != "parent" {
		t.Fatal("parent ID roundtrip", err)
	}
	group := ResolvedEvent{Type: "transform", Subject: "group"}
	wire, err = group.MarshalJSON()
	if err != nil || !strings.Contains(string(wire), `"from":null,"to":null`) {
		t.Fatal("nil arrays were changed to empty arrays", err)
	}
}

func TestResolvedEventDecodeRejectsMalformedFields(t *testing.T) {
	for _, input := range []string{
		`{"sequence":"bad"}`, `{"type":"transform","subject":"die","from":[]}`,
		`{"type":"reroll","subject":"die","to":[]}`,
		`{"type":"transform","subject":"group","from":1}`,
		`{"type":"transform","subject":"group","to":1}`,
	} {
		original := ResolvedEvent{Type: "roll", Value: 6}
		if err := json.Unmarshal([]byte(input), &original); err == nil || original.Value != 6 {
			t.Fatalf("invalid event was accepted or partly assigned: %s, %v", input, err)
		}
	}
}

func TestResolvedJournalBudgetsAndLegacyInputs(t *testing.T) {
	for _, limit := range []string{"maxEvents", "maxResultItems"} {
		limits, _ := CreateDiceLimits(DiceLimitOverrides{limit: 1})
		journal := NewExecutionJournal(NewExecutionBudget(limits))
		if err := journal.recordResolved(ResolvedEvent{Type: "roll", Subject: "die"}); err != nil {
			t.Fatal(err)
		}
		if err := journal.recordResolved(ResolvedEvent{}); err == nil || journal.Length() != 1 || len(journal.takeResolvedEvents()) != 1 {
			t.Fatal("typed journal changed state after a failed budget")
		}
	}
	journal := NewExecutionJournal(nil, false)
	if err := journal.recordResolved(ResolvedEvent{}); err != nil || journal.Length() != 1 || len(journal.takeResolvedEvents()) != 0 {
		t.Fatal("typed journal suppression changed event accounting", err)
	}
	journal = NewExecutionJournal(nil)
	input := DiceEvent{"sequence": "override", "arbitrary": []any{true, nil, "custom"}}
	first, err := journal.Record(input)
	if err != nil {
		t.Fatal(err)
	}
	input["arbitrary"] = "changed"
	if err := journal.recordResolved(ResolvedEvent{Type: "roll", Subject: "die", Value: 6}); err != nil {
		t.Fatal(err)
	}
	all := journal.ToArray()
	if all[0]["sequence"] != "override" || all[1]["sequence"] != int64(2) || !reflect.DeepEqual(all[0], first) {
		t.Fatal("mixed public/native chronology changed")
	}
}

func TestResolvedEventRetainsParentSnapshot(t *testing.T) {
	result, err := RollRPGDice("1d1!1", RollOptions{Seed: "parent-snapshot"})
	if err != nil {
		t.Fatal(err)
	}
	var before string
	for _, event := range result.Events {
		if event.HasParent {
			before = event.ParentDieID
		}
	}
	if before == "" || result.Dice[1].ParentDieID == nil {
		t.Fatal("fixture did not generate a parented die")
	}
	*result.Dice[1].ParentDieID = "mutated-die"
	for _, event := range result.Events {
		if event.HasParent && event.ParentDieID != before {
			t.Fatal("die mutation changed its historical event")
		}
	}
}

func TestResolvedEventReservePreservesDirectExecutionLimitErrors(t *testing.T) {
	plan, err := CompileRPGDice("1d6")
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"events", "items"} {
		limits := DefaultDiceLimits()
		code := "EVENT_LIMIT_EXCEEDED"
		if field == "events" {
			limits.MaxEvents = -1
		} else {
			limits.MaxResultItems = -1
			code = "RESULT_LIMIT_EXCEEDED"
		}
		_, err = ExecuteRollPlan(plan, ExecuteRollPlanOptions{Limits: limits, Seed: "invalid-direct-limits"})
		executorAssertError(t, err, code)
	}
}
