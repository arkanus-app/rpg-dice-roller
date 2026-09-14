package dicecore

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"sync"
	"testing"
)

func assertNativeJSONError(t *testing.T, got, want error) {
	t.Helper()
	for depth := 0; got != nil || want != nil; depth++ {
		if got == nil || want == nil || reflect.TypeOf(got) != reflect.TypeOf(want) || got.Error() != want.Error() {
			t.Fatalf("error chain depth %d: got %T: %v, want %T: %v", depth, got, got, want, want)
		}
		switch expected := want.(type) {
		case *json.MarshalerError:
			if got.(*json.MarshalerError).Type != expected.Type {
				t.Fatal("marshaler error lost its originating type")
			}
		case *json.UnsupportedTypeError:
			if got.(*json.UnsupportedTypeError).Type != expected.Type {
				t.Fatal("unsupported type changed")
			}
		case *json.UnsupportedValueError:
			actual := got.(*json.UnsupportedValueError)
			if actual.Str != expected.Str || actual.Value.Type() != expected.Value.Type() {
				t.Fatal("unsupported value changed")
			}
		}
		got, want = errors.Unwrap(got), errors.Unwrap(want)
	}
}

// Use only with values whose custom marshalers have no side effects. Stateful
// callback cases below construct a fresh value for each implementation.
func assertNativeJSONParity(t *testing.T, value any) {
	t.Helper()
	want, wantErr := json.Marshal(value)
	got, gotErr := MarshalJSON(value)
	assertNativeJSONError(t, gotErr, wantErr)
	if !bytes.Equal(got, want) || (gotErr != nil && got != nil) {
		t.Fatalf("native JSON differs for %T: %s, want %s", value, got, want)
	}
	for _, spare := range []int{0, len(want) + 128} {
		prefix := []byte("existing prefix\x00\xff\n")
		destination := make([]byte, len(prefix), len(prefix)+spare)
		copy(destination, prefix)
		result, err := AppendJSON(destination, value)
		assertNativeJSONError(t, err, wantErr)
		expected := append(append([]byte{}, prefix...), want...)
		if err != nil {
			expected = prefix
			if len(result) != len(destination) || cap(result) != cap(destination) || &result[0] != &destination[0] {
				t.Fatal("append error did not return the original destination")
			}
		}
		if !bytes.Equal(result, expected) || !bytes.Equal(destination, prefix) {
			t.Fatalf("append changed its prefix or payload for %T: %q, want %q", value, result, expected)
		}
	}
	appended, err := AppendJSON(nil, value)
	assertNativeJSONError(t, err, wantErr)
	if !bytes.Equal(appended, want) || (err != nil && appended != nil) {
		t.Fatal("nil destination changed JSON or error output")
	}
}

func TestNativeJSONExecutorCorpus(t *testing.T) {
	encoded := 0
	for _, raw := range loadFixtureCases(t, "executor.json") {
		var fixture struct {
			Name            string
			Input           string
			Seed            any
			Algorithm       RandomAlgorithm
			ExecutionLimits DiceLimitOverrides
		}
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
		plan, err := CompileDicePlan(fixture.Input, DefaultDiceLimits())
		if err != nil {
			continue // Execution/compile failures have no result to serialize.
		}
		limits, err := CreateDiceLimits(fixture.ExecutionLimits)
		if err != nil {
			t.Fatal(err)
		}
		options := ExecuteRollPlanOptions{Limits: limits, Seed: fixture.Seed, RandomAlgorithm: fixture.Algorithm}
		t.Run(fixture.Name, func(t *testing.T) {
			if full, err := ExecuteRollPlan(plan, options); err == nil {
				assertNativeJSONParity(t, full)
				assertNativeJSONParity(t, *full)
				encoded++
			}
			if details, err := ExecuteRollPlanDetails(plan, options); err == nil {
				assertNativeJSONParity(t, details)
				assertNativeJSONParity(t, *details)
				encoded++
			}
			if summary, err := ExecuteRollPlanSummary(plan, options); err == nil {
				assertNativeJSONParity(t, summary)
				assertNativeJSONParity(t, *summary)
				encoded++
			}
		})
	}
	if encoded < 300 {
		t.Fatalf("insufficient successful executor projections: %d", encoded)
	}
}

