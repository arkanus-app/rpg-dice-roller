package dicecore

import (
	"encoding/json"
	"errors"
	"math"
)

// SourceSpan uses UTF-16 code-unit offsets, like the reference implementation.
type SourceSpan struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// DiceRollError preserves the stable error codes used by the TypeScript engine.
type DiceRollError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Input   string         `json:"input"`
	Span    *SourceSpan    `json:"span"`
	Details map[string]any `json:"details"`
}

func (e *DiceRollError) Error() string { return e.Message }

func newDiceError(code, message, input string, details map[string]any) *DiceRollError {
	if details == nil {
		details = map[string]any{}
	}
	return &DiceRollError{Code: code, Message: message, Input: input, Details: details}
}

func (e *DiceRollError) MarshalJSON() ([]byte, error) {
	type errorFields DiceRollError
	copy := errorFields(*e)
	if copy.Details == nil {
		copy.Details = map[string]any{}
	}
	return json.Marshal(struct {
		Name string `json:"name"`
		errorFields
	}{Name: "DiceRollError", errorFields: copy})
}

var diceErrorCodes = map[string]bool{
	"DICE_NOTATION_REQUIRED": true, "INPUT_TOO_LONG": true,
	"AST_TOO_DEEP": true, "TOO_MANY_NODES": true, "TOO_MANY_ROLLS": true,
	"TOO_MANY_INITIAL_DICE": true, "GENERATED_DICE_LIMIT_EXCEEDED": true,
	"RANDOM_BUDGET_EXCEEDED": true, "EVENT_LIMIT_EXCEEDED": true,
	"MODIFIER_STEP_LIMIT_EXCEEDED": true, "RESOLVED_GROUP_LIMIT_EXCEEDED": true,
	"RESULT_LIMIT_EXCEEDED": true, "OUTPUT_LIMIT_EXCEEDED": true,
	"DICE_SIDES_LIMIT_EXCEEDED": true, "INVALID_NOTATION": true,
	"UNSUPPORTED_NOTATION": true, "UNSUPPORTED_GROUP_MODIFIER": true,
	"NON_TERMINATING_MODIFIER": true, "IMPOSSIBLE_UNIQUE": true,
	"ROLL_EXECUTION_LIMIT": true, "RNG_UNAVAILABLE": true, "INVALID_SEED": true,
	"INVALID_REPLAY": true, "INVALID_SYSTEM_INPUT": true,
	"REPLAY_PLAN_MISMATCH": true, "INVALID_LIMIT": true,
	"UNSUPPORTED_REPLAY_VERSION": true, "NON_FINITE_RESULT": true,
	"INVALID_ERROR_DATA": true,
}

// IsDiceRollError also recognizes an error wrapped with fmt.Errorf("...: %w").
func IsDiceRollError(err error) bool {
	var diceErr *DiceRollError
	return errors.As(err, &diceErr) && diceErr != nil
}

// DiceRollErrorFromJSON validates an error crossing a process boundary.
func DiceRollErrorFromJSON(data []byte) (*DiceRollError, error) {
	invalid := func() (*DiceRollError, error) {
		return nil, newDiceError("INVALID_ERROR_DATA", "Value is not valid serialized dice error data", "", nil)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil || raw == nil {
		return invalid()
	}
	code, codeOK := raw["code"].(string)
	message, messageOK := raw["message"].(string)
	input, inputOK := raw["input"].(string)
	details, detailsOK := raw["details"].(map[string]any)
	span, spanPresent := raw["span"]
	if raw["name"] != "DiceRollError" || !codeOK || !diceErrorCodes[code] ||
		!messageOK || !inputOK || !detailsOK || !spanPresent {
		return invalid()
	}
	result := newDiceError(code, message, input, details)
	if span != nil {
		object, ok := span.(map[string]any)
		if !ok {
			return invalid()
		}
		start, startOK := object["start"].(float64)
		end, endOK := object["end"].(float64)
		if !startOK || !endOK || start < 0 || end < start || end > float64(maxSafeInteger) ||
			end > float64(int(^uint(0)>>1)) || math.Trunc(start) != start || math.Trunc(end) != end {
			return invalid()
		}
		result.Span = &SourceSpan{Start: int(start), End: int(end)}
	}
	return result, nil
}
