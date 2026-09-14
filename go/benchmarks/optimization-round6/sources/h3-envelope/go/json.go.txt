package dicecore

import (
	"encoding/json"
	"slices"
	"strconv"
)

// MarshalJSON encodes a value with the same bytes and errors as encoding/json.Marshal.
// Full, detailed and summary roll results use a typed encoder; other values and
// results containing custom Sides or legacy events use encoding/json unchanged.
// The returned bytes belong to the caller. The encoder reads results at call
// time without caching or mutating them; custom marshalers retain their standard
// behavior. As with encoding/json, do not mutate a result concurrently with
// encoding it.
func MarshalJSON(value any) ([]byte, error) {
	return AppendJSON(nil, value)
}

// AppendJSON appends the JSON representation of value to dst, reusing its
// capacity when possible. The original prefix is preserved. On error it returns
// the original dst and the encoding/json error; bytes beyond len(dst) may have
// been used as scratch. Callers own the destination and its synchronization.
// This function does not replace encoding/json.Marshal or add marshal methods
// to result types: use it explicitly when serializing a roll for the backend.
func AppendJSON(dst []byte, value any) ([]byte, error) {
	output := eventJSON{data: dst}
	switch result := value.(type) {
	case *DiceRollResult:
		if result == nil {
			return append(dst, "null"...), nil
		}
		if !nativeJSONDice(result.Dice) || !nativeJSONEvents(result.Events) {
			return appendStandardJSON(dst, value)
		}
		output.data = reserveRollJSON(dst, len(result.Dice), len(result.Groups), len(result.Events), len(result.Rolls))
		output.fullRoll(result)
	case DiceRollResult:
		return AppendJSON(dst, &result)
	case *DiceRollDetails:
		if result == nil {
			return append(dst, "null"...), nil
		}
		if !nativeJSONDice(result.Dice) {
			return appendStandardJSON(dst, value)
		}
		output.data = reserveRollJSON(dst, len(result.Dice), 0, 0, len(result.Rolls))
		output.detailedRoll(result)
	case DiceRollDetails:
		return AppendJSON(dst, &result)
	case *DiceRollSummary:
		if result == nil {
			return append(dst, "null"...), nil
		}
		output.data = reserveRollJSON(dst, 0, 0, 0, len(result.Rolls))
		output.summaryRoll(result)
	case DiceRollSummary:
		return AppendJSON(dst, &result)
	default:
		return appendStandardJSON(dst, value)
	}
	if output.err != nil {
		// Eligibility excludes user callbacks. Delegating numeric failures here
		// preserves stdlib error types, wrappers and precedence without invoking
		// a custom marshaler twice or reentering its cycle detection.
		return appendStandardJSON(dst, value)
	}
	return output.data, nil
}

func appendStandardJSON(dst []byte, value any) ([]byte, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return dst, err
	}
	if dst == nil {
		return encoded, nil
	}
	return append(dst, encoded...), nil
}

func nativeJSONDice(dice []ResolvedDie) bool {
	for index := range dice {
		switch dice[index].Sides.(type) {
		case nil, int64, string:
		default:
			return false
		}
	}
	return true
}

func nativeJSONEvents(events ResolvedEvents) bool {
	for index := range events {
		if events[index].legacy != nil {
			return false
		}
	}
	return true
}

func reserveRollJSON(dst []byte, dice, groups, events, rolls int) []byte {
	// Only reserve a bounded initial estimate, independent of caller-controlled
	// string lengths or huge slice sizes. Longer outputs grow normally. No pool
	// retains these bytes after returning ownership to the caller.
	base := 512
	if groups > 0 || events > 0 {
		base = 1024
	}
	capacity := min(1024*1024, base+min(dice, 4096)*236+min(groups, 4096)*224+min(events, 8192)*144+min(rolls, 4096)*128)
	return slices.Grow(dst, capacity)
}

func (output *eventJSON) beginObject() int {
	previous := output.start
	output.start = len(output.data)
	output.data = append(output.data, '{')
	return previous
}

func (output *eventJSON) endObject(previous int) {
	output.data = append(output.data, '}')
	output.start = previous
}