func TestNativeJSONNilEmptyAndFallbackValues(t *testing.T) {
	type definedResult DiceRollResult
	for _, value := range []any{
		nil, (*DiceRollResult)(nil), (*DiceRollDetails)(nil), (*DiceRollSummary)(nil),
		DiceRollResult{}, &DiceRollResult{}, DiceRollDetails{}, &DiceRollDetails{}, DiceRollSummary{}, &DiceRollSummary{},
		DiceRollResult{Rolls: []ResolvedRoll{}, Groups: []ResolvedGroup{}, Dice: []ResolvedDie{}, Events: ResolvedEvents{}},
		DiceRollDetails{Rolls: []ResolvedRollSummary{}, Dice: []ResolvedDie{}}, DiceRollSummary{Rolls: []ResolvedRollSummary{}},
		definedResult{Comment: "defined type"}, (*definedResult)(nil), []byte{0, 127, 255}, json.Number("1.25"),
		map[string]any{"z": nil, "a": []any{true, 3, "<>&"}}, []any{DiceRollResult{}, (*DiceRollSummary)(nil)},
		json.RawMessage(` { "html": "<>&" } `), json.RawMessage(`{broken`), json.Number("invalid"),
		func() {}, make(chan int), complex(1, 2),
	} {
		assertNativeJSONParity(t, value)
	}
}

func nativeJSONPopulatedResult(text string, number float64, flags uint8) *DiceRollResult {
	parent := text
	pool := &PoolSummary{Successes: math.MaxInt64, Failures: math.MinInt64, NetSuccesses: -2}
	result := &DiceRollResult{Type: text, SchemaVersion: math.MinInt64, Input: text, Notation: text, NormalizedNotation: text,
		Comment: text, Total: number, Output: text, Pool: pool,
		Replay: ReplayDescriptor{SchemaVersion: -7, Algorithm: RandomAlgorithm(text), AlgorithmVersion: -9, ExecutionVersion: 17,
			MathProfile: text, Origin: SeedOrigin(text), SeedMaterial: text, PlanFingerprint: text},
		Stats: ExecutionStats{Rolls: 1, InitialDice: -2, GeneratedDice: 3, RandomCalls: -4, ModifierSteps: 5, Events: -6, ResolvedGroups: 7, ResultItems: math.MaxInt64},
		Rolls: []ResolvedRoll{{Index: -4, Total: number, Pool: pool, DiceRange: EntityRange{Start: -1, Count: 2}, GroupRange: EntityRange{Start: 3, Count: -4}, EventRange: EntityRange{Start: 5, Count: 6}}},
		Groups: []ResolvedGroup{{ID: text, SourceNodeID: text, RollIndex: -2, Kind: text, Notation: text, Span: SourceSpan{Start: -3, End: 4},
			Value: number, Contribution: number, Included: flags&1 != 0, States: []string{text, ""}, ChildIDs: []string{"", text}}},
		Dice: []ResolvedDie{{ID: text, SourceNodeID: text, ParentDieID: &parent, RollIndex: -2, RollDieIndex: 3, GroupID: text,
			Sides: int64(flags), RawValue: number, Value: number, Contribution: number, Included: flags&2 != 0, States: []string{"", text}}},
		Events: ResolvedEvents{{Sequence: math.MaxInt64, Type: "roll", Subject: "die", SourceNodeID: text, DieID: text, HasParent: true,
			ParentDieID: text, RollIndex: math.MinInt64, Value: number}, {Sequence: 2, Type: "include", Subject: "group", Value: number,
			Contribution: number, Details: &ResolvedEventDetails{GroupID: text}}}}
	if flags&4 != 0 {
		result.Pool, result.Rolls[0].Pool, result.Dice[0].ParentDieID = nil, nil, nil
		result.Groups[0].States, result.Groups[0].ChildIDs, result.Dice[0].States = nil, nil, nil
	}
	if flags&8 != 0 {
		result.Dice[0].Sides = text
	}
	if flags&16 != 0 {
		result.Dice[0].Sides = nil
	}
	if flags&32 != 0 {
		result.Groups[0].States, result.Groups[0].ChildIDs, result.Dice[0].States = []string{}, []string{}, []string{}
	}
	return result
}

