package dicecore

import (
	"encoding/json"
	"math"
	"testing"
)

func randomFixtureNumber(t *testing.T, raw json.RawMessage) float64 {
	t.Helper()
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if number, ok := value.(float64); ok {
		return number
	}
	switch value {
	case "-0":
		return math.Copysign(0, -1)
	case "NaN":
		return math.NaN()
	case "Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	default:
		t.Fatalf("unexpected numeric fixture: %s", raw)
		return 0
	}
}

func randomFixtureInteger(t *testing.T, raw json.RawMessage) int64 {
	t.Helper()
	value := randomFixtureNumber(t, raw)
	if math.IsNaN(value) || math.IsInf(value, 0) || math.Trunc(value) != value || math.Abs(value) > float64(randomMaxSafeInteger) {
		t.Skip("JS fractional/non-finite input is excluded by Go's uint32/int64 parameter types")
	}
	return int64(value)
}

func TestRandomTypeScriptFixtures(t *testing.T) {
	for _, raw := range loadFixtureCases(t, "rng.json") {
		var example struct {
			Name      string          `json:"name"`
			Algorithm RandomAlgorithm `json:"algorithm"`
			Seed      json.RawMessage `json:"seed"`
			Operation string          `json:"operation"`
			Count     int             `json:"count"`
			Min       json.RawMessage `json:"min"`
			Max       json.RawMessage `json:"max"`
			Outcome   json.RawMessage `json:"outcome"`
		}
		if err := json.Unmarshal(raw, &example); err != nil {
			t.Fatal(err)
		}
		t.Run(example.Name, func(t *testing.T) {
			budget := &testRandomBudget{limit: 1_000_000}
			var source RandomSource
			var err error
			if len(example.Seed) > 0 && example.Seed[0] == '[' {
				var seed []json.RawMessage
				if err := json.Unmarshal(example.Seed, &seed); err != nil {
					t.Fatal(err)
				}
				words := make([]uint32, len(seed))
				for i, word := range seed {
					words[i] = uint32(randomFixtureInteger(t, word)) // JS >>> 0
				}
				if example.Algorithm == MT19937 {
					source, err = NewMersenneTwister19937FromWords(words, budget)
				} else {
					source, err = NewXoshiro128StarStar(words, budget)
				}
			} else {
				source = NewMersenneTwister19937(uint32(randomFixtureInteger(t, example.Seed)), budget)
			}
			var min, max int64
			if example.Operation == "integer" {
				min = randomFixtureInteger(t, example.Min)
				max = randomFixtureInteger(t, example.Max)
			}
			values := make([]any, 0, example.Count)
			for i := 0; i < example.Count && err == nil; i++ {
				var value any
				switch example.Operation {
				case "nextUint32":
					value, err = source.NextUint32()
				case "integer":
					value, err = source.Integer(min, max)
				case "real":
					value, err = source.Real()
				default:
					t.Fatalf("unsupported fixture operation %q", example.Operation)
				}
				if err == nil {
					values = append(values, value)
				}
			}
			assertFixtureOutcome(t, example.Outcome, map[string]any{"values": values, "randomCalls": budget.calls}, err)
		})
	}
}
