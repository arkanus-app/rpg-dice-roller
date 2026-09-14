package dicecore

import (
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"testing"
)

var eventJSONTestError = errors.New("event JSON test error")

type eventJSONFailure struct{}

func (eventJSONFailure) MarshalJSON() ([]byte, error) { return nil, eventJSONTestError }

func TestDiceRollResultJSONMatchesStandardEnvelope(t *testing.T) {
	type standardResult DiceRollResult
	for _, input := range []string{"1d20+5", "100d6", "20d6!2ro=1kh10", "{2d6,3d6}sd"} {
		result, err := RollRPGDice(input, RollOptions{Seed: "event-envelope"})
		if err != nil {
			t.Fatal(err)
		}
		result.Comment = "<>&🎲\n\u2028\""
		for _, events := range [][]ResolvedEvent{nil, {}, result.Events} {
			result.Events = events
			got, err := json.Marshal(result)
			if err != nil {
				t.Fatal(err)
			}
			want, err := json.Marshal(struct {
				*standardResult
				Events []ResolvedEvent `json:"events"`
			}{(*standardResult)(result), result.Events})
			if err != nil || string(got) != string(want) {
				t.Fatalf("envelope differs: %s, %v; want %s", got, err, want)
			}
			var decoded, reference any
			if json.Unmarshal(got, &decoded) != nil || json.Unmarshal(want, &reference) != nil || !reflect.DeepEqual(decoded, reference) {
				t.Fatal("encoded result changed JSON values")
			}
		}
	}
}

func TestDiceRollResultJSONPreservesMutationsAndErrors(t *testing.T) {
	result, err := RollRPGDice("1d6", RollOptions{Seed: "event-envelope"})
	if err != nil {
		t.Fatal(err)
	}
	result.Events[0].Value = 7.25
	wire, err := json.Marshal(result)
	var decoded struct{ Events []struct{ Value float64 } }
	if err != nil || json.Unmarshal(wire, &decoded) != nil || decoded.Events[0].Value != 7.25 {
		t.Fatal("caller event mutation not encoded", err)
	}
	result.Events[0].Value = math.NaN()
	if _, err = json.Marshal(result); err == nil {
		t.Fatal("non-finite event value encoded")
	}
	result.Events = nil
	result.Dice[0].Sides = eventJSONFailure{}
	if _, err = json.Marshal(result); !errors.Is(err, eventJSONTestError) {
		t.Fatal("custom marshaler error lost", err)
	}
	legacy := ResolvedEvent{legacy: DiceEvent{"value": 3}}
	result.Dice = nil
	result.Events = []ResolvedEvent{legacy}
	if _, err = json.Marshal(result); err != nil {
		t.Fatal("legacy event cannot be encoded in shared buffer", err)
	}
	result.Events[0].legacy["value"] = eventJSONFailure{}
	if _, err = json.Marshal(result); !errors.Is(err, eventJSONTestError) {
		t.Fatal("legacy marshaler error lost", err)
	}
}
