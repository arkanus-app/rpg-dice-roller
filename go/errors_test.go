package dicecore

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestErrorJSON(t *testing.T) {
	original := newDiceError("INVALID_NOTATION", "bad expression", "2d", map[string]any{"example": []any{nil, 1.0, "test", true}})
	original.Span = &SourceSpan{Start: 1, End: 2}
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DiceRollErrorFromJSON(data)
	if err != nil || decoded.Code != original.Code || *decoded.Span != *original.Span {
		t.Fatalf("%s: %v", data, err)
	}
	if !IsDiceRollError(fmt.Errorf("wrapped: %w", decoded)) || IsDiceRollError(nil) || IsDiceRollError(fmt.Errorf("plain")) {
		t.Fatal("error recognition")
	}
	plain := newDiceError("INVALID_LIMIT", "bad limit", "", nil)
	plain.Details = nil
	data, err = json.Marshal(plain)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DiceRollErrorFromJSON(data); err != nil {
		t.Fatal(err)
	}
	valid := string(data)
	for _, input := range []string{
		"{", "null", "[]", "{}", strings.Replace(valid, `"name":"DiceRollError"`, `"name":"Error"`, 1),
		strings.Replace(valid, `"code":"INVALID_LIMIT"`, `"code":"UNKNOWN"`, 1),
		strings.Replace(valid, `"message":"bad limit"`, `"message":null`, 1),
		strings.Replace(valid, `"span":null`, `"span":0`, 1),
		strings.Replace(valid, `"span":null`, `"span":{"start":-1,"end":2}`, 1),
		strings.Replace(valid, `"span":null`, `"span":{"start":1,"end":0}`, 1),
		strings.Replace(valid, `"span":null`, `"span":{"start":0.5,"end":2}`, 1),
		strings.Replace(valid, `"details":{}`, `"details":null`, 1),
		strings.Replace(valid, `"input":""`, `"input":3`, 1),
	} {
		_, err := DiceRollErrorFromJSON([]byte(input))
		requireErrorCode(t, err, "INVALID_ERROR_DATA")
	}
}
