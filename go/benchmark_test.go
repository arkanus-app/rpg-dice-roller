package dicecore

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"testing"
	"time"
)

// This worker is dormant in the correctness suite. The external comparison
// harness compiles it once and activates it explicitly for isolated batches.
// Keeping the harness in *_test.go excludes it from the shipped library.
type comparisonWorkload struct {
	ID              string          `json:"id"`
	Kind            string          `json:"kind"`
	Input           any             `json:"input"`
	Inputs          []string        `json:"inputs"`
	Mode            string          `json:"mode"`
	Algorithm       RandomAlgorithm `json:"algorithm"`
	Seeds           []string        `json:"seeds"`
	Cache           bool            `json:"cache"`
	ValidationCount int             `json:"validationCount"`
}

type comparisonRequest struct {
	Phase       string               `json:"phase"`
	Workloads   []comparisonWorkload `json:"workloads"`
	Iterations  map[string]int       `json:"iterations"`
	WarmupFloor int                  `json:"warmupFloor"`
	WarmupCap   int                  `json:"warmupCap"`
}

var comparisonSink any

func comparisonOperation(workload comparisonWorkload) (func(int) (any, error), error) {
	var cache any = false
	if workload.Cache {
		cache = nil
	}
	engine, err := CreateDiceEngine(DiceEngineOptions{Cache: cache, RandomAlgorithm: workload.Algorithm, FreezeResults: "never"})
	if err != nil {
		return nil, err
	}
	rollOptions := make([]RollOptions, len(workload.Seeds))
	systemOptions := make([]SystemRollOptions, len(workload.Seeds))
	for index, seed := range workload.Seeds {
		rollOptions[index] = RollOptions{Seed: seed, RandomAlgorithm: workload.Algorithm}
		systemOptions[index] = SystemRollOptions{RollOptions: rollOptions[index], Detail: workload.Mode}
	}
	return func(index int) (any, error) {
		switch workload.Kind {
		case "normalize":
			return NormalizeRPGDiceNotation(workload.Inputs[index%len(workload.Inputs)]), nil
		case "compile":
			return engine.Compile(workload.Input.(string))
		case "roll":
			options := rollOptions[index%len(rollOptions)]
			switch workload.Mode {
			case "full":
				return engine.Roll(workload.Input, options)
			case "details":
				return engine.RollDetails(workload.Input, options)
			case "summary":
				return engine.RollSummary(workload.Input, options)
			}
		case "fate":
			return RollFateDiceWithEngine(engine, workload.Input, systemOptions[index%len(systemOptions)])
		case "vampire-v5":
			return RollVampireV5WithEngine(engine, workload.Input, systemOptions[index%len(systemOptions)])
		case "mixed":
			return RollMixedDiceWithEngine(engine, workload.Input, systemOptions[index%len(systemOptions)])
		}
		return nil, fmt.Errorf("unknown benchmark workload %s", workload.ID)
	}, nil
}

func TestBenchmarkWorker(t *testing.T) {
	if os.Getenv("DICECORE_COMPARISON_WORKER") != "1" {
		t.Skip("activated only by scripts/compare-go-typescript.mjs")
	}
	var request comparisonRequest
	if err := json.NewDecoder(os.Stdin).Decode(&request); err != nil {
		t.Fatal(err)
	}
	output := map[string]any{"runtime": runtime.Version(), "phase": request.Phase, "cases": map[string]any{}}
	cases := output["cases"].(map[string]any)
	for _, workload := range request.Workloads {
		run, err := comparisonOperation(workload)
		if err != nil {
			t.Fatal(err)
		}
		if request.Phase == "preflight" {
			values := make([]any, workload.ValidationCount)
			for index := range values {
				values[index], err = run(index)
				if err != nil {
					t.Fatalf("%s: %v", workload.ID, err)
				}
			}
			cases[workload.ID] = values
			continue
		}
		iterations := request.Iterations[workload.ID]
		if iterations < 1 {
			t.Fatalf("missing iteration count for %s", workload.ID)
		}
		warmup := max(request.WarmupFloor, min(request.WarmupCap, iterations))
		for index := 0; index < warmup; index++ {
			comparisonSink, err = run(index)
			if err != nil {
				t.Fatal(err)
			}
		}
		start := time.Now()
		for index := 0; index < iterations; index++ {
			comparisonSink, err = run(index)
			if err != nil {
				t.Fatal(err)
			}
		}
		duration := time.Since(start).Nanoseconds()
		cases[workload.ID] = map[string]any{"iterations": iterations, "warmupIterations": warmup, "durationNs": duration, "nsPerOp": float64(duration) / float64(iterations)}
	}
	data, err := json.Marshal(output)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("DICECORE_BENCHMARK %s\n", data)
}
