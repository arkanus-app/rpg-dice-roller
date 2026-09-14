package dicecore

import (
	"encoding/json"
	"fmt"
	"math"
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

func TestIsDiceRollErrorData(t *testing.T) {
	valid := func() map[string]any {
		return map[string]any{"name": "DiceRollError", "code": "INVALID_NOTATION", "message": "bad expression",
			"span": nil, "input": "2d", "details": map[string]any{}}
	}
	cycle := map[string]any{}
	cycle["self"] = cycle
	shared := map[string]any{"value": 1}
	for _, test := range []struct {
		name  string
		field string
		value any
		want  bool
	}{
		{"name", "name", "Error", false},
		{"code-type", "code", 1, false},
		{"unknown-code", "code", "UNKNOWN", false},
		{"message", "message", nil, false},
		{"input", "input", []string{}, false},
		{"details-null", "details", nil, false},
		{"details-typed-nil", "details", map[string]any(nil), false},
		{"details-array", "details", []any{}, false},
		{"details-nan", "details", map[string]any{"bad": math.NaN()}, false},
		{"details-infinity", "details", map[string]any{"bad": math.Inf(1)}, false},
		{"details-function", "details", map[string]any{"bad": func() {}}, false},
		{"details-cycle", "details", cycle, false},
		{"details-nested", "details", map[string]any{"values": []any{nil, false, "text", 1.5, map[string]any{"a": 2}}}, true},
		{"details-shared-reference", "details", map[string]any{"first": shared, "second": shared}, true},
		{"span-null", "span", nil, true},
		{"span-typed-null", "span", (*SourceSpan)(nil), true},
		{"span-value", "span", SourceSpan{Start: 1, End: 2}, true},
		{"span-pointer", "span", &SourceSpan{Start: 1, End: 2}, true},
		{"span-record", "span", map[string]any{"start": 0.0, "end": 5.0}, true},
		{"span-integer-record", "span", map[string]any{"start": int64(1), "end": uint64(2)}, true},
		{"span-safe-boundary", "span", map[string]any{"start": float64(maxSafeInteger), "end": float64(maxSafeInteger)}, true},
		{"span-ignore-extras", "span", map[string]any{"start": 0.0, "end": 0.0, "extra": cycle}, true},
		{"span-missing-start", "span", map[string]any{"end": 2.0}, false},
		{"span-missing-end", "span", map[string]any{"start": 1.0}, false},
		{"span-negative", "span", SourceSpan{Start: -1, End: 0}, false},
		{"span-reversed", "span", SourceSpan{Start: 2, End: 1}, false},
		{"span-fraction-start", "span", map[string]any{"start": 0.1, "end": 2.0}, false},
		{"span-fraction-end", "span", map[string]any{"start": 0.0, "end": 2.1}, false},
		{"span-nan", "span", map[string]any{"start": math.NaN(), "end": 2.0}, false},
		{"span-infinite", "span", map[string]any{"start": 0.0, "end": math.Inf(1)}, false},
		{"span-unsafe", "span", map[string]any{"start": 0.0, "end": float64(maxSafeInteger) + 1}, false},
		{"span-string-number", "span", map[string]any{"start": "0", "end": 1.0}, false},
		{"span-array", "span", []any{0, 1}, false},
		{"span-number", "span", 0, false},
		{"ignore-extra", "extra", cycle, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			value := valid()
			value[test.field] = test.value
			if got := IsDiceRollErrorData(value); got != test.want {
				t.Errorf("IsDiceRollErrorData = %v, want %v", got, test.want)
			}
		})
	}
	for _, field := range []string{"name", "code", "message", "span", "input", "details"} {
		t.Run("missing-"+field, func(t *testing.T) {
			value := valid()
			delete(value, field)
			if IsDiceRollErrorData(value) {
				t.Error("missing required field accepted")
			}
		})
	}
	native := newDiceError("INVALID_NOTATION", "bad expression", "2d", nil)
	if !IsDiceRollErrorData(native) || !IsDiceRollErrorData(*native) || !IsDiceRollErrorData(valid()) {
		t.Error("valid native or decoded error rejected")
	}
	for _, value := range []any{nil, (*DiceRollError)(nil), map[string]any(nil), []any{}, "DiceRollError", 1} {
		if IsDiceRollErrorData(value) {
			t.Errorf("invalid object accepted: %#v", value)
		}
	}
}
