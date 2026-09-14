package dicecore

import (
	"encoding/json"
	"testing"
)

func TestScannerPreservesUTF16DiagnosticJSON(t *testing.T) {
	for _, tc := range []struct{ input, found string }{
		{"🎲", `"\ud83c"`}, {"𝔽", `"\ud835"`}, {"é", `"é"`}, {"?", `"?"`},
	} {
		_, err := TokenizeDiceNotation(tc.input)
		diceErr, ok := err.(*DiceRollError)
		if !ok || diceErr.Span.Start != 0 || diceErr.Span.End != 1 {
			t.Fatalf("%q: expected first UTF-16 unit diagnostic, got %v", tc.input, err)
		}
		wire, err := json.Marshal(diceErr)
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			Details map[string]json.RawMessage `json:"details"`
		}
		if err := json.Unmarshal(wire, &result); err != nil {
			t.Fatal(err)
		}
		// Decode only the envelope: decoding found into a Go string would hide
		// a regression from an isolated surrogate to the replacement character.
		if got := string(result.Details["found"]); got != tc.found {
			t.Fatalf("%q: found JSON = %s, want %s", tc.input, got, tc.found)
		}
	}
}
