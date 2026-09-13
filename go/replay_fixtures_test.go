package dicecore

import (
	"encoding/json"
	"testing"
)

func TestReplayTypeScriptFixtures(t *testing.T) {
	for _, raw := range loadFixtureCases(t, "replay.json") {
		var example struct {
			Name                    string          `json:"name"`
			Descriptor              any             `json:"descriptor"`
			ExpectedPlanFingerprint *string         `json:"expectedPlanFingerprint"`
			IsReplayDescriptor      bool            `json:"isReplayDescriptor"`
			Outcome                 json.RawMessage `json:"outcome"`
			SeedOutcome             json.RawMessage `json:"seedOutcome"`
		}
		if err := json.Unmarshal(raw, &example); err != nil {
			t.Fatal(err)
		}
		t.Run(example.Name, func(t *testing.T) {
			if IsReplayDescriptor(example.Descriptor) != example.IsReplayDescriptor {
				t.Fatal("descriptor predicate differs from TypeScript")
			}
			var fingerprint []string
			if example.ExpectedPlanFingerprint != nil {
				fingerprint = []string{*example.ExpectedPlanFingerprint}
			}
			replay, err := ValidateReplayDescriptor(example.Descriptor, fingerprint...)
			assertFixtureOutcome(t, example.Outcome, replay, err)
			seed, err := CreateReplaySeed(example.Descriptor, fingerprint...)
			assertFixtureOutcome(t, example.SeedOutcome, seedFixtureProjection(seed), err)
		})
	}
}
