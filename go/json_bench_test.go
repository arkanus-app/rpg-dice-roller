package dicecore

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

var rollJSONEncodingSink []byte

// Both variants use the same benchmark name, result and function signature.
// The result is built once; each iteration returns owned bytes without a
// caller-provided buffer, so this measures encoding rather than rolling.
func BenchmarkRollJSON(b *testing.B) {
	var encode func(any) ([]byte, error)
	switch os.Getenv("DICECORE_JSON_ENCODER") {
	case "", "std":
		encode = json.Marshal
	case "direct":
		encode = MarshalJSON
	default:
		b.Fatal("invalid DICECORE_JSON_ENCODER: expected std or direct")
	}
	workloads := []struct {
		id    string
		input string
	}{
		{"d20", "1d20+5"},
		{"100d6", "100d6"},
		{"pool", "20d6!2ro=1kh10"},
	}
	for _, workload := range workloads {
		b.Run(workload.id, func(b *testing.B) {
			for _, mode := range []string{"summary", "details", "full"} {
				b.Run(mode, func(b *testing.B) {
					engine, err := CreateDiceEngine(DiceEngineOptions{FreezeResults: "never", RandomAlgorithm: MT19937})
					if err != nil {
						b.Fatal(err)
					}
					options := RollOptions{Seed: "event-json-throughput", RandomAlgorithm: MT19937}
					var result any
					switch mode {
					case "summary":
						result, err = engine.RollSummary(workload.input, options)
					case "details":
						result, err = engine.RollDetails(workload.input, options)
					case "full":
						result, err = engine.Roll(workload.input, options)
					}
					if err != nil {
						b.Fatal(err)
					}
					standard, err := json.Marshal(result)
					if err != nil {
						b.Fatal(err)
					}
					actual, err := encode(result)
					if err != nil {
						b.Fatal(err)
					}
					if !bytes.Equal(actual, standard) {
						b.Fatal("encoder differs from encoding/json before timing")
					}
					b.ReportAllocs()
					for b.Loop() {
						rollJSONEncodingSink, err = encode(result)
						if err != nil {
							b.Fatal(err)
						}
					}
				})
			}
		})
	}
}
