package dicecore

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sync"
	"testing"
	"time"
)

type jsonEncoderBenchmarkRequest struct {
	jsonBenchmarkRequest
	Encoder string `json:"encoder"`
}

// The original JSON worker remains unchanged. This comparison selects only the
// encoder before the timed loops; both choices roll and serialize the same
// concrete *DiceRollResult through the same func(any) ([]byte, error) call.
func TestJSONEncoderBenchmarkWorker(t *testing.T) {
	if os.Getenv("DICECORE_JSON_ENCODER_WORKER") != "1" {
		t.Skip("external JSON encoder comparison worker")
	}
	var request jsonEncoderBenchmarkRequest
	if err := json.NewDecoder(os.Stdin).Decode(&request); err != nil {
		t.Fatal(err)
	}
	if request.Workers < 1 || request.Requests < request.Workers || request.Samples < 1 || (request.Operation != "build-and-encode" && request.Operation != "encoding-only") {
		t.Fatal("invalid JSON benchmark request")
	}
	if request.Phase != "preflight" && request.Phase != "measure" {
		t.Fatal("invalid JSON encoder phase")
	}
	var encode func(any) ([]byte, error)
	switch request.Encoder {
	case "std":
		encode = json.Marshal
	case "direct":
		encode = MarshalJSON
	default:
		t.Fatal("invalid JSON encoder: expected std or direct")
	}
	for _, workload := range request.Workloads {
		if workload.Mode != "full" {
			t.Fatal("JSON encoder benchmark requires full results")
		}
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
						// Compare complete bytes outside the timer. Serialize the
						// reference first so mutations by a candidate cannot hide.
						standard, err := json.Marshal(result)
						if err != nil {
							failures[worker] = err
							break
						}
						encoded, err := encode(result)
						if err != nil {
							failures[worker] = err
							break
						}
						if !bytes.Equal(encoded, standard) {
							failures[worker] = fmt.Errorf("encoder %s differs from encoding/json: input=%q index=%d", request.Encoder, workload.Input, index)
							break
						}
						values[position] = map[string]any{"index": index, "json": string(encoded), "encodedLength": len(encoded), "stdlibEqual": true}
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
					lastJSON, err = encode(lastResult)
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
	data, err := json.Marshal(map[string]any{"runtime": runtime.Version(), "gomaxprocs": runtime.GOMAXPROCS(0), "encoder": request.Encoder, "preflightStdlibByteEquality": request.Phase == "preflight", "cases": cases, "memory": memory})
	if err != nil {
		t.Fatalf("JSON benchmark output: %v; cases=%+v", err, cases)
	}
	fmt.Printf("DICECORE_JSON %s\n", data)
}
