package dicecore

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestErrorJSONUnpairedSurrogateRecognition(t *testing.T) {
	for _, test := range []struct {
		input string
		want  bool
	}{
		{`""`, false}, {`"plain"`, false}, {`"🎲"`, false},
		{`"\\ud800"`, false}, {`"\n\t\""`, false}, {`"\u0061"`, false},
		{`"\ud83c\udfb2"`, false}, {`"\uDBFF\uDFFF\ud800\udc00"`, false},
		{`"\ud800"`, true}, {`"\udfff"`, true}, {`"x\udc00y"`, true},
		{`"\ud800abcdefg"`, true}, {`"\ud800\nabcdefg"`, true},
		{`"\ud800\u0061"`, true}, {`"\ud800\ue000"`, true},
		{`"\ud83c\udfb2\ud800"`, true}, {`"\ud800\ud800\udc00"`, true},
	} {
		t.Run(test.input, func(t *testing.T) {
			if !json.Valid([]byte(test.input)) {
				t.Fatal("test must provide syntactically valid JSON")
			}
			if got := errorJSONHasUnpairedSurrogate(json.RawMessage(test.input)); got != test.want {
				t.Errorf("surrogate detection = %v, want %v", got, test.want)
			}
		})
	}
}

func TestErrorJSONPreservesSurrogatesAndMutations(t *testing.T) {
	wire := []byte(`{"name":"DiceRollError","code":"INVALID_NOTATION","message":"bad \ud800","input":"\udfff","span":null,"details":{"found":"\ud83c","nested":[{"unit":"\udc00"},"\ud83c\udfb2","normal",42,true,null],"escaped":"\\ud800"}}`)
	decoded, err := DiceRollErrorFromJSON(wire)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Message != "bad �" || decoded.Input != "�" || !IsDiceRollErrorData(decoded) {
		t.Fatal("public strings or structural error validation changed")
	}
	if got, ok := decoded.Details["found"].(json.RawMessage); !ok || string(got) != `"\ud83c"` {
		t.Fatalf("isolated surrogate was not preserved: %#v", decoded.Details["found"])
	}
	nested := decoded.Details["nested"].([]any)
	if nested[1] != "🎲" || nested[2] != "normal" || nested[3] != float64(42) || nested[4] != true || nested[5] != nil || decoded.Details["escaped"] != `\ud800` {
		t.Fatalf("ordinary details changed: %#v", decoded.Details)
	}
	assertWire := func(value *DiceRollError, required ...string) {
		t.Helper()
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		for _, part := range required {
			if !strings.Contains(string(encoded), part) {
				t.Errorf("JSON lost %s: %s", part, encoded)
			}
		}
	}
	assertWire(decoded, `"input":"\udfff"`, `"message":"bad \ud800"`, `"found":"\ud83c"`, `"unit":"\udc00"`, `"🎲"`)
	// Caller-owned input bytes must not mutate retained JSON strings.
	for index := range wire {
		wire[index] = 'x'
	}
	assertWire(decoded, `"input":"\udfff"`, `"found":"\ud83c"`)
	decoded.Input = "edited input"
	decoded.Message = "edited message"
	decoded.Details["found"] = "edited found"
	nested[0].(map[string]any)["unit"] = "edited nested"
	assertWire(decoded, `"input":"edited input"`, `"message":"edited message"`, `"found":"edited found"`, `"unit":"edited nested"`)
	encoded, err := json.Marshal(decoded)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), `\ud`) {
		// The literal "\\ud800" property remains a normal backslash string.
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(encoded, &fields); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(fields["input"]), `\ud`) || strings.Contains(string(fields["message"]), `\ud`) {
			t.Fatal("stale preserved strings overrode public mutation")
		}
	}
}

func TestScannerErrorJSONSurrogateRoundTrip(t *testing.T) {
	_, scannerErr := TokenizeDiceNotation("🎲")
	wire, err := json.Marshal(scannerErr)
	if err != nil {
		t.Fatal(err)
	}
	for iteration := 0; iteration < 3; iteration++ {
		decoded, err := DiceRollErrorFromJSON(wire)
		if err != nil {
			t.Fatal(err)
		}
		wire, err = json.Marshal(decoded)
		if err != nil {
			t.Fatal(err)
		}
		var envelope struct {
			Details map[string]json.RawMessage `json:"details"`
		}
		if err := json.Unmarshal(wire, &envelope); err != nil {
			t.Fatal(err)
		}
		if string(envelope.Details["found"]) != `"\ud83c"` {
			t.Fatalf("roundtrip %d changed found: %s", iteration, envelope.Details["found"])
		}
	}
}
