package dicecore

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
)

type systemJSONShape struct{ data string }

func (shape systemJSONShape) MarshalJSON() ([]byte, error) { return []byte(shape.data), nil }

func TestSystemNativeInputsAndDefaults(t *testing.T) {
	seed := SystemRollOptions{RollOptions: RollOptions{Seed: "native-system-inputs"}}
	one := int64(1)
	two := int64(2)
	fate, err := RollFateDice(&FateRollInput{Dice: &one}, seed)
	if err != nil || fate.DiceCount != 1 {
		t.Fatal(fate, err)
	}
	assimilation, err := RollAssimilation(AssimilationRollInput{D6: 1, D10: 1, Keep: &two}, seed)
	if err != nil || assimilation.TotalDice != 2 || assimilation.Keep != 2 {
		t.Fatal(assimilation, err)
	}
	selected, err := EvaluateAssimilationSelection(assimilation, []string{assimilation.Dice[1].ID, assimilation.Dice[0].ID})
	if err != nil || selected.SelectedIDs[0] != assimilation.Dice[1].ID {
		t.Fatal(selected, err)
	}
	dagger, err := RollDaggerheart(&DaggerheartRollInput{Modifier: &one, Difficulty: &two}, seed)
	if err != nil || dagger.Modifier != 1 || dagger.Difficulty == nil || *dagger.Difficulty != 2 {
		t.Fatal(dagger, err)
	}
	vampire, err := RollVampireV5(VampireV5RollInput{Pool: 2, Hunger: 0, Difficulty: &one}, seed)
	if err != nil || vampire.NormalDice != 2 {
		t.Fatal(vampire, err)
	}
	base := &fixtureSystemEngine{Engine: DefaultDiceEngine(), result: &DiceRollResult{Dice: []ResolvedDie{{ID: "one", Sides: int64(6), RawValue: 1}, {ID: "two", Sides: int64(6), RawValue: 2}}}}
	defaultFate, err := RollFateDiceWithEngine(base, nil)
	if err != nil || defaultFate.DiceCount != 4 {
		t.Fatal(defaultFate, err)
	}
	defaultDagger, err := RollDaggerheartWithEngine(base, nil)
	if err != nil || defaultDagger.Modifier != 0 {
		t.Fatal(defaultDagger, err)
	}
	for _, input := range []any{(*FateRollInput)(nil), map[string]any(nil), systemJSONShape{"null"}, systemJSONShape{"[]"}, struct {
		Dice float64 `json:"dice"`
	}{math.NaN()}} {
		_, err := RollFateDice(input, seed)
		requireErrorCode(t, err, "INVALID_SYSTEM_INPUT")
	}
	source, err := readSystemInput(systemJSONShape{`{"dice":1}`}, "fate")
	if err != nil || source["dice"] != float64(1) {
		t.Fatal(source, err)
	}
}

func TestSystemRollerKeepsEnginePolicy(t *testing.T) {
	engine, err := CreateDiceEngine(DiceEngineOptions{Limits: DiceLimitOverrides{"maxInitialDice": 2}, RandomAlgorithm: Xoshiro128SS})
	if err != nil {
		t.Fatal(err)
	}
	roller, err := CreateSystemRoller(engine)
	if err != nil {
		t.Fatal(err)
	}
	opts := SystemRollOptions{RollOptions: RollOptions{Seed: "bound-engine"}}
	one := int64(1)
	fate, err := roller.RollFateDice(FateRollInput{Dice: &one}, opts)
	if err != nil || fate.BaseRoll.(*DiceRollResult).Replay.Algorithm != Xoshiro128SS {
		t.Fatal(fate, err)
	}
	if _, err = roller.RollAssimilation(AssimilationRollInput{D6: 1}, opts); err != nil {
		t.Fatal(err)
	}
	if _, err = roller.RollDaggerheart(nil, opts); err != nil {
		t.Fatal(err)
	}
	if _, err = roller.RollVampireV5(VampireV5RollInput{Pool: 1, Hunger: 1}, opts); err != nil {
		t.Fatal(err)
	}
	if _, err = roller.RollMixedDice("d1;fate(1)", opts); err != nil {
		t.Fatal(err)
	}
	_, err = roller.RollFateDice(nil, opts)
	requireErrorCode(t, err, "TOO_MANY_INITIAL_DICE")
	for _, invalid := range []SystemEngine{nil, (*Engine)(nil)} {
		if _, err = CreateSystemRoller(invalid); err == nil || err.Error() != "createSystemRoller requires a DiceEngine" {
			t.Fatal(err)
		}
	}
}

func TestSystemTypedMixedReplay(t *testing.T) {
	for _, detail := range []string{"full", "compact"} {
		first, err := RollMixedDice("d6; fate(2); dh(1,12)", SystemRollOptions{RollOptions: RollOptions{Seed: "typed-replay"}, Detail: detail})
		if err != nil {
			t.Fatal(err)
		}
		for _, descriptor := range []any{first.Replay, &first.Replay} {
			again, err := RollMixedDice(first.Input, SystemRollOptions{RollOptions: RollOptions{Replay: descriptor}, Detail: detail})
			if err != nil {
				t.Fatal(err)
			}
			before, _ := json.Marshal(first)
			after, _ := json.Marshal(again)
			if string(before) != string(after) {
				t.Fatalf("typed replay changed output\n%s\n%s", before, after)
			}
		}
	}
	_, err := RollMixedDice("d6", SystemRollOptions{RollOptions: RollOptions{Replay: (*MixedRollReplayDescriptor)(nil)}})
	requireErrorCode(t, err, "INVALID_REPLAY")
}

