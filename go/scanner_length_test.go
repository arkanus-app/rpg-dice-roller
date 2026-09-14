package dicecore

import (
	"fmt"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestSyntaxLengthMatchesUTF16Conversion(t *testing.T) {
	for _, input := range []string{
		"", "1d20+5", "\x00\t\n\r\x1f\x7f", "ação", "🎲",
		"\u0080\u07ff\u0800\ud7ff\ue000\ufffd\uffff\U00010000\U0010ffff",
		"invalid\xffutf8", "\xc0\xaf", "\xed\xa0\x80", "\xed\xbf\xbf",
		"\xf0\x80\x80\x80", "\xf4\x90\x80\x80", "\xf5\x80\x80\x80",
		"\xc2", "\xe2\x82", "\xf0\x9f\x8e", "\x80\xbf\xff",
		string([]rune{0xd800, 0xdfff, 0x110000, -1}),
		strings.Repeat("1d6+", 1024), strings.Repeat("ação🎲\x00", 128),
	} {
		want := len(utf16.Encode([]rune(input)))
		if got := syntaxLength(input); got != want {
			t.Fatalf("UTF-16 length for %q: got %d, want %d", input, got, want)
		}
	}
	// Every byte is also checked around an astral rune and an ASCII control;
	// malformed lead/continuation bytes must each count as one replacement rune.
	for value := range 256 {
		input := string([]byte{byte(value)}) + "🎲\x00" + string([]byte{byte(value)})
		want := len(utf16.Encode([]rune(input)))
		if got := syntaxLength(input); got != want {
			t.Fatalf("byte %x: got %d UTF-16 units, want %d", value, got, want)
		}
	}
}

func TestSyntaxLengthInputLimitIncludesUnicodeComment(t *testing.T) {
	input := "1d1 [ação🎲]"
	length := int64(len(utf16.Encode([]rune(input))))
	engine, err := CreateDiceEngine(DiceEngineOptions{Limits: DiceLimitOverrides{"maxInputLength": length}})
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := engine.Roll(input, RollOptions{Seed: "utf16-limit"}); err != nil {
			t.Fatalf("exact input limit failed, including cache hit: %v", err)
		}
	}
	_, err = engine.Roll(input, RollOptions{Seed: "utf16-limit", Limits: DiceLimitOverrides{"maxInputLength": length - 1}})
	failure := executorAssertError(t, err, "INPUT_TOO_LONG")
	if failure.Input != input || failure.Details["actual"] != length || failure.Details["limit"] != length-1 {
		t.Fatalf("input length diagnostic changed: %+v", failure)
	}
	// This error is checked before parsing, so invalid Go UTF-8 must preserve
	// both its reference conversion length and the caller's original input.
	invalid := "1d1 [\xed\xa0\x80🎲]"
	invalidLength := int64(len(utf16.Encode([]rune(invalid))))
	_, err = engine.Roll(invalid, RollOptions{Seed: "utf16-limit", Limits: DiceLimitOverrides{"maxInputLength": 1}})
	failure = executorAssertError(t, err, "INPUT_TOO_LONG")
	if failure.Input != invalid || failure.Details["actual"] != invalidLength || failure.Details["limit"] != int64(1) {
		t.Fatalf("invalid UTF-8 input diagnostic changed: %+v", failure)
	}
}

func TestSyntaxLengthOutputBudgetMatchesRenderedUTF16(t *testing.T) {
	for _, outputs := range [][]string{
		{"ação🎲\x00\xff"}, {"🎲", "ação\n\xed\xa0\x80"},
		{"a", "b", "c", "d", "e", "f", "g", "h", "i", "🎲"},
	} {
		want := outputs[0]
		if len(outputs) > 1 {
			lines := make([]string, len(outputs)+1)
			for index, output := range outputs {
				lines[index] = fmt.Sprintf("%d. %s", index+1, output)
			}
			lines[len(outputs)] = "Total: 12.5"
			want = strings.Join(lines, "\n")
		}
		length := int64(len(utf16.Encode([]rune(want))))
		for _, limit := range []int64{length, length - 1} {
			limits := DefaultDiceLimits()
			limits.MaxOutputLength = limit
			context := &ExecutionContext{Budget: NewExecutionBudget(limits)}
			var output string
			var caught any
			func() {
				defer func() { caught = recover() }()
				output = formatExecutionOutput(outputs, 12.5, context)
			}()
			if limit == length {
				if caught != nil || output != want {
					t.Fatalf("exact output limit failed: got %q, panic %v; want %q", output, caught, want)
				}
				continue
			}
			err, ok := caught.(error)
			if !ok {
				t.Fatalf("output exceeding its limit did not fail with an error: %v", caught)
			}
			failure := executorAssertError(t, err, "OUTPUT_LIMIT_EXCEEDED")
			if failure.Details["actual"] != length || failure.Details["outputLength"] != length || failure.Details["limit"] != limit || failure.Details["limitName"] != "maxOutputLength" {
				t.Fatalf("output length diagnostic changed: %+v", failure)
			}
		}
	}
}

func TestSyntaxLengthOutputLimitsThroughRollAPI(t *testing.T) {
	engine, err := CreateDiceEngine()
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{"1d1", "3#1d1"} {
		full, err := engine.Roll(input, RollOptions{Seed: "utf16-output"})
		if err != nil {
			t.Fatal(err)
		}
		length := int64(len(utf16.Encode([]rune(full.Output))))
		exact, err := engine.Roll(input, RollOptions{Seed: "utf16-output", Limits: DiceLimitOverrides{"maxOutputLength": length}})
		if err != nil || exact.Output != full.Output {
			t.Fatalf("exact roll output limit changed result: %v", err)
		}
		_, err = engine.Roll(input, RollOptions{Seed: "utf16-output", Limits: DiceLimitOverrides{"maxOutputLength": length - 1}})
		failure := executorAssertError(t, err, "OUTPUT_LIMIT_EXCEEDED")
		if failure.Details["actual"] != length || failure.Details["limit"] != length-1 {
			t.Fatalf("roll output limit diagnostic changed: %+v", failure)
		}
	}
}

func FuzzSyntaxLengthMatchesUTF16Conversion(f *testing.F) {
	for _, input := range []string{"", "1d20+5", "ação🎲", "\xed\xa0\x80", "\xff\x00", "\U0010ffff"} {
		f.Add(input)
	}
	f.Fuzz(func(t *testing.T, input string) {
		want := len(utf16.Encode([]rune(input)))
		if got := syntaxLength(input); got != want {
			t.Fatalf("UTF-16 length for %q: got %d, want %d", input, got, want)
		}
	})
}
