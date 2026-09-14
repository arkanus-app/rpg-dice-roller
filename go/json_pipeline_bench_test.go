package dicecore

import (
	"bytes"
	"encoding/json"
	"fmt"
	"testing"
)

// Measure the public full-roll API and owned JSON bytes together. Engines have
// warm notation caches; seeds rotate so repeated seed initialization is not the
// only workload. The extra expressions are validation holdouts for optimizations
// selected with BenchmarkRollJSON's d20, 100d6 and modifier pool.
func BenchmarkRollAndJSON(b *testing.B) {
	for _, workload := range []struct{ name, input string }{
		{"d20", "1d20+5"},
		{"100d6", "100d6"},
		{"pool", "20d6!2ro=1kh10"},
		{"keep", "4d6kh3"},
		{"successes", "40d10>=7f=1"},
		{"unicode", "8d6+2 # ação 🎲"},
		{"fraction", "8d6min2.5max5.5"},
	} {
		b.Run(workload.name, func(b *testing.B) {
			engine, err := CreateDiceEngine(DiceEngineOptions{FreezeResults: "never", RandomAlgorithm: MT19937})
			if err != nil {
				b.Fatal(err)
			}
			options := make([]RollOptions, 128)
			for index := range options {
				options[index] = RollOptions{Seed: fmt.Sprintf("json-pipeline/%d", index), RandomAlgorithm: MT19937}
				result, err := engine.Roll(workload.input, options[index])
				if err != nil {
					b.Fatal(err)
				}
				standard, err := json.Marshal(result)
				if err != nil {
					b.Fatal(err)
				}
				actual, err := MarshalJSON(result)
				if err != nil || !bytes.Equal(actual, standard) {
					b.Fatalf("JSON differs from encoding/json: seed=%d err=%v", index, err)
				}
			}
			index := 0
			b.ReportAllocs()
			for b.Loop() {
				result, err := engine.Roll(workload.input, options[index%len(options)])
				if err != nil {
					b.Fatal(err)
				}
				rollJSONEncodingSink, err = MarshalJSON(result)
				if err != nil {
					b.Fatal(err)
				}
				index++
			}
		})
	}
}
