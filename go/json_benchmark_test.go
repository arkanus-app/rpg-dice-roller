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

type jsonBenchmarkRequest struct {
	backendRequest
	Operation string `json:"operation"`
}

type jsonBenchmarkDigest struct {
	backendDigest
	EncodedLength int64 `json:"encodedLength"`
}

// This test-only worker measures the ordinary encoding/json API separately from
// the historical library-only benchmark. It never changes production GC policy.
func TestJSONBenchmarkWorker(t *testing.T) {
	if os.Getenv("DICECORE_JSON_WORKER") != "1" {
		t.Skip("external JSON comparison worker")
	}
	var request jsonBenchmarkRequest
	if err := json.NewDecoder(os.Stdin).Decode(&request); err != nil {
		t.Fatal(err)
	}
	if request.Workers < 1 || request.Requests < request.Workers || request.Samples < 1 || (request.Operation != "build-and-encode" && request.Operation != "encoding-only") {
		t.Fatal("invalid JSON benchmark request")
	}
	cases, memory := map[string]any{}, map[string]any{}
	for _, workload := range request.Workloads {
		var ready, done sync.WaitGroup
		ready.Add(request.Workers)
		done.Add(request.Workers)
		release := make(chan struct{})
		starts := make([]chan struct{}, request.Samples)
		finished := make([]sync.WaitGroup, request.Samples)
		digests := make([][]jsonBenchmarkDigest, request.Samples)
		for sample := range starts {
			starts[sample] = make(chan struct{})
			finished[sample].Add(request.Workers)
			digests[sample] = make([]jsonBenchmarkDigest, request.Workers)
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
		for worker := range request.Workers {
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
				for index := worker; index < request.Requests; index += request.Workers {
					options[index/request.Workers] = RollOptions{Seed: fmt.Sprintf("%s%d", request.SeedPrefix, index), RandomAlgorithm: MT19937}
				}
				if request.Phase == "preflight" {
					for position := worker; position < len(request.ValidationIndices); position += request.Workers {
						index := request.ValidationIndices[position]
						result, err := engine.Roll(workload.Input, RollOptions{Seed: fmt.Sprintf("%s%d", request.SeedPrefix, index), RandomAlgorithm: MT19937})
						if err != nil {
							failures[worker] = err
							break
						}
						encoded, err := json.Marshal(result)
						if err != nil {
							failures[worker] = err
							break
						}
						values[position] = map[string]any{"index": index, "json": string(encoded), "encodedLength": len(encoded)}
					}
					ready.Done()
					return
				}
				var prepared []*DiceRollResult
				if request.Operation == "encoding-only" {
					prepared = make([]*DiceRollResult, count)
					for index, option := range options {
						prepared[index], err = engine.Roll(workload.Input, option)
						if err != nil {
							failures[worker] = err
							ready.Done()
							return
						}
					}
				}
				var lastResult *DiceRollResult
				var lastJSON []byte
				run := func(localIndex int) error {
					if request.Operation == "encoding-only" {
						lastResult = prepared[localIndex]
					} else {
						lastResult, err = engine.Roll(workload.Input, options[localIndex])
						if err != nil {
							return err
						}
					}
					lastJSON, err = json.Marshal(lastResult)
					return err
				}
				for index := range request.Warmup {
					if err := run(index % count); err != nil {
						failures[worker] = err
						ready.Done()
						return
					}
				}
				ready.Done()
				for sample := range starts {
					<-starts[sample]
					var digest jsonBenchmarkDigest
					for index := worker; index < request.Requests; index += request.Workers {
						if err := run(index / request.Workers); err != nil {
							failures[worker] = err
							return
						}
						digest.Count++
						digest.Total += lastResult.Total
						digest.WeightedTotal += float64(index+1) * lastResult.Total
						digest.RandomCalls += lastResult.Stats.RandomCalls
						digest.EncodedLength += int64(len(lastJSON))
					}
					digests[sample][worker] = digest
					completed++
					finished[sample].Done()
				}
				<-release
				runtime.KeepAlive(engine)
				runtime.KeepAlive(options)
				runtime.KeepAlive(prepared)
				runtime.KeepAlive(lastResult)
				runtime.KeepAlive(lastJSON)
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
			if duration <= 0 {
				t.Fatalf("non-positive measured duration: workload=%s operation=%s workers=%d requests=%d sample=%d durationNs=%d", workload.ID, request.Operation, request.Workers, request.Requests, sample, duration)
			}
			var digest jsonBenchmarkDigest
			for _, value := range digests[sample] {
				digest.Count += value.Count
				digest.Total += value.Total
				digest.WeightedTotal += value.WeightedTotal
				digest.RandomCalls += value.RandomCalls
				digest.EncodedLength += value.EncodedLength
			}
			measurements[sample] = map[string]any{"durationNs": duration, "requests": request.Requests, "workers": request.Workers, "digest": digest, "opsPerSecond": float64(request.Requests) * 1e9 / float64(duration)}
		}
		cases[workload.ID] = measurements
		memory[workload.ID] = map[string]any{"afterWarmup": memoryBefore, "afterBatches": memoryAfter}
	}
	data, err := json.Marshal(map[string]any{"runtime": runtime.Version(), "gomaxprocs": runtime.GOMAXPROCS(0), "cases": cases, "memory": memory})
	if err != nil {
		t.Fatalf("JSON benchmark output: %v; cases=%+v", err, cases)
	}
	fmt.Printf("DICECORE_JSON %s\n", data)
}
