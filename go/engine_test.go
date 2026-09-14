package dicecore

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"testing"
)

func TestEngineFunctionalFacadeAndOwnedResults(t *testing.T) {
	DefaultDiceEngine().ClearCache()
	plan, err := CompileRPGDice("2d6+3 [attack]")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyRPGDiceNotation(plan.Input) || !InspectRPGDiceNotation(plan.Input).IsValid {
		t.Fatal("facade verification")
	}
	option := RollOptions{Seed: "facade"}
	full, err := RollRPGDice(plan, option)
	if err != nil {
		t.Fatal(err)
	}
	details, err := RollRPGDiceDetails(plan, option)
	if err != nil {
		t.Fatal(err)
	}
	summary, err := RollRPGDiceSummary(plan, option)
	if err != nil {
		t.Fatal(err)
	}
	if full.Total != summary.Total || details.Total != summary.Total || full.Replay != details.Replay || details.Replay != summary.Replay {
		t.Fatal("projections changed result or replay")
	}
	want, err := json.Marshal(full)
	if err != nil {
		t.Fatal(err)
	}
	full.Dice[0].Value = 999
	full.Dice[0].States = append(full.Dice[0].States, "dropped")
	full.Groups[0].ChildIDs[0] = "changed"
	full.Events[0]["value"] = 999
	plan.RollCount = 999
	plan.Groups[0].ChildIDs[0] = "changed"
	again, err := RollRPGDice(plan, option)
	if err != nil {
		t.Fatal(err)
	}
	got, err := json.Marshal(again)
	if err != nil || string(got) != string(want) {
		t.Fatal("caller mutation escaped into engine state", err)
	}
	automatic, err := RollRPGDice("1d6")
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := RollRPGDice("1d6", RollOptions{Replay: automatic.Replay})
	if err != nil || !reflect.DeepEqual(automatic, replayed) {
		t.Fatal("automatic replay", err)
	}
}

func TestEngineRejectsAmbiguousOptionsAndInvalidLimits(t *testing.T) {
	_, err := CreateDiceEngine(DiceEngineOptions{}, DiceEngineOptions{})
	requireErrorCode(t, err, "INVALID_LIMIT")
	engine, err := CreateDiceEngine()
	if err != nil {
		t.Fatal(err)
	}
	_, err = engine.Compile("1d6", CompileOptions{}, CompileOptions{})
	requireErrorCode(t, err, "INVALID_LIMIT")
	_, err = engine.Roll("1d6", RollOptions{}, RollOptions{})
	requireErrorCode(t, err, "INVALID_REPLAY")
	_, err = engine.Roll("1d6", RollOptions{Limits: DiceLimitOverrides{"maxRolls": 0}})
	requireErrorCode(t, err, "INVALID_LIMIT")
	_, err = engine.RollDetails("1d6", RollOptions{Limits: DiceLimitOverrides{"maxRolls": 0}})
	requireErrorCode(t, err, "INVALID_LIMIT")
	_, err = engine.RollSummary("1d6", RollOptions{Limits: DiceLimitOverrides{"maxRolls": 0}})
	requireErrorCode(t, err, "INVALID_LIMIT")
	inspection := invalidEngineInspection("1d6 [comment]", errors.New("compiler fault"))
	if inspection.IsValid || inspection.Plan != nil || inspection.Cost != nil || inspection.Error.Code != "INVALID_NOTATION" ||
		inspection.Error.Details["cause"] != "compiler fault" || inspection.Comment != "comment" {
		t.Fatalf("%+v", inspection)
	}
	limits := engine.Limits()
	limits.MaxRolls = 0
	if engine.Limits().MaxRolls == 0 {
		t.Fatal("engine shares mutable limits")
	}
}

func TestEngineExternalPlanReadsOnlyEnvelope(t *testing.T) {
	engine, _ := CreateDiceEngine()
	plan, err := engine.Compile("1d6")
	if err != nil {
		t.Fatal(err)
	}
	input := map[string]any{"type": plan.Type, "schemaVersion": plan.SchemaVersion, "compilerVersion": plan.CompilerVersion,
		"input": plan.Input, "planFingerprint": plan.PlanFingerprint, "groups": make(chan int)}
	first, err := engine.Roll(input, RollOptions{Seed: 1})
	if err != nil {
		t.Fatal(err)
	}
	want, err := engine.Roll(plan, RollOptions{Seed: 1})
	if err != nil || !reflect.DeepEqual(first, want) {
		t.Fatal("external groups affected roll", err)
	}
	input["input"] = make(chan int)
	_, err = engine.Roll(input, RollOptions{Seed: 1})
	requireErrorCode(t, err, "UNSUPPORTED_NOTATION")
	_, err = engine.Roll((*RollPlan)(nil), RollOptions{Seed: 1})
	requireErrorCode(t, err, "UNSUPPORTED_NOTATION")
}

func TestEngineConcurrentRollsKeepSeedsAndCachesIsolated(t *testing.T) {
	engine, err := CreateDiceEngine(DiceEngineOptions{Cache: DiceCacheOptions{"maxInputEntries": 2, "maxProgramEntries": 2}})
	if err != nil {
		t.Fatal(err)
	}
	const input = "{4d6kh3,2d8+1}kh1+2"
	const workers = 8
	wants := make([][]byte, workers)
	for i := range wants {
		result, err := engine.Roll(input, RollOptions{Seed: i})
		if err != nil {
			t.Fatal(err)
		}
		wants[i], err = json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
	}
	var group sync.WaitGroup
	errorsOut := make(chan error, workers)
	for worker := 0; worker < workers; worker++ {
		group.Add(1)
		go func(seed int) {
			defer group.Done()
			for iteration := 0; iteration < 20; iteration++ {
				plan, err := engine.Compile(input)
				if err != nil {
					errorsOut <- err
					return
				}
				result, err := engine.Roll(plan, RollOptions{Seed: seed})
				if err != nil {
					errorsOut <- err
					return
				}
				got, err := json.Marshal(result)
				if err != nil {
					errorsOut <- err
					return
				}
				if string(got) != string(wants[seed]) {
					errorsOut <- fmt.Errorf("seed %d changed in concurrent execution", seed)
					return
				}
				if iteration%5 == 0 {
					engine.ClearCache()
				}
			}
		}(worker)
	}
	group.Wait()
	close(errorsOut)
	for err := range errorsOut {
		t.Error(err)
	}
}