func nativeJSONProjections(full *DiceRollResult) (*DiceRollDetails, *DiceRollSummary) {
	rolls := make([]ResolvedRollSummary, len(full.Rolls))
	for index, roll := range full.Rolls {
		rolls[index] = ResolvedRollSummary{Index: roll.Index, Total: roll.Total, Pool: roll.Pool}
	}
	details := &DiceRollDetails{Type: full.Type, SchemaVersion: full.SchemaVersion, Input: full.Input, Notation: full.Notation,
		NormalizedNotation: full.NormalizedNotation, Comment: full.Comment, Total: full.Total, Replay: full.Replay, Stats: full.Stats,
		Pool: full.Pool, Rolls: rolls, Dice: full.Dice}
	summary := &DiceRollSummary{Type: full.Type, SchemaVersion: full.SchemaVersion, Input: full.Input, Notation: full.Notation,
		NormalizedNotation: full.NormalizedNotation, Comment: full.Comment, Total: full.Total, Replay: full.Replay, Stats: full.Stats,
		Pool: full.Pool, Rolls: rolls}
	return details, summary
}

func TestNativeJSONMutationsAndBoundaries(t *testing.T) {
	full := nativeJSONPopulatedResult("initial", 6, 0)
	retained, err := MarshalJSON(full)
	if err != nil {
		t.Fatal(err)
	}
	retainedCopy := append([]byte{}, retained...)
	texts := []string{"", "plain", "quote\"slash\\", "<>&", "\x00\n\t\r\b\f", "🎲ação", "\u2028\u2029", "invalid\xffutf8"}
	values := []float64{0, math.Copysign(0, -1), -1.25, 1e-6, 1e-7, 1e20, 1e21, 9007199254740991,
		-9007199254740991, 9007199254740992, math.Nextafter(6, 7), math.SmallestNonzeroFloat64, math.MaxFloat64}
	for index, value := range values {
		*full = *nativeJSONPopulatedResult(texts[index%len(texts)], value, uint8(index*7))
		details, summary := nativeJSONProjections(full)
		for _, result := range []any{full, *full, details, *details, summary, *summary} {
			assertNativeJSONParity(t, result)
		}
	}
	if !bytes.Equal(retained, retainedCopy) {
		t.Fatal("later serialization or result mutation changed retained bytes")
	}
}

func TestNativeJSONNonFiniteFieldErrors(t *testing.T) {
	mutations := []struct {
		name  string
		apply func(*DiceRollResult, float64)
	}{
		{"total", func(r *DiceRollResult, n float64) { r.Total = n }},
		{"roll-total", func(r *DiceRollResult, n float64) { r.Rolls[0].Total = n }},
		{"group-value", func(r *DiceRollResult, n float64) { r.Groups[0].Value = n }},
		{"group-contribution", func(r *DiceRollResult, n float64) { r.Groups[0].Contribution = n }},
		{"die-raw", func(r *DiceRollResult, n float64) { r.Dice[0].RawValue = n }},
		{"die-value", func(r *DiceRollResult, n float64) { r.Dice[0].Value = n }},
		{"die-contribution", func(r *DiceRollResult, n float64) { r.Dice[0].Contribution = n }},
		{"event-value", func(r *DiceRollResult, n float64) { r.Events[0].Value = n }},
		{"event-contribution", func(r *DiceRollResult, n float64) { r.Events[1].Contribution = n }},
		{"event-from", func(r *DiceRollResult, n float64) {
			r.Events[0].Type = "transform"
			r.Events[0].Details = &ResolvedEventDetails{From: n}
		}},
		{"event-to", func(r *DiceRollResult, n float64) {
			r.Events[0].Type = "reroll"
			r.Events[0].Details = &ResolvedEventDetails{To: n}
		}},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			for _, number := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
				full := nativeJSONPopulatedResult("valid", 1, 0)
				mutation.apply(full, number)
				details, summary := nativeJSONProjections(full)
				for _, value := range []any{full, *full, details, summary} {
					assertNativeJSONParity(t, value)
				}
			}
		})
	}
}

type nativeJSONDefinedSide int64

func (nativeJSONDefinedSide) MarshalJSON() ([]byte, error) { return []byte(`"defined-side"`), nil }

type nativeJSONPointerSide struct{ Value string }

func (value *nativeJSONPointerSide) MarshalJSON() ([]byte, error) {
	return json.Marshal("pointer:" + value.Value)
}

type nativeJSONCallback struct {
	trace  *[]string
	name   string
	output string
	err    error
	mutate func()
}

func (value nativeJSONCallback) MarshalJSON() ([]byte, error) {
	*value.trace = append(*value.trace, value.name)
	if value.mutate != nil {
		value.mutate()
	}
	return []byte(value.output), value.err
}

type nativeJSONTextCallback struct{ nativeJSONCallback }

