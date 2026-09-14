package dicecore

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sync"
	"testing"
)

type nodeCompareRequest struct {
	backendRequest
	LatencyRequests int `json:"latencyRequests"`
}

type nodeCompareCPUReading struct {
	Available bool   `json:"available"`
	UserNs    int64  `json:"userNs"`
	SystemNs  int64  `json:"systemNs"`
	Source    string `json:"source"`
	Reason    string `json:"reason,omitempty"`
}

type nodeCompareClockInfo struct {
	Source      string `json:"source"`
	FrequencyHz int64  `json:"frequencyHz,omitempty"`
}

func nodeCompareCPUDelta(before, after nodeCompareCPUReading) map[string]any {
	if !before.Available || !after.Available || before.Source != after.Source || after.UserNs < before.UserNs || after.SystemNs < before.SystemNs {
		return map[string]any{"available": false, "reason": "process CPU readings unavailable or non-monotonic", "before": before, "after": after}
	}
	user, system := after.UserNs-before.UserNs, after.SystemNs-before.SystemNs
	return map[string]any{"available": true, "userNs": user, "systemNs": system, "totalNs": user + system, "source": after.Source, "before": before, "after": after}
}

func nodeCompareDigestAdd(total *jsonBenchmarkDigest, value jsonBenchmarkDigest) {
	total.Count += value.Count
	total.Total += value.Total
	total.WeightedTotal += value.WeightedTotal
	total.RandomCalls += value.RandomCalls
	total.EncodedLength += value.EncodedLength
}

