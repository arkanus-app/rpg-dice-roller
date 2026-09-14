package dicecore

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
)

func compactSummaryTestRun(plan *RollPlan, options ExecuteRollPlanOptions, compact bool) (result *DiceRollSummary, err error) {
	defer recoverExecutor(&result, &err)
	program := executorValue(GetPlanProgram(plan))
	if compact {
		return executeCompactSummaryPlan(plan, program, options), nil
	}
	_, _, result = executeGeneralPlan(plan, program, options, "summary")
	return result, nil
}

func assertCompactSummaryMatchesGeneral(t *testing.T, plan *RollPlan, options ExecuteRollPlanOptions) *DiceRollSummary {
	t.Helper()
	actual, actualErr := compactSummaryTestRun(plan, options, true)
	wanted, wantedErr := compactSummaryTestRun(plan, options, false)
	if !reflect.DeepEqual(actualErr, wantedErr) {
		t.Fatalf("error changed for %s seed=%v limits=%+v\ncompact: %#v\ngeneral: %#v", plan.Input, options.Seed, options.Limits, actualErr, wantedErr)
	}
	if !reflect.DeepEqual(actual, wanted) {
		a, _ := json.Marshal(actual)
		w, _ := json.Marshal(wanted)
		t.Fatalf("summary changed for %s seed=%v\ncompact: %s\ngeneral: %s", plan.Input, options.Seed, a, w)
	}
	return actual
}

func TestCompactSummaryEligibility(t *testing.T) {
	for _, program := range []*CompiledDiceProgram{nil, {}, {AST: &ExpressionNode{Kind: "number"}}, {AST: &ExpressionNode{Kind: "dice"}}} {
		if canExecuteCompactSummary(program) {
			t.Fatal("unsupported/incomplete program accepted")
		}
	}
	plan := executorValue(CompileDicePlan("20d6!2ro=1kh10", DefaultDiceLimits()))
	program := executorValue(GetPlanProgram(plan))
	if !canExecuteCompactSummary(program) {
		t.Fatal("supported dice modifiers rejected")
	}
	program.DiceSpecs[program.AST.ID].Modifiers = append(program.DiceSpecs[program.AST.ID].Modifiers, &ModifierNode{Kind: "future-modifier"})
	if canExecuteCompactSummary(program) {
		t.Fatal("unknown modifier should fall back to the general executor")
	}
}

func TestCompactSummaryTypeScriptFixtures(t *testing.T) {
	count := 0
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
		plan, err := CompileDicePlan(fixture.Input, DefaultDiceLimits())
		if err != nil {
			continue
		}
		program := executorValue(GetPlanProgram(plan))
		// The existing specialized path runs first. Its budget batching is a
		// separate TS contract, so only cases routed here form this oracle set.
		if program.SupportsFastSummary || !canExecuteCompactSummary(program) {
			continue
		}
		count++
		t.Run(fixture.Name, func(t *testing.T) {
			limits := executorValue(CreateDiceLimits(fixture.ExecutionLimits))
			options := ExecuteRollPlanOptions{Limits: limits, Seed: fixture.Seed, RandomAlgorithm: fixture.Algorithm}
			result, err := compactSummaryTestRun(plan, options, true)
			assertFixtureOutcome(t, fixture.Outcomes["summary"], result, err)
		})
	}
	if count < 50 {
		t.Fatalf("expected broad TypeScript fixture coverage, got %d cases", count)
	}
	t.Logf("validated %d TypeScript summary fixtures through the compact path", count)
}

func TestCompactSummaryMatchesGeneralAcrossSeedsAndReplay(t *testing.T) {
	inputs := []string{
		"1d0", "3d%", "20dF.1", "20dF.2", "2d20pool(-2)",
		"4d6", "8d6min3", "8d6max3", "8d6min3max5kh4dl1", "4d6min2min3",
		"2#6d6min2.125max4.875kh3", "2#3d6min9007199254740991",
		"4d6kh3dl3", "8d6kh2kl3dh1dl1", "4d6kh10", "4d6dl10", "4d6dh10",
		"20d6>=5f=1", "20d6>=5", "20d6>=7", "20d6<=0f<=6",
		"20d6!", "20d6!2", "20d6!!2", "20d6!p2", "20d6!!p2", "20d6!2>=5", "12d6!!2!2",
		"20d6r", "20d6ro", "20d6ro<3", "5d6u", "12d6uo", "12d6uo=1",
		"20d6cscf", "20d6cs>=5cf<=2", "20d6sd", "20d6sa",
		"12d6!2ro<2uokh8dl2>=5f=1cs>=6cf<=1sd",
		"12d6!!p2ro<2uo=2kh7dl2>=5f=1cs>=6cf<=1sa",
		"2#8d6!!p2ro<2kh5>=5f=1 [compact]",
		"2#300d1!1kh1", "1d5step(+2)", "2d20pool(+2)adv",
	}
	for _, input := range inputs {
		t.Run(input, func(t *testing.T) {
			plan := executorValue(CompileDicePlan(input, DefaultDiceLimits()))
			program := executorValue(GetPlanProgram(plan))
			if !canExecuteCompactSummary(program) {
				t.Fatal("expected a supported root dice program")
			}
			for _, algorithm := range []RandomAlgorithm{MT19937, Xoshiro128SS} {
				for seed := 0; seed < 16; seed++ {
					result := assertCompactSummaryMatchesGeneral(t, plan, ExecuteRollPlanOptions{Limits: DefaultDiceLimits(), Seed: seed, RandomAlgorithm: algorithm})
					if result == nil {
						t.Fatal("unexpected error in valid compact summary")
					}
					assertCompactSummaryMatchesGeneral(t, plan, ExecuteRollPlanOptions{Limits: DefaultDiceLimits(), Replay: result.Replay})
				}
			}
		})
	}
}

