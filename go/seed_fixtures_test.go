package dicecore

import (
	"encoding/json"
	"testing"
)

func seedFixtureProjection(seed SeedMaterial) map[string]any {
	return map[string]any{
		"canonicalSeed": seed.CanonicalSeed, "seedMaterial": seed.SeedMaterial,
		"origin": seed.Origin, "words": seed.Words,
	}
}

func TestSeedTypeScriptFixtures(t *testing.T) {
	for _, raw := range loadFixtureCases(t, "seeds.json") {
		var example struct {
			Name          string          `json:"name"`
			SeedType      string          `json:"seedType"`
			Seed          json.RawMessage `json:"seed"`
			SeedUTF16     UTF16Seed       `json:"seedUTF16"`
			MaxSeedLength json.RawMessage `json:"maxSeedLength"`
			Outcome       json.RawMessage `json:"outcome"`
		}
		if err := json.Unmarshal(raw, &example); err != nil {
			t.Fatal(err)
		}
		t.Run(example.Name, func(t *testing.T) {
			var input any = example.SeedUTF16
			if example.SeedType == "number" {
				input = randomFixtureNumber(t, example.Seed)
			}
			var limits []int64
			if len(example.MaxSeedLength) > 0 {
				limits = []int64{randomFixtureInteger(t, example.MaxSeedLength)}
			}
			seed, err := CreateProvidedSeed(input, limits...)
			assertFixtureOutcome(t, example.Outcome, seedFixtureProjection(seed), err)
		})
	}
}
