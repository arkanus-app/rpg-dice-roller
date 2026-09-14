package dicecore

import (
	"encoding/json"
	"testing"
)

func TestEngineTypeScriptFixtures(t *testing.T) {
	for _, raw := range loadFixtureCases(t, "engine.json") {
		var tc struct {
			Name    string
			Options struct {
				Limits          DiceLimitOverrides
				FreezeResults   string
				RandomAlgorithm RandomAlgorithm
				Cache           json.RawMessage
			}
			Outcome    json.RawMessage
			Operations []struct {
				Method, Plan, Save, SaveReplay, Replay string
				Input                                  any
				Options                                RollOptions
				Clone                                  bool
				Patch                                  map[string]any
				Outcome, Stats                         json.RawMessage
			}
		}
		if err := json.Unmarshal(raw, &tc); err != nil {
			t.Fatal(err)
		}
		t.Run(tc.Name, func(t *testing.T) {
			option := DiceEngineOptions{Limits: tc.Options.Limits, FreezeResults: tc.Options.FreezeResults, RandomAlgorithm: tc.Options.RandomAlgorithm}
			if len(tc.Options.Cache) > 0 {
				var overrides DiceCacheOptions
				if json.Unmarshal(tc.Options.Cache, &overrides) == nil {
					option.Cache = overrides
				} else {
					if err := json.Unmarshal(tc.Options.Cache, &option.Cache); err != nil {
						t.Fatal(err)
					}
				}
			}
			engine, err := CreateDiceEngine(option)
			var value any
			if engine != nil {
				value = engine.Limits()
			}
			assertFixtureOutcome(t, tc.Outcome, value, err)
			if err != nil {
				return
			}
			saved := make(map[string]any)
			for index, operation := range tc.Operations {
				input := operation.Input
				if operation.Plan != "" {
					input = saved[operation.Plan]
				}
				if operation.Clone {
					encoded, err := json.Marshal(input)
					if err != nil {
						t.Fatal(err)
					}
					var object map[string]any
					if err := json.Unmarshal(encoded, &object); err != nil {
						t.Fatal(err)
					}
					for key, value := range operation.Patch {
						object[key] = value
					}
					input = object
				}
				options := operation.Options
				if operation.Replay != "" {
					options.Replay = saved[operation.Replay]
				}
				value, err = nil, nil
				switch operation.Method {
				case "compile":
					value, err = engine.Compile(input.(string), CompileOptions{Limits: options.Limits})
				case "inspect":
					value = engine.Inspect(input.(string), CompileOptions{Limits: options.Limits})
				case "verify":
					value = engine.Verify(input.(string), CompileOptions{Limits: options.Limits})
				case "normalize":
					value = engine.Normalize(input.(string))
				case "roll":
					value, err = engine.Roll(input, options)
				case "rollDetails":
					value, err = engine.RollDetails(input, options)
				case "rollSummary":
					value, err = engine.RollSummary(input, options)
				case "clearCache":
					engine.ClearCache()
				default:
					t.Fatal(operation.Method)
				}
				t.Run(operation.Method+"-"+syntaxNumberString(float64(index)), func(t *testing.T) {
					assertFixtureOutcome(t, operation.Outcome, value, err)
					assertFixtureOutcome(t, json.RawMessage(`{"value":`+string(operation.Stats)+`}`), engine.GetCacheStats(), nil)
				})
				if err == nil {
					if operation.Save != "" {
						saved[operation.Save] = value
					}
					if operation.SaveReplay != "" {
						saved[operation.SaveReplay] = value.(*DiceRollResult).Replay
					}
				}
			}
		})
	}
}
