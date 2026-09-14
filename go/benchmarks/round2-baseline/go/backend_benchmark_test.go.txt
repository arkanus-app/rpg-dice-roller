package dicecore

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sync"
	"testing"
	"time"
)

type backendWorkload struct {
	ID    string `json:"id"`
	Input string `json:"input"`
	Mode  string `json:"mode"`
}

type backendRequest struct {
	Phase             string            `json:"phase"`
	Workloads         []backendWorkload `json:"workloads"`
	Workers           int               `json:"workers"`
	Requests          int               `json:"requests"`
	Warmup            int               `json:"warmup"`
	Samples           int               `json:"samples"`
	EngineMode        string            `json:"engineMode"`
	SeedPrefix        string            `json:"seedPrefix"`
	ValidationIndices []int             `json:"validationIndices"`
}

type backendDigest struct {
	Count         int64   `json:"count"`
	Total         float64 `json:"total"`
	WeightedTotal float64 `json:"weightedTotal"`
	RandomCalls   int64   `json:"randomCalls"`
}

func TestBackendRSSSnapshot(t *testing.T) {
	snapshot := backendRSS()
	if runtime.GOOS == "windows" || runtime.GOOS == "linux" {
		if snapshot["available"] != true {
			t.Fatalf("RSS snapshot unavailable: %v", snapshot)
		}
		if bytes, ok := snapshot["rssBytes"].(uint64); !ok || bytes == 0 {
			t.Fatalf("invalid RSS snapshot: %v", snapshot)
		}
	}
}