func TestSystemMixedReplayJSONRejectsUnknownKeys(t *testing.T) {
	first, err := RollMixedDice("d6; fate(2)", SystemRollOptions{RollOptions: RollOptions{Seed: "json-replay"}})
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(first.Replay)
	if err != nil {
		t.Fatal(err)
	}
	var replay MixedRollReplayDescriptor
	if err := json.Unmarshal(data, &replay); err != nil {
		t.Fatal(err)
	}
	again, err := RollMixedDice(first.Input, SystemRollOptions{RollOptions: RollOptions{Replay: replay}})
	if err != nil || !reflect.DeepEqual(first, again) {
		t.Fatal("JSON replay changed the roll", err)
	}
	for _, malformed := range []string{
		"null", "[]", "{}",
		strings.Replace(string(data), `"type":"mixed-roll-replay"`, `"type":"mixed-roll-replay","extra":1`, 1),
		strings.Replace(string(data), `"schemaVersion":1`, `"schemaVersion":2`, 1),
		strings.Replace(string(data), `"kind":"generic"`, `"kind":"generic","extra":1`, 1),
		`{"type":"mixed-roll-replay","schemaVersion":1,"notation":"d6","rolls":[null]}`,
	} {
		var invalid MixedRollReplayDescriptor
		err := json.Unmarshal([]byte(malformed), &invalid)
		requireErrorCode(t, err, "INVALID_REPLAY")
	}
	// encoding/json rejects malformed JSON before invoking a custom unmarshaler;
	// the direct boundary also reports the library's stable error contract.
	requireErrorCode(t, replay.UnmarshalJSON([]byte("{")), "INVALID_REPLAY")
}

func TestSystemResultCopiesSemanticSlices(t *testing.T) {
	source := ResolvedDie{ID: "x", Sides: int64(6), RawValue: 1, Value: 1}
	symbols := []string{"symbol"}
	first, err := projectSystemDie(source, "profile", "kind", "face", symbols)
	if err != nil {
		t.Fatal(err)
	}
	symbols[0] = "changed"
	if first.Symbols[0] != "symbol" {
		t.Fatal("projection shares input symbol slice")
	}
	engine := &fixtureSystemEngine{Engine: DefaultDiceEngine(), result: &DiceRollResult{Dice: []ResolvedDie{{ID: "x", Sides: int64(6), RawValue: 6, Value: 6}}}}
	roll, err := RollAssimilationWithEngine(engine, AssimilationRollInput{D6: 1})
	if err != nil {
		t.Fatal(err)
	}
	roll.Dice[0].Symbols[0] = "changed"
	again, err := RollAssimilationWithEngine(engine, AssimilationRollInput{D6: 1})
	if err != nil || again.Dice[0].Symbols[0] != "success" {
		t.Fatal("roll corrupted shared face table", err)
	}
}

func TestSystemNameUnicodeAndArgumentOrdering(t *testing.T) {
	for _, tc := range []struct{ input, want string }{{"ASSIMILAÇÃO", "assimilacao"}, {"a\u0301s", "as"}, {"Keep", "keep"}, {"ſẛ", "ſſ"}, {"ＦＡＴＥ", ""}, {"ä_!é", "ae"}} {
		if got := normalizeSystemName(tc.input); got != tc.want {
			t.Fatalf("normalize %s got %s want %s", tc.input, got, tc.want)
		}
	}
	args, err := parseMixedArguments("unknown=1,2=2,01=3,1=4", "input", 1)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(args.names, []string{"1", "2", "unknown", "01"}) {
		t.Fatal(args.names)
	}
	_, err = parseMixedSystem("fate", args, "input", 1)
	if err == nil || !strings.Contains(err.Error(), "unknown argument '1'") {
		t.Fatal(err)
	}
	huge := strings.Repeat("9", 400)
	_, err = parseMixedInteger(huge, "input", 1)
	requireErrorCode(t, err, "INVALID_NOTATION")
}

func TestSystemMixedRuntimeBudgetDefinitions(t *testing.T) {
	stats := ExecutionStats{Rolls: 1, InitialDice: 1, GeneratedDice: 1, RandomCalls: 1, Events: 1, ModifierSteps: 1, ResolvedGroups: 1, ResultItems: 1}
	limits := DefaultDiceLimits()
	for _, field := range limitFields(&limits) {
		*field.value = 1
	}
	if err := assertMixedRuntimeBudgets(stats, limits, "input"); err != nil {
		t.Fatal(err)
	}
	for index, definition := range mixedStatsDefinitions {
		failure := ExecutionStats{}
		fields := []*int64{&failure.Rolls, &failure.InitialDice, &failure.GeneratedDice, &failure.RandomCalls, &failure.Events, &failure.ModifierSteps, &failure.ResolvedGroups, &failure.ResultItems}
		*fields[index] = 2
		err := assertMixedRuntimeBudgets(failure, limits, "input")
		requireErrorCode(t, err, definition.code)
		if err.Error() != fmt.Sprintf("Mixed roll exceeds %s", definition.limit) {
			t.Fatal(err)
		}
	}
	remaining := mixedRemainingLimits(limits, stats, 1)
	for _, definition := range mixedStatsDefinitions {
		if remaining[definition.limit] != 1 {
			t.Fatal(remaining)
		}
	}
}
