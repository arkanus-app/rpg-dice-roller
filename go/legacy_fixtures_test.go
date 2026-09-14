package dicecore

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"
)

type legacyCompatibilityResult struct {
	Total            float64      `json:"total"`
	RollTotals       []float64    `json:"rollTotals"`
	DiceValuesByRoll [][]float64  `json:"diceValuesByRoll"`
	Pool             *PoolSummary `json:"pool"`
}

// This is the frozen pre-removal V2/V3 corpus, not regenerated Go output.
func TestLegacyCompatibilityCorpus(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "compatibility-corpus.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		SchemaVersion int `json:"schemaVersion"`
		Seeds         []struct {
			Name  string    `json:"name"`
			Words [4]uint32 `json:"words"`
		} `json:"seeds"`
		Cases []struct {
			Notation           string                      `json:"notation"`
			NormalizedNotation string                      `json:"normalizedNotation"`
			Outcomes           []legacyCompatibilityResult `json:"outcomes"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.SchemaVersion != 1 || len(fixture.Cases) != 31 || len(fixture.Seeds) != 2 {
		t.Fatal("historical corpus must contain all 31 notations and both seeds")
	}
	for _, entry := range fixture.Cases {
		t.Run(entry.Notation, func(t *testing.T) {
			if got := NormalizeRPGDiceNotation(entry.Notation); got != entry.NormalizedNotation {
				t.Fatalf("normalization: got %q, want %q", got, entry.NormalizedNotation)
			}
			if len(entry.Outcomes) != len(fixture.Seeds) {
				t.Fatal("historical outcome is missing")
			}
			for index, seed := range fixture.Seeds {
				t.Run(seed.Name, func(t *testing.T) {
					plan, err := CompileRPGDice(entry.Notation)
					if err != nil {
						t.Fatal(err)
					}
					replay := ReplayDescriptor{SchemaVersion: 2, Algorithm: MT19937, AlgorithmVersion: 1,
						ExecutionVersion: 1, MathProfile: "decimal12-v1", Origin: SeedCrypto,
						SeedMaterial:    fmt.Sprintf("%08x%08x%08x%08x", seed.Words[0], seed.Words[1], seed.Words[2], seed.Words[3]),
						PlanFingerprint: plan.PlanFingerprint}
					result, err := RollRPGDice(plan, RollOptions{Replay: replay})
					if err != nil {
						t.Fatal(err)
					}
					actual := legacyCompatibilityResult{Total: result.Total, Pool: result.Pool,
						RollTotals: make([]float64, len(result.Rolls)), DiceValuesByRoll: make([][]float64, len(result.Rolls))}
					for rollIndex, roll := range result.Rolls {
						actual.RollTotals[rollIndex] = roll.Total
						values := make([]float64, 0, roll.DiceRange.Count)
						for _, die := range result.Dice[roll.DiceRange.Start : roll.DiceRange.Start+roll.DiceRange.Count] {
							values = append(values, die.Value)
						}
						slices.Sort(values)
						actual.DiceValuesByRoll[rollIndex] = values
					}
					if !reflect.DeepEqual(actual, entry.Outcomes[index]) {
						t.Errorf("historical result differs\ngot  %#v\nwant %#v", actual, entry.Outcomes[index])
					}
				})
			}
		})
	}
}

func TestLegacyFullRollReplayFixtures(t *testing.T) {
	cases := loadFixtureCases(t, "full-roll-replay.json")
	if len(cases) != 5 {
		t.Fatal("all five historical full-roll vectors must be present")
	}
	for _, raw := range cases {
		var fixture struct {
			Name    string          `json:"name"`
			Input   string          `json:"input"`
			Kind    string          `json:"kind"`
			Options RollOptions     `json:"options"`
			Outcome json.RawMessage `json:"outcome"`
		}
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
		t.Run(fixture.Name, func(t *testing.T) {
			switch fixture.Kind {
			case "generic":
				result, err := RollRPGDice(fixture.Input, fixture.Options)
				assertFixtureOutcome(t, fixture.Outcome, result, err)
			case "mixed":
				result, err := RollMixedDice(fixture.Input, MixedRollOptions{RollOptions: fixture.Options})
				assertFixtureOutcome(t, fixture.Outcome, result, err)
			default:
				t.Fatalf("unsupported historical vector kind %q", fixture.Kind)
			}
		})
	}
}