// Hide the embedded MarshalJSON by using a separate concrete TextMarshaler.
type nativeJSONTextOnly struct {
	trace  *[]string
	output string
	err    error
}

func (value nativeJSONTextOnly) MarshalText() ([]byte, error) {
	*value.trace = append(*value.trace, "text")
	return []byte(value.output), value.err
}

func (value nativeJSONTextCallback) MarshalText() ([]byte, error) {
	*value.trace = append(*value.trace, "text-must-not-run")
	return []byte("text"), nil
}

func TestNativeJSONArbitrarySidesAndCycles(t *testing.T) {
	for _, side := range []any{int64(6), "F", nil, 6, uint64(math.MaxUint64), float32(1e-7), json.Number("1e-9"),
		json.Number("bad"), nativeJSONDefinedSide(6), nativeJSONPointerSide{Value: "value"}, &nativeJSONPointerSide{Value: "value"},
		(*nativeJSONPointerSide)(nil), []byte("<>&"), []any{1, true, nil}, map[string]any{"z": "last", "a": "first"},
		make(chan int), func() {}, math.NaN(), json.RawMessage(` { "a": "<>&" } `)} {
		full := &DiceRollResult{Dice: []ResolvedDie{{Sides: side}}}
		details := &DiceRollDetails{Dice: full.Dice}
		assertNativeJSONParity(t, full)
		assertNativeJSONParity(t, details)
	}
	full := &DiceRollResult{Dice: []ResolvedDie{{}}}
	full.Dice[0].Sides = full
	assertNativeJSONParity(t, full)
	details := &DiceRollDetails{Dice: []ResolvedDie{{}}}
	details.Dice[0].Sides = details
	assertNativeJSONParity(t, details)
	cycleMap := map[string]any{}
	cycleMap["self"] = cycleMap
	full.Dice[0].Sides = cycleMap
	assertNativeJSONParity(t, full)
	cycleSlice := make([]any, 1)
	cycleSlice[0] = cycleSlice
	full.Dice[0].Sides = cycleSlice
	assertNativeJSONParity(t, full)
}

func TestNativeJSONCallbacksPreserveOrderAndSingleInvocation(t *testing.T) {
	sentinel := errors.New("native JSON callback sentinel")
	for _, scenario := range []string{"mutating", "early-total", "late-number", "late-event", "side-error", "invalid-json", "text", "text-error", "both", "legacy", "legacy-error"} {
		t.Run(scenario, func(t *testing.T) {
			makeValue := func() (*DiceRollResult, *[]string) {
				trace := []string{}
				result := &DiceRollResult{Total: 1, Dice: []ResolvedDie{{RawValue: 2, Value: 3}, {Value: 4}}}
				first := nativeJSONCallback{trace: &trace, name: "first", output: " 6 ", mutate: func() { result.Total = 99; result.Dice[0].RawValue = 7; result.Dice[1].Value = 8 }}
				second := nativeJSONCallback{trace: &trace, name: "second", output: ` { "html": "<>&" } `}
				result.Dice[0].Sides, result.Dice[1].Sides = first, second
				switch scenario {
				case "early-total":
					result.Total = math.NaN()
				case "late-number":
					first.mutate = func() { result.Dice[0].RawValue = math.NaN() }
					result.Dice[0].Sides = first
				case "late-event":
					result.Events = ResolvedEvents{{Type: "roll", Subject: "die", Value: math.NaN()}}
				case "side-error":
					first.err = sentinel
					result.Dice[0].Sides = first
				case "invalid-json":
					first.output = `{"broken"`
					result.Dice[0].Sides = first
				case "text", "text-error":
					text := nativeJSONTextOnly{trace: &trace, output: "<>&🎲\xff"}
					if scenario == "text-error" {
						text.err = sentinel
					}
					result.Dice[0].Sides = text
				case "both":
					result.Dice[0].Sides = nativeJSONTextCallback{first}
				case "legacy", "legacy-error":
					result.Dice[0].Sides, result.Dice[1].Sides = int64(6), int64(8)
					if scenario == "legacy-error" {
						first.err = sentinel
					}
					result.Events = ResolvedEvents{{legacy: DiceEvent{"a": first, "z": second}}}
				}
				return result, &trace
			}
			wantValue, wantTrace := makeValue()
			want, wantErr := json.Marshal(wantValue)
			for _, appendMode := range []bool{false, true} {
				value, trace := makeValue()
				var got []byte
				var err error
				if appendMode {
					destination := make([]byte, 6, 2048)
					copy(destination, "prefix")
					got, err = AppendJSON(destination, value)
					if len(got) < 6 || string(got[:6]) != "prefix" {
						t.Fatal("callback changed append prefix")
					}
					got = got[6:]
				} else {
					got, err = MarshalJSON(value)
				}
				assertNativeJSONError(t, err, wantErr)
				if !bytes.Equal(got, want) || !reflect.DeepEqual(*trace, *wantTrace) || errors.Is(err, sentinel) != errors.Is(wantErr, sentinel) {
					t.Fatalf("callback order/count/output changed: trace=%v, want=%v; got=%s, want=%s", *trace, *wantTrace, got, want)
				}
				if scenario == "early-total" && len(*trace) != 0 {
					t.Fatal("callback ran after earlier field error")
				}
			}
		})
	}
}