// Each worker owns an engine, matching a Node/Bun isolate with its own cache.
// Readiness and completion are explicit barriers; no HTTP transport is involved.
func TestBackendBenchmarkWorker(t *testing.T) {
	if os.Getenv("DICECORE_BACKEND_WORKER") != "1" {
		t.Skip("external backend comparison worker")
	}
	var request backendRequest
	if err := json.NewDecoder(os.Stdin).Decode(&request); err != nil {
		t.Fatal(err)
	}
	if request.Workers < 1 || request.Requests < request.Workers || request.Samples < 1 {
		t.Fatal("invalid backend workload size")
	}
	cases := map[string]any{}
	memory := map[string]any{}
	for _, workload := range request.Workloads {
		var ready, done sync.WaitGroup
		ready.Add(request.Workers)
		done.Add(request.Workers)
		starts := make([]chan struct{}, request.Samples)
		release := make(chan struct{})
		finished := make([]sync.WaitGroup, request.Samples)
		digests := make([][]backendDigest, request.Samples)
		for sample := range starts {
			starts[sample] = make(chan struct{})
			finished[sample].Add(request.Workers)
			digests[sample] = make([]backendDigest, request.Workers)
		}
		var shared *Engine
		if request.EngineMode == "shared" {
			var err error
			shared, err = CreateDiceEngine(DiceEngineOptions{FreezeResults: "never", RandomAlgorithm: MT19937})
			if err != nil {
				t.Fatal(err)
			}
		}
		failures := make([]error, request.Workers)
		values := make([]any, len(request.ValidationIndices))
		for worker := 0; worker < request.Workers; worker++ {
			go func(worker int) {
				defer done.Done()
				completed := 0
				defer func() {
					for sample := completed; sample < request.Samples; sample++ {
						finished[sample].Done()
					}
				}()
				engine := shared
				var err error
				if engine == nil {
					engine, err = CreateDiceEngine(DiceEngineOptions{FreezeResults: "never", RandomAlgorithm: MT19937})
				}
				if err != nil {
					failures[worker] = err
					ready.Done()
					return
				}
				count := (request.Requests-1-worker)/request.Workers + 1
				options := make([]RollOptions, count)
				var lastResult any
				for index := worker; index < request.Requests; index += request.Workers {
					options[index/request.Workers] = RollOptions{Seed: fmt.Sprintf("%s%d", request.SeedPrefix, index), RandomAlgorithm: MT19937}
				}
				run := func(option RollOptions) (any, float64, int64, error) {
					switch workload.Mode {
					case "full":
						result, err := engine.Roll(workload.Input, option)
						if err != nil {
							return nil, 0, 0, err
						}
						return result, result.Total, result.Stats.RandomCalls, nil
					case "details":
						result, err := engine.RollDetails(workload.Input, option)
						if err != nil {
							return nil, 0, 0, err
						}
						return result, result.Total, result.Stats.RandomCalls, nil
					case "summary":
						result, err := engine.RollSummary(workload.Input, option)
						if err != nil {
							return nil, 0, 0, err
						}
						return result, result.Total, result.Stats.RandomCalls, nil
					}
					return nil, 0, 0, fmt.Errorf("unknown mode %s", workload.Mode)
				}
				if request.Phase == "preflight" {
					for index := worker; index < len(request.ValidationIndices); index += request.Workers {
						seedIndex := request.ValidationIndices[index]
						option := RollOptions{Seed: fmt.Sprintf("%s%d", request.SeedPrefix, seedIndex), RandomAlgorithm: MT19937}
						value, _, _, err := run(option)
						if err != nil {
							failures[worker] = err
							break
						}
						values[index] = map[string]any{"index": seedIndex, "value": value}
					}
					ready.Done()
					return
				}
				for index := 0; index < request.Warmup; index++ {
					var err error
					lastResult, _, _, err = run(options[index%count])
					if err != nil {
						failures[worker] = err
						ready.Done()
						return
					}
				}
				ready.Done()
				for sample := 0; sample < request.Samples; sample++ {
					<-starts[sample]
					var digest backendDigest
					for index := worker; index < request.Requests; index += request.Workers {
						value, total, calls, err := run(options[index/request.Workers])
						if err != nil {
							failures[worker] = err
							return
						}
						lastResult = value
						digest.Count++
						digest.Total += total
						digest.WeightedTotal += float64(index+1) * total
						digest.RandomCalls += calls
					}
					digests[sample][worker] = digest
					completed++
					finished[sample].Done()
				}
				<-release
				runtime.KeepAlive(engine)
				runtime.KeepAlive(options)
				runtime.KeepAlive(lastResult)
			}(worker)
		}
		ready.Wait()
		durations := make([]int64, request.Samples)
		memoryBefore := backendRSS()
		memoryAfter := make([]any, request.Samples)
		if request.Phase != "preflight" {
			for sample := range starts {
				started := time.Now()
				close(starts[sample])
				finished[sample].Wait()
				durations[sample] = time.Since(started).Nanoseconds()
				memoryAfter[sample] = backendRSS()
			}
		}
		close(release)
		done.Wait()
		for _, err := range failures {
			if err != nil {
				t.Fatal(err)
			}
		}
		if request.Phase == "preflight" {
			cases[workload.ID] = values
			continue
		}
		measurements := make([]any, request.Samples)
		for sample, duration := range durations {
			var digest backendDigest
			for _, value := range digests[sample] {
				digest.Count += value.Count
				digest.Total += value.Total
				digest.WeightedTotal += value.WeightedTotal
				digest.RandomCalls += value.RandomCalls
			}
			measurements[sample] = map[string]any{"durationNs": duration, "requests": request.Requests, "workers": request.Workers, "digest": digest, "nsPerOp": float64(duration) / float64(request.Requests), "opsPerSecond": float64(request.Requests) * 1e9 / float64(duration)}
		}
		cases[workload.ID] = measurements
		memory[workload.ID] = map[string]any{"afterWarmup": memoryBefore, "afterBatches": memoryAfter}
	}
	data, err := json.Marshal(map[string]any{"runtime": runtime.Version(), "gomaxprocs": runtime.GOMAXPROCS(0), "cases": cases, "memory": memory})
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("DICECORE_BACKEND %s\n", data)
}