func (output *eventJSON) rollHeader(kind string, version int64, input, notation, normalized, comment string, total float64, replay ReplayDescriptor, stats ExecutionStats, pool *PoolSummary) {
	output.text("type", kind)
	output.integer("schemaVersion", version)
	output.text("input", input)
	output.text("notation", notation)
	output.text("normalizedNotation", normalized)
	output.text("comment", comment)
	output.number("total", total)
	output.key("replay")
	previous := output.beginObject()
	output.integer("schemaVersion", int64(replay.SchemaVersion))
	output.text("algorithm", string(replay.Algorithm))
	output.integer("algorithmVersion", int64(replay.AlgorithmVersion))
	output.integer("executionVersion", int64(replay.ExecutionVersion))
	output.text("mathProfile", replay.MathProfile)
	output.text("origin", string(replay.Origin))
	output.text("seedMaterial", replay.SeedMaterial)
	output.text("planFingerprint", replay.PlanFingerprint)
	output.endObject(previous)
	output.key("stats")
	previous = output.beginObject()
	output.integer("rolls", stats.Rolls)
	output.integer("initialDice", stats.InitialDice)
	output.integer("generatedDice", stats.GeneratedDice)
	output.integer("randomCalls", stats.RandomCalls)
	output.integer("modifierSteps", stats.ModifierSteps)
	output.integer("events", stats.Events)
	output.integer("resolvedGroups", stats.ResolvedGroups)
	output.integer("resultItems", stats.ResultItems)
	output.endObject(previous)
	output.pool(pool)
}

func (output *eventJSON) pool(pool *PoolSummary) {
	output.key("pool")
	if pool == nil {
		output.data = append(output.data, "null"...)
		return
	}
	previous := output.beginObject()
	output.integer("successes", pool.Successes)
	output.integer("failures", pool.Failures)
	output.integer("netSuccesses", pool.NetSuccesses)
	output.endObject(previous)
}

func (output *eventJSON) fullRoll(result *DiceRollResult) {
	previous := output.beginObject()
	output.rollHeader(result.Type, result.SchemaVersion, result.Input, result.Notation, result.NormalizedNotation, result.Comment, result.Total, result.Replay, result.Stats, result.Pool)
	output.text("output", result.Output)
	output.key("rolls")
	if result.Rolls == nil {
		output.data = append(output.data, "null"...)
	} else {
		output.data = append(output.data, '[')
		for index := range result.Rolls {
			if index > 0 {
				output.data = append(output.data, ',')
			}
			roll := &result.Rolls[index]
			parent := output.beginObject()
			output.integer("index", roll.Index)
			output.number("total", roll.Total)
			output.pool(roll.Pool)
			output.entityRange("diceRange", roll.DiceRange)
			output.entityRange("groupRange", roll.GroupRange)
			output.entityRange("eventRange", roll.EventRange)
			output.endObject(parent)
		}
		output.data = append(output.data, ']')
	}
	output.groups(result.Groups)
	output.dice(result.Dice)
	output.events(result.Events)
	output.endObject(previous)
}

func (output *eventJSON) detailedRoll(result *DiceRollDetails) {
	previous := output.beginObject()
	output.rollHeader(result.Type, result.SchemaVersion, result.Input, result.Notation, result.NormalizedNotation, result.Comment, result.Total, result.Replay, result.Stats, result.Pool)
	output.rollSummaries(result.Rolls)
	output.dice(result.Dice)
	output.endObject(previous)
}

func (output *eventJSON) summaryRoll(result *DiceRollSummary) {
	previous := output.beginObject()
	output.rollHeader(result.Type, result.SchemaVersion, result.Input, result.Notation, result.NormalizedNotation, result.Comment, result.Total, result.Replay, result.Stats, result.Pool)
	output.rollSummaries(result.Rolls)
	output.endObject(previous)
}

func (output *eventJSON) rollSummaries(rolls []ResolvedRollSummary) {
	output.key("rolls")
	if rolls == nil {
		output.data = append(output.data, "null"...)
		return
	}
	output.data = append(output.data, '[')
	for index := range rolls {
		if index > 0 {
			output.data = append(output.data, ',')
		}
		roll := &rolls[index]
		previous := output.beginObject()
		output.integer("index", roll.Index)
		output.number("total", roll.Total)
		output.pool(roll.Pool)
		output.endObject(previous)
	}
	output.data = append(output.data, ']')
}