// Baseline and candidate compile this identical test-only worker. Every timed
// operation builds a full result and returns owned bytes through MarshalJSON.
// CPU counters surround the batch timer; RSS is read after both have stopped.
// Individual timings run in a separate pass after all throughput batches.
func TestNodeCompareBenchmarkWorker(t *testing.T) {
	if os.Getenv("DICECORE_NODE_COMPARE_WORKER") != "1" {
		t.Skip("external Node-only runtime comparison worker")
	}
	var request nodeCompareRequest
	if err := json.NewDecoder(os.Stdin).Decode(&request); err != nil {
		t.Fatal(err)
	}
	if request.Workers < 1 || request.Requests < request.Workers || request.Samples < 1 || request.Warmup < 0 || request.LatencyRequests < request.Workers || request.LatencyRequests > request.Requests || request.EngineMode != "pool" || (request.Phase != "preflight" && request.Phase != "measure") {
		t.Fatal("invalid Node comparison request")
	}
	// Resolve the clock and its fixed frequency before starting any worker or
	// timer. Windows time.Now can be too coarse for individual dice operations.
	clockInfo, err := nodeCompareClockSetup()
	if err != nil {
		t.Fatal(err)
	}
	batchClock := &nodeCompareClock{}
	cases, memory, latency := map[string]any{}, map[string]any{}, map[string]any{}
	for _, workload := range request.Workloads {
		if workload.Mode != "full" {
			t.Fatal("Node comparison requires full results")
		}
		var ready, done, latencyFinished sync.WaitGroup
		ready.Add(request.Workers)
		done.Add(request.Workers)
		latencyFinished.Add(request.Workers)
		release, latencyStart := make(chan struct{}), make(chan struct{})
		starts := make([]chan struct{}, request.Samples)
		finished := make([]sync.WaitGroup, request.Samples)
		digests := make([][]jsonBenchmarkDigest, request.Samples)
		for sample := range starts {
			starts[sample] = make(chan struct{})
			finished[sample].Add(request.Workers)
			digests[sample] = make([]jsonBenchmarkDigest, request.Workers)
		}
		failures := make([]error, request.Workers)
		values := make([]any, len(request.ValidationIndices))
		latencyValues := make([][]int64, request.Workers)
		latencyDigests := make([]jsonBenchmarkDigest, request.Workers)
		for worker := range request.Workers {
			go func(worker int) {
				defer done.Done()
				// Windows QPC writes through a reusable scratch field. Each worker
				// owns one clock, allocated before its warmup and timed operations.
				callClock := &nodeCompareClock{}
				completed, completedLatency := 0, false
				defer func() {
					for sample := completed; sample < request.Samples; sample++ {
						finished[sample].Done()
					}
					if !completedLatency {
						latencyFinished.Done()
					}
				}()
				engine, err := CreateDiceEngine(DiceEngineOptions{FreezeResults: "never", RandomAlgorithm: MT19937})
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
						standard, err := json.Marshal(result)
						if err != nil {
							failures[worker] = err
							break
						}
						encoded, err := MarshalJSON(result)
						if err != nil || !bytes.Equal(encoded, standard) {
							failures[worker] = fmt.Errorf("direct/stdlib JSON mismatch for %q index %d: %v", workload.Input, index, err)
							break
						}
						values[position] = map[string]any{"index": index, "json": string(encoded), "encodedLength": len(encoded), "stdlibEqual": true}
					}
					ready.Done()
					return
				}
				latencyValues[worker] = make([]int64, (request.LatencyRequests-1-worker)/request.Workers+1)
				var lastResult *DiceRollResult
				var lastJSON []byte
				run := func(localIndex int) error {
					lastResult, err = engine.Roll(workload.Input, options[localIndex])
					if err != nil {
						return err
					}
					lastJSON, err = MarshalJSON(lastResult)
					return err
				}
				updateDigest := func(digest *jsonBenchmarkDigest, index int) {
					digest.Count++
					digest.Total += lastResult.Total
					digest.WeightedTotal += float64(index+1) * lastResult.Total
					digest.RandomCalls += lastResult.Stats.RandomCalls
					digest.EncodedLength += int64(len(lastJSON))
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
						updateDigest(&digest, index)
					}
					digests[sample][worker] = digest
					completed++
					finished[sample].Done()
				}
				<-latencyStart
				var latencyDigest jsonBenchmarkDigest
				for index := worker; index < request.LatencyRequests; index += request.Workers {
					started := callClock.now()
					if err := run(index / request.Workers); err != nil {
						failures[worker] = err
						return
					}
					latencyValues[worker][index/request.Workers] = callClock.elapsed(started)
					updateDigest(&latencyDigest, index)
				}
				latencyDigests[worker] = latencyDigest
				completedLatency = true
				latencyFinished.Done()
				<-release
				runtime.KeepAlive(engine)
				runtime.KeepAlive(options)
				runtime.KeepAlive(lastResult)
				runtime.KeepAlive(lastJSON)
			}(worker)
		}
		ready.Wait()
		measurements := make([]any, request.Samples)
		memoryBefore := backendRSS()
		memoryAfter := make([]any, request.Samples)
		if request.Phase == "measure" {
			for sample := range starts {
				cpuBefore := nodeCompareCPU()
				started := batchClock.now()
				close(starts[sample])
				finished[sample].Wait()
				duration := batchClock.elapsed(started)
				cpuAfter := nodeCompareCPU()
				memoryAfter[sample] = backendRSS()
				var digest jsonBenchmarkDigest
				for _, value := range digests[sample] {
					nodeCompareDigestAdd(&digest, value)
				}
				measurements[sample] = map[string]any{"durationNs": duration, "requests": request.Requests, "workers": request.Workers, "digest": digest, "cpu": nodeCompareCPUDelta(cpuBefore, cpuAfter)}
			}
			close(latencyStart)
			latencyFinished.Wait()
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
		cases[workload.ID] = measurements
		memory[workload.ID] = map[string]any{"afterWarmup": memoryBefore, "afterBatches": memoryAfter}
		var latencyDigest jsonBenchmarkDigest
		for _, digest := range latencyDigests {
			nodeCompareDigestAdd(&latencyDigest, digest)
		}
		latency[workload.ID] = map[string]any{"samplesByWorkerNs": latencyValues, "requests": request.LatencyRequests, "digest": latencyDigest}
	}
	data, err := json.Marshal(map[string]any{"runtime": runtime.Version(), "gomaxprocs": runtime.GOMAXPROCS(0), "encoder": "dicecore.MarshalJSON", "clock": clockInfo, "cases": cases, "memory": memory, "latency": latency})
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("DICECORE_NODE_COMPARE %s\n", data)
}