func TestNativeJSONAppendAliasedFallbackAndOwnership(t *testing.T) {
	backing := bytes.Repeat([]byte("x"), 2048)
	copy(backing, "prefix")
	copy(backing[100:], "original side bytes")
	value := &DiceRollResult{Dice: []ResolvedDie{{Sides: backing[100:119]}}}
	want, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	got, err := AppendJSON(backing[:6], value)
	if err != nil || !bytes.Equal(got, append([]byte("prefix"), want...)) {
		t.Fatalf("destination/source overlap changed fallback JSON: %s (%v)", got, err)
	}
	value = nativeJSONPopulatedResult("shared read-only result", 1.25, 0)
	want, err = json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var workers sync.WaitGroup
	errorsOut := make(chan error, 8)
	for range 8 {
		workers.Go(func() {
			for range 32 {
				encoded, err := MarshalJSON(value)
				if err != nil || !bytes.Equal(encoded, want) {
					errorsOut <- fmt.Errorf("concurrent JSON changed: %v", err)
					return
				}
				encoded[0] = '!'
			}
		})
	}
	workers.Wait()
	close(errorsOut)
	for err := range errorsOut {
		t.Error(err)
	}
	assertNativeJSONParity(t, value)
}

func FuzzNativeJSONParity(f *testing.F) {
	values := []float64{0, math.Copysign(0, -1), 1, -1, 1.25, -1.25, 1e-6, 1e-7, 1e20, 1e21,
		9007199254740991, -9007199254740991, 9007199254740992, math.Nextafter(6, 7), math.SmallestNonzeroFloat64,
		math.MaxFloat64, -math.MaxFloat64, math.NaN(), math.Inf(1), math.Inf(-1)}
	texts := []string{"", "ascii", "🎲ação", "<>&", "\u2028\u2029", "\x00\n\t", "\"\\", "invalid\xffutf8"}
	for index, value := range values {
		f.Add(texts[index%len(texts)], math.Float64bits(value), uint8(index*7))
	}
	f.Fuzz(func(t *testing.T, text string, bits uint64, flags uint8) {
		if len(text) > 2048 {
			t.Skip("bound encoded fuzz case size")
		}
		full := nativeJSONPopulatedResult(text, math.Float64frombits(bits), flags)
		details, summary := nativeJSONProjections(full)
		for _, value := range []any{full, *full, details, *details, summary, *summary} {
			assertNativeJSONParity(t, value)
		}
	})
}

func ExampleMarshalJSON() {
	result, err := RollRPGDice("2d1+3", RollOptions{Seed: "json-example"})
	if err != nil {
		panic(err)
	}
	payload, err := MarshalJSON(result)
	if err != nil {
		panic(err)
	}
	var decoded struct{ Total float64 }
	if err := json.Unmarshal(payload, &decoded); err != nil {
		panic(err)
	}
	fmt.Println(json.Valid(payload), decoded.Total)
	// Output: true 5
}

func ExampleAppendJSON() {
	result, err := RollRPGDiceSummary("1d1+4", RollOptions{Seed: "json-example"})
	if err != nil {
		panic(err)
	}
	buffer := []byte(`{"roll":`)
	buffer, err = AppendJSON(buffer, result)
	if err != nil {
		panic(err)
	}
	buffer = append(buffer, '}')
	var envelope struct{ Roll struct{ Total float64 } }
	if err := json.Unmarshal(buffer, &envelope); err != nil {
		panic(err)
	}
	fmt.Println(json.Valid(buffer), envelope.Roll.Total)
	// Output: true 5
}
