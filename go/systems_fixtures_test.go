package dicecore

import (
	"encoding/json"
	"fmt"
	"testing"
)

func runSystemFixture(system string, input any, options SystemRollOptions) (any, error) {
	switch system {
	case "fate":
		return RollFateDice(input, options)
	case "assimilation":
		return RollAssimilation(input, options)
	case "daggerheart":
		return RollDaggerheart(input, options)
	case "vampire-v5":
		return RollVampireV5(input, options)
	default:
		return RollMixedDice(input, options)
	}
}
func runBoundSystemFixture(engine SystemEngine, system string, input any, options SystemRollOptions) (any, error) {
	switch system {
	case "fate":
		return RollFateDiceWithEngine(engine, input, options)
	case "assimilation":
		return RollAssimilationWithEngine(engine, input, options)
	case "daggerheart":
		return RollDaggerheartWithEngine(engine, input, options)
	case "vampire-v5":
		return RollVampireV5WithEngine(engine, input, options)
	default:
		return RollMixedDiceWithEngine(engine, input, options)
	}
}

type systemFixtureCase struct {
	Name          string
	System        string
	Input         any
	Options       SystemRollOptions
	Outcome       json.RawMessage
	EngineResult  *DiceRollResult
	EngineDetails *DiceRollDetails
	InjectedError bool
}

func TestSystemRollFixtures(t *testing.T) {
	for _, raw := range loadFixtureCases(t, "systems-rolls.json") {
		var fixture systemFixtureCase
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
		t.Run(fixture.Name, func(t *testing.T) {
			result, err := runSystemFixture(fixture.System, fixture.Input, fixture.Options)
			assertFixtureOutcome(t, fixture.Outcome, result, err)
		})
	}
}

type fixtureSystemEngine struct {
	*Engine
	result  *DiceRollResult
	details *DiceRollDetails
	failure error
}

func (engine *fixtureSystemEngine) Roll(any, ...RollOptions) (*DiceRollResult, error) {
	return engine.result, engine.failure
}
func (engine *fixtureSystemEngine) RollDetails(any, ...RollOptions) (*DiceRollDetails, error) {
	return engine.details, engine.failure
}
func TestSystemEngineContractFixtures(t *testing.T) {
	for _, raw := range loadFixtureCases(t, "systems-contracts.json") {
		var fixture systemFixtureCase
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
		t.Run(fixture.Name, func(t *testing.T) {
			engine := &fixtureSystemEngine{Engine: DefaultDiceEngine(), result: fixture.EngineResult, details: fixture.EngineDetails}
			if fixture.InjectedError {
				engine.failure = fmt.Errorf("injected engine failure")
			}
			result, err := runBoundSystemFixture(engine, fixture.System, fixture.Input, fixture.Options)
			assertFixtureOutcome(t, fixture.Outcome, result, err)
		})
	}
}
func TestSystemSelectionFixtures(t *testing.T) {
	for _, raw := range loadFixtureCases(t, "systems-selection.json") {
		var fixture struct {
			Name        string
			Roll        *AssimilationRollResult
			SelectedIDs any
			Outcome     json.RawMessage
		}
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
		t.Run(fixture.Name, func(t *testing.T) {
			result, err := EvaluateAssimilationSelection(fixture.Roll, fixture.SelectedIDs)
			assertFixtureOutcome(t, fixture.Outcome, result, err)
		})
	}
}

func TestSystemUnicodeNameFixtures(t *testing.T) {
	for _, raw := range loadFixtureCases(t, "systems-names.json") {
		var fixture struct {
			Name    string
			Input   string
			Outcome json.RawMessage
		}
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
		t.Run(fixture.Name, func(t *testing.T) { assertFixtureOutcome(t, fixture.Outcome, normalizeSystemName(fixture.Input), nil) })
	}
}
