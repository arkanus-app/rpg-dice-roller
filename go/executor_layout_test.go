package dicecore

import (
	"encoding/json"
	"reflect"
	"strconv"
	"testing"
)

func TestWorkingDieLayoutSizeDiagnostic(t *testing.T) {
	type previousWorkingDie struct {
		ResolvedDie
		active bool
	}
	t.Logf("working die bytes: previous=%d compact=%d; public resolved die=%d",
		reflect.TypeFor[previousWorkingDie]().Size(), reflect.TypeFor[workingDie]().Size(), reflect.TypeFor[ResolvedDie]().Size())
}

func TestWorkingDieCompactMetadataAcrossKindsAndRolls(t *testing.T) {
	engine, err := CreateDiceEngine()
	if err != nil {
		t.Fatal(err)
	}
	const input = "2#{2d6,1d%,2dF,1d0}"
	result, err := engine.Roll(input, RollOptions{Seed: "compact-working-metadata"})
	if err != nil {
		t.Fatal(err)
	}
	sides := []any{int64(6), int64(6), int64(100), "F", "F", int64(0)}
	if len(result.Dice) != 2*len(sides) {
		t.Fatalf("unexpected number of dice: %d", len(result.Dice))
	}
	groups := make(map[string]ResolvedGroup, len(result.Groups))
	for _, group := range result.Groups {
		groups[group.ID] = group
	}
	diceByID := make(map[string]ResolvedDie, len(result.Dice))
	for index, die := range result.Dice {
		rollIndex := int64(index/len(sides) + 1)
		dieIndex := int64(index%len(sides) + 1)
		group, ok := groups[die.GroupID]
		if !ok || die.SourceNodeID != group.SourceNodeID || die.RollIndex != group.RollIndex || die.RollIndex != rollIndex || die.RollDieIndex != dieIndex {
			t.Fatalf("source/group/roll metadata changed for die %d: %+v group=%+v", index, die, group)
		}
		if !reflect.DeepEqual(die.Sides, sides[index%len(sides)]) || die.ParentDieID != nil || die.States == nil || len(die.States) != 0 {
			t.Fatalf("sides, parent or empty states changed for die %d: %+v", index, die)
		}
		if die.ID != "roll-"+strconv.FormatInt(rollIndex, 10)+"-die-"+strconv.FormatInt(dieIndex, 10) {
			t.Fatalf("die ID disagrees with its public indices: %+v", die)
		}
		diceByID[die.ID] = die
	}
	for _, event := range result.Events {
		if event.Subject != "die" {
			continue
		}
		die, ok := diceByID[event.DieID]
		if !ok || event.SourceNodeID != die.SourceNodeID || event.RollIndex != die.RollIndex {
			t.Fatalf("event metadata differs from its die: %+v", event)
		}
	}
	details, err := engine.RollDetails(input, RollOptions{Replay: result.Replay})
	if err != nil || !reflect.DeepEqual(details.Dice, result.Dice) || details.Stats != result.Stats {
		t.Fatalf("full/details replay changed metadata: %v", err)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Dice []struct {
			States json.RawMessage `json:"states"`
		}
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, die := range decoded.Dice {
		if string(die.States) != "[]" {
			t.Fatalf("empty states JSON changed: %s", die.States)
		}
	}
}

func TestWorkingDieSourceSnapshotsASTIdentity(t *testing.T) {
	// GetPlanProgram is read-only in the public contract, but diagnostic tests
	// deliberately corrupt it. A mismatched spec ID must not replace the source
	// identity that the executor has always captured from the actual AST node.
	plan, err := CompileDicePlan("1d1!1", DefaultDiceLimits())
	if err != nil {
		t.Fatal(err)
	}
	program, err := GetPlanProgram(plan)
	if err != nil {
		t.Fatal(err)
	}
	nodeID := program.AST.ID
	program.DiceSpecs[nodeID].NodeID = "diagnostic-mismatched-spec"
	result, err := ExecuteRollPlan(plan, ExecuteRollPlanOptions{Limits: DefaultDiceLimits(), Seed: "source-snapshot"})
	if err != nil {
		t.Fatal(err)
	}
	for _, die := range result.Dice {
		if die.SourceNodeID != nodeID {
			t.Fatalf("actual AST identity was replaced: %+v", die)
		}
	}
	for _, event := range result.Events {
		if event.Subject == "die" && event.SourceNodeID != nodeID {
			t.Fatalf("event source identity was replaced: %+v", event)
		}
	}
}

type layoutCustomSides struct{}

func (layoutCustomSides) MarshalJSON() ([]byte, error) {
	return []byte(`{"custom":"caller-owned"}`), nil
}

func TestWorkingDiePublicResultOwnsMaterializedMetadata(t *testing.T) {
	engine, err := CreateDiceEngine()
	if err != nil {
		t.Fatal(err)
	}
	const input = "2#1d1!1"
	result, err := engine.Roll(input, RollOptions{Seed: "compact-result-owner"})
	if err != nil {
		t.Fatal(err)
	}
	before, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	eventsBefore, err := json.Marshal(result.Events)
	if err != nil {
		t.Fatal(err)
	}
	result.Dice[0].Sides = layoutCustomSides{}
	result.Dice[0].SourceNodeID = "caller-source"
	result.Dice[0].GroupID = "caller-group"
	result.Dice[0].RollIndex = 999
	result.Dice[0].RollDieIndex = 999
	result.Dice[0].States[0] = "caller-state"
	*result.Dice[1].ParentDieID = "caller-parent"
	mutated, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Dice []struct {
			Sides json.RawMessage `json:"sides"`
		}
	}
	if err := json.Unmarshal(mutated, &decoded); err != nil || string(decoded.Dice[0].Sides) != `{"custom":"caller-owned"}` {
		t.Fatalf("public Sides custom marshaler changed: %s, %v", mutated, err)
	}
	eventsAfter, err := json.Marshal(result.Events)
	if err != nil || string(eventsAfter) != string(eventsBefore) {
		t.Fatalf("public die mutation changed event snapshots: %v", err)
	}
	again, err := engine.Roll(input, RollOptions{Replay: result.Replay})
	if err != nil {
		t.Fatal(err)
	}
	after, err := json.Marshal(again)
	if err != nil || string(after) != string(before) {
		t.Fatalf("public result metadata mutation escaped into replay: %v", err)
	}
}
