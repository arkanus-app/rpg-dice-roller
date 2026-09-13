package dicecore

import (
	"encoding/json"
	"testing"
)

func TestNormalizationTypeScriptFixtures(t *testing.T) {
	for _, raw := range loadFixtureCases(t, "normalization.json") {
		var fixture struct {
			Name          string          `json:"name"`
			Input         string          `json:"input"`
			Outcome       json.RawMessage `json:"outcome"`
			ParsedOutcome json.RawMessage `json:"parsedOutcome"`
		}
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
		t.Run(fixture.Name, func(t *testing.T) {
			assertFixtureOutcome(t, fixture.Outcome, NormalizeRPGDiceNotation(fixture.Input), nil)
			assertFixtureOutcome(t, fixture.ParsedOutcome, ParseNormalizedDiceInput(fixture.Input), nil)
			if NormalizeNotation(fixture.Input) != NormalizeRPGDiceNotation(fixture.Input) {
				t.Fatal("normalization alias diverged")
			}
			if ParseNormalizedInput(fixture.Input) != ParseNormalizedDiceInput(fixture.Input) {
				t.Fatal("parsed normalization alias diverged")
			}
		})
	}
}

func TestNormalizationUnicodeCommentBoundaries(t *testing.T) {
	input := "\ufeff2 # 1d6 [ataque 🎲] // bônus\u2028+1 # fim"
	parsed := ParseNormalizedInput(input)
	if parsed.Notation != "1d6+1" || parsed.Comment != "ataque 🎲 bônus fim" || parsed.RollCount != 2 {
		t.Fatalf("incorrect Unicode normalization: %+v", parsed)
	}
	if got := NormalizeNotation("😀+d"); got != "😀+d20" {
		t.Fatalf("normalization damaged non-BMP character: %q", got)
	}
}

func TestNormalizationShorthandVariants(t *testing.T) {
	for _, tc := range []struct{ input, want string }{
		{"4d6km2", "4d6kl2"}, {"4d6kh", "4d6kh1"}, {"4d6kl", "4d6kl1"},
		{"4d6k", "4d6k1"}, {"4d6k2", "4d6k2"}, {"1d6ei", "1d6!"},
		{"1d6ei>=5", "1d6!>=5"}, {"-d", "d20"}, {"+d", "d20"},
		{"0d6", "0"}, {"00d6", "0"}, {"0f", "0dF"}, {"(2)d(6)", "(2)d(6)"},
	} {
		t.Run(tc.input, func(t *testing.T) {
			if got := NormalizeNotation(tc.input); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
