package dicecore

import (
	"encoding/json"
	"strconv"
)

// encoding/json replaces an isolated UTF-16 surrogate with U+FFFD when decoding
// into a string. Retain its wire representation while exposing a normal Go string;
// assignment to the public field takes precedence over the retained value.
type errorJSONString struct {
	decoded string
	wire    json.RawMessage
}

func preserveErrorString(raw json.RawMessage, decoded string) *errorJSONString {
	if !errorJSONHasUnpairedSurrogate(raw) {
		return nil
	}
	return &errorJSONString{decoded: decoded, wire: append(json.RawMessage(nil), raw...)}
}

func errorStringJSON(value string, preserved *errorJSONString) any {
	if preserved != nil && value == preserved.decoded {
		return preserved.wire
	}
	return value
}

// raw is a valid JSON string, checked by the enclosing error decoder. Escaped
// backslashes are skipped, and adjacent high/low surrogate pairs remain normal
// Unicode strings. Only isolated surrogate escapes need special handling.
func errorJSONHasUnpairedSurrogate(raw json.RawMessage) bool {
	for index := 1; index+1 < len(raw); index++ {
		if raw[index] != '\\' {
			continue
		}
		index++
		if raw[index] != 'u' {
			continue
		}
		unit, _ := strconv.ParseUint(string(raw[index+1:index+5]), 16, 16)
		index += 4
		if unit >= 0xdc00 && unit <= 0xdfff {
			return true
		}
		if unit >= 0xd800 && unit <= 0xdbff {
			if index+7 >= len(raw) || raw[index+1] != '\\' || raw[index+2] != 'u' {
				return true
			}
			next, _ := strconv.ParseUint(string(raw[index+3:index+7]), 16, 16)
			if next < 0xdc00 || next > 0xdfff {
				return true
			}
			index += 6
		}
	}
	return false
}

// The decoded value and raw message describe the same previously validated JSON
// subtree. Normal values keep their encoding/json types; only affected strings
// become RawMessage so nested surrogate diagnostics survive reserialization.
func restoreErrorJSONStrings(raw json.RawMessage, decoded any) any {
	switch value := decoded.(type) {
	case string:
		if preserved := preserveErrorString(raw, value); preserved != nil {
			return preserved.wire
		}
	case []any:
		var items []json.RawMessage
		_ = json.Unmarshal(raw, &items)
		for index, item := range value {
			value[index] = restoreErrorJSONStrings(items[index], item)
		}
	case map[string]any:
		var properties map[string]json.RawMessage
		_ = json.Unmarshal(raw, &properties)
		for key, item := range value {
			value[key] = restoreErrorJSONStrings(properties[key], item)
		}
	}
	return decoded
}