func TestCompactSummaryPreservesBudgetFailureOrder(t *testing.T) {
	inputs := []string{
		"2#6d6!2ro<3kh4dl1>=5f=1",
		"2#6d6!!p2ro<3uo=1kh4dl1>=5f=1cscfsa",
		"2#6d6min3max5kh3dl1", "2#5d6u", "2#4d1!2kh2",
	}
	for _, input := range inputs {
		plan := executorValue(CompileDicePlan(input, DefaultDiceLimits()))
		for _, limit := range []string{"maxRolls", "maxInitialDice", "maxGeneratedDice", "maxRandomCalls", "maxModifierSteps", "maxEvents", "maxResolvedGroups", "maxResultItems"} {
			t.Run(input+"/"+limit, func(t *testing.T) {
				for cap := int64(1); cap <= 48; cap++ {
					limits := executorValue(CreateDiceLimits(DiceLimitOverrides{limit: cap}))
					for seed := 0; seed < 3; seed++ {
						assertCompactSummaryMatchesGeneral(t, plan, ExecuteRollPlanOptions{Limits: limits, Seed: seed})
					}
				}
			})
		}
		// Force competing event/result/random/modifier caps simultaneously;
		// matching error details establish the same first rejected operation.
		for cap := int64(1); cap <= 48; cap++ {
			limits := executorValue(CreateDiceLimits(DiceLimitOverrides{"maxEvents": cap, "maxResultItems": cap + 3, "maxRandomCalls": cap + 1, "maxModifierSteps": cap}))
			assertCompactSummaryMatchesGeneral(t, plan, ExecuteRollPlanOptions{Limits: limits, Seed: "competing"})
		}
	}
}

func TestCompactSummaryConcurrentWorkspaces(t *testing.T) {
	plan := executorValue(CompileDicePlan("2#20d6!2ro<3kh10>=5f=1", DefaultDiceLimits()))
	wanted := make([]*DiceRollSummary, 4)
	for seed := range wanted {
		wanted[seed] = assertCompactSummaryMatchesGeneral(t, plan, ExecuteRollPlanOptions{Limits: DefaultDiceLimits(), Seed: seed})
	}
	failures := make(chan string, 8)
	for worker := 0; worker < cap(failures); worker++ {
		go func(worker int) {
			for iteration := 0; iteration < 32; iteration++ {
				seed := (worker + iteration) % len(wanted)
				result, err := compactSummaryTestRun(plan, ExecuteRollPlanOptions{Limits: DefaultDiceLimits(), Seed: seed}, true)
				if err != nil || !reflect.DeepEqual(result, wanted[seed]) {
					failures <- fmt.Sprintf("worker %d seed %d changed: result=%+v error=%v", worker, seed, result, err)
					return
				}
			}
			failures <- ""
		}(worker)
	}
	for worker := 0; worker < cap(failures); worker++ {
		if failure := <-failures; failure != "" {
			t.Error(failure)
		}
	}
}

var compactSummaryBenchmarkSink *DiceRollSummary

func BenchmarkCompactSummary(b *testing.B) {
	for _, input := range []string{"20d6!2ro=1kh10", "100d6min2max5kh80", "12d6!!p2ro<2uo=2kh7dl2>=5f=1cs>=6cf<=1sa"} {
		plan := executorValue(CompileDicePlan(input, DefaultDiceLimits()))
		program := executorValue(GetPlanProgram(plan))
		for _, compact := range []bool{false, true} {
			b.Run(fmt.Sprintf("%s/compact=%t", input, compact), func(b *testing.B) {
				options := make([]ExecuteRollPlanOptions, 128)
				for seed := range options {
					options[seed] = ExecuteRollPlanOptions{Limits: DefaultDiceLimits(), Seed: seed}
				}
				b.ReportAllocs()
				b.ResetTimer()
				for index := 0; index < b.N; index++ {
					if compact {
						compactSummaryBenchmarkSink = executeCompactSummaryPlan(plan, program, options[index%len(options)])
					} else {
						_, _, compactSummaryBenchmarkSink = executeGeneralPlan(plan, program, options[index%len(options)], "summary")
					}
				}
			})
		}
	}
}