func (output *eventJSON) entityRange(key string, value EntityRange) {
	output.key(key)
	previous := output.beginObject()
	output.integer("start", value.Start)
	output.integer("count", value.Count)
	output.endObject(previous)
}

func (output *eventJSON) groups(groups []ResolvedGroup) {
	output.key("groups")
	if groups == nil {
		output.data = append(output.data, "null"...)
		return
	}
	output.data = append(output.data, '[')
	for index := range groups {
		if index > 0 {
			output.data = append(output.data, ',')
		}
		group := &groups[index]
		previous := output.beginObject()
		output.text("id", group.ID)
		output.text("sourceNodeId", group.SourceNodeID)
		output.integer("rollIndex", group.RollIndex)
		output.text("kind", group.Kind)
		output.text("notation", group.Notation)
		output.key("span")
		parent := output.beginObject()
		output.integer("start", int64(group.Span.Start))
		output.integer("end", int64(group.Span.End))
		output.endObject(parent)
		output.number("value", group.Value)
		output.number("contribution", group.Contribution)
		output.key("included")
		output.data = strconv.AppendBool(output.data, group.Included)
		output.strings("states", group.States)
		output.strings("childIds", group.ChildIDs)
		output.endObject(previous)
	}
	output.data = append(output.data, ']')
}

func (output *eventJSON) dice(dice []ResolvedDie) {
	output.key("dice")
	if dice == nil {
		output.data = append(output.data, "null"...)
		return
	}
	data := append(output.data, '[')
	for index := range dice {
		if index > 0 {
			data = append(data, ',')
		}
		die := &dice[index]
		// The schema keys are constant, while every value is read from the
		// current result. Keep the slice local while writing this envelope to
		// avoid repeatedly updating a pointer-bearing writer for each key.
		data = append(data, `{"id":`...)
		data = appendEventString(data, die.ID)
		data = append(data, `,"sourceNodeId":`...)
		data = appendEventString(data, die.SourceNodeID)
		data = append(data, `,"parentDieId":`...)
		if die.ParentDieID == nil {
			data = append(data, "null"...)
		} else {
			data = appendEventString(data, *die.ParentDieID)
		}
		data = append(data, `,"rollIndex":`...)
		data = strconv.AppendInt(data, die.RollIndex, 10)
		data = append(data, `,"rollDieIndex":`...)
		data = strconv.AppendInt(data, die.RollDieIndex, 10)
		data = append(data, `,"groupId":`...)
		data = appendEventString(data, die.GroupID)
		data = append(data, `,"sides":`...)
		switch sides := die.Sides.(type) {
		case int64:
			data = strconv.AppendInt(data, sides, 10)
		case string:
			data = appendEventString(data, sides)
		default:
			// Eligibility permits only nil in addition to int64 and string.
			data = append(data, "null"...)
		}
		output.data = data
		output.number("rawValue", die.RawValue)
		output.number("value", die.Value)
		output.number("contribution", die.Contribution)
		data = append(output.data, `,"included":`...)
		data = strconv.AppendBool(data, die.Included)
		data = append(data, `,"states":`...)
		if die.States == nil {
			data = append(data, "null"...)
		} else {
			data = append(data, '[')
			for stateIndex, state := range die.States {
				if stateIndex > 0 {
					data = append(data, ',')
				}
				data = appendEventString(data, state)
			}
			data = append(data, ']')
		}
		data = append(data, '}')
	}
	output.data = append(data, ']')
}

func (output *eventJSON) events(events ResolvedEvents) {
	output.key("events")
	if events == nil {
		output.data = append(output.data, "null"...)
		return
	}
	output.data = append(output.data, '[')
	for index := range events {
		if index > 0 {
			output.data = append(output.data, ',')
		}
		encoded, err := events[index].appendJSON(output.data)
		if err != nil {
			output.err = err
			return
		}
		output.data = encoded
	}
	output.data = append(output.data, ']')
}
