package dicecore

import (
	"encoding/json"
	"reflect"
	"testing"
)

func mutateCompilerPublicPlan(plan *RollPlan) {
	plan.RollCount = 99
	plan.Input = "changed input"
	plan.Notation = "1d100"
	plan.NormalizedNotation = "changed notation"
	plan.Comment = "changed comment"
	plan.PlanFingerprint = EmptyPlanFingerprint
	plan.Cost.StaticDice = 999
	plan.Cost.TotalStaticDice = 999
	for i := range plan.Groups {
		plan.Groups[i].Notation = "changed group"
		plan.Groups[i].SourceNodeID = "changed node"
		plan.Groups[i].Span = SourceSpan{Start: 1000, End: 1001}
		for j := range plan.Groups[i].ChildIDs {
			plan.Groups[i].ChildIDs[j] = "changed child"
		}
	}
}

func TestCompilerCanonicalSnapshotOwnsCompleteEnvelope(t *testing.T) {
	limits := DefaultDiceLimits()
	plan, err := CompileDicePlan("2#(1d6+1) [original]", limits)
	if err != nil {
		t.Fatal(err)
	}
	want, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	mutateCompilerPublicPlan(plan)
	canonical, err := canonicalRollPlan(plan)
	if err != nil {
		t.Fatal(err)
	}
	got, err := json.Marshal(canonical)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) || canonical == plan || !HasPlanProgram(canonical) {
		t.Fatalf("snapshot changed with public plan: %s", got)
	}
	final, err := canonicalRollPlan(canonical)
	if err != nil || final != canonical {
		t.Fatalf("terminal canonical plan changed identity: %v", err)
	}
	restricted := limits
	restricted.MaxRolls = 2
	if err := ValidatePlanLimits(plan, restricted); err != nil {
		t.Fatalf("limits validated caller mutations instead of original: %v", err)
	}
}

func TestCompilerPublicPlanMutationCannotChangeExecutions(t *testing.T) {
	limits := DefaultDiceLimits()
	options := ExecuteRollPlanOptions{Limits: limits, Seed: "compiler-snapshot"}
	plan, err := CompileDicePlan("2#(1d6+1) [original]", limits)
	if err != nil {
		t.Fatal(err)
	}
	wantFull, err := ExecuteRollPlan(plan, options)
	if err != nil {
		t.Fatal(err)
	}
	wantDetails, err := ExecuteRollPlanDetails(plan, options)
	if err != nil {
		t.Fatal(err)
	}
	wantSummary, err := ExecuteRollPlanSummary(plan, options)
	if err != nil {
		t.Fatal(err)
	}
	mutateCompilerPublicPlan(plan)
	gotFull, err := ExecuteRollPlan(plan, options)
	if err != nil || !reflect.DeepEqual(gotFull, wantFull) {
		t.Fatalf("public mutation changed full execution: %v", err)
	}
	gotDetails, err := ExecuteRollPlanDetails(plan, options)
	if err != nil || !reflect.DeepEqual(gotDetails, wantDetails) {
		t.Fatalf("public mutation changed details execution: %v", err)
	}
	gotSummary, err := ExecuteRollPlanSummary(plan, options)
	if err != nil || !reflect.DeepEqual(gotSummary, wantSummary) {
		t.Fatalf("public mutation changed summary execution: %v", err)
	}
}

func TestCompilerEnginePlanAndJSONRoundtripUseOriginalBinding(t *testing.T) {
	engine, err := CreateDiceEngine()
	if err != nil {
		t.Fatal(err)
	}
	plan, err := engine.Compile("2#(1d6+1) [original]")
	if err != nil {
		t.Fatal(err)
	}
	options := RollOptions{Seed: "compiler-snapshot"}
	want, err := engine.Roll(plan, options)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	var external RollPlan
	if err := json.Unmarshal(encoded, &external); err != nil {
		t.Fatal(err)
	}
	if HasPlanProgram(&external) {
		t.Fatal("JSON envelope gained a private program")
	}
	reconstructed, err := engine.Roll(&external, options)
	if err != nil || !reflect.DeepEqual(reconstructed, want) {
		t.Fatalf("external plan failed source/fingerprint reconstruction: %v", err)
	}
	mutateCompilerPublicPlan(plan)
	got, err := engine.Roll(plan, options)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("engine plan mutation changed execution: %v", err)
	}
	if stats := engine.GetCacheStats(); stats.ProgramEntries != 1 {
		t.Fatalf("envelope reuse compiled another program: %+v", stats)
	}
}
