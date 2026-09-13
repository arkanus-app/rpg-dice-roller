package dicecore

import (
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestParserTypeScriptFixtures(t *testing.T) {
	for _, raw := range loadFixtureCases(t, "parser.json") {
		var fixture struct {
			Name    string            `json:"name"`
			Input   string            `json:"input"`
			Limits  *DiceParserLimits `json:"limits"`
			Outcome json.RawMessage   `json:"outcome"`
		}
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
		t.Run(fixture.Name, func(t *testing.T) {
			var node *ExpressionNode
			var err error
			if fixture.Limits == nil {
				node, err = ParseDiceNotation(fixture.Input)
			} else {
				node, err = ParseDiceNotation(fixture.Input, *fixture.Limits)
			}
			assertFixtureOutcome(t, fixture.Outcome, node, err)
		})
	}
}

func TestParseNotationAppliesExecutionLimits(t *testing.T) {
	limits := DefaultDiceLimits()
	limits.MaxInputLength = 3
	_, err := ParseNotation("1d20", limits)
	var diceErr *DiceRollError
	if !errors.As(err, &diceErr) || diceErr.Code != "INPUT_TOO_LONG" {
		t.Fatalf("expected INPUT_TOO_LONG, received %v", err)
	}
	limits = DefaultDiceLimits()
	limits.MaxAstDepth = 2
	_, err = ParseNotation("1+2*3", limits)
	if !errors.As(err, &diceErr) || diceErr.Code != "AST_TOO_DEEP" {
		t.Fatalf("expected AST_TOO_DEEP, received %v", err)
	}
	limits = DefaultDiceLimits()
	limits.MaxAstNodes = 3
	_, err = ParseNotation("1d5step(+1)", limits)
	if !errors.As(err, &diceErr) || diceErr.Code != "TOO_MANY_NODES" {
		t.Fatalf("expected TOO_MANY_NODES, received %v", err)
	}
	if _, err := ParseNotation("max(abs(-2),(1+2)d(3+3))", DefaultDiceLimits()); err != nil {
		t.Fatal(err)
	}
}

func TestParserAssociativityAndStructuralBinding(t *testing.T) {
	node, err := ParseDiceNotation("-2^2^3")
	if err != nil {
		t.Fatal(err)
	}
	if node.Kind != "unary" || node.Operand.Kind != "binary" || node.Operand.Right.Kind != "binary" {
		t.Fatalf("incorrect exponent precedence: %#v", node)
	}
	node, err = ParseDiceNotation("(1d20+2)adv")
	if err != nil {
		t.Fatal(err)
	}
	if node.ID != "parenthesized@0:11" || node.Expression.ID != "binary@1:7" || node.Expression.Left.ID != "dice@1:5" || node.Expression.Left.Modifiers[0].Selection != "highest" {
		t.Fatalf("incorrect postfix binding: %#v", node)
	}
	for _, input := range []string{"1+2adv", "1d20+1d6+2adv", "max(1d20,1d6)+2pool(-1)"} {
		if _, err := ParseDiceNotation(input); err == nil {
			t.Fatalf("accepted ambiguous target: %s", input)
		}
	}
	// Zero pool postfixes are deliberately discarded before searching for a target.
	node, err = ParseDiceNotation("1+2pool(0)")
	if err != nil {
		t.Fatal(err)
	}
	if node.ID != "binary@0:3" {
		t.Fatalf("zero postfix changed AST: %s", node.ID)
	}
}

func TestParserCountsAllModifierChildren(t *testing.T) {
	for _, tc := range []struct {
		input string
		nodes int64
	}{
		{"1d6!>=6", 5}, {"1d6>=5f=1", 6}, {"1d6r!=1", 5}, {"1d6u=1", 5}, {"1d6cs=6", 5}, {"1d6cf=1", 5},
		{"{1,2}kh1", 4}, {"pow(1,2)", 3}, {"-1", 2}, {"(1)", 2},
	} {
		t.Run(tc.input, func(t *testing.T) {
			_, err := ParseDiceNotation(tc.input, DiceParserLimits{MaxDepth: 100, MaxNodes: tc.nodes - 1})
			var diceErr *DiceRollError
			if !errors.As(err, &diceErr) || diceErr.Code != "TOO_MANY_NODES" {
				t.Fatalf("expected node cap error, received %v", err)
			}
			if _, err = ParseDiceNotation(tc.input, DiceParserLimits{MaxDepth: 100, MaxNodes: tc.nodes}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSyntaxMarshalJSONShapes(t *testing.T) {
	first, err := ParseDiceNotation("8d10!!p>=10>=8f=1dl1kh2min1max10ro<2uo=3cs=10cf=1sd")
	if err != nil {
		t.Fatal(err)
	}
	second, err := ParseDiceNotation("8d10!!p>=10>=8f=1dl1kh2min1max10ro<2uo=3cs=10cf=1sd")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatal("AST is not deterministic")
	}
	encoded, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"maxExplosions":null`) || !strings.Contains(string(encoded), `"implicit":false`) {
		t.Fatalf("missing explicit null/false fields: %s", encoded)
	}
}

func TestParserSignedComparePoints(t *testing.T) {
	node, err := ParseDiceNotation("2dF>=+1f=-1ro<-0.5cs>=+1cf=-1")
	if err != nil {
		t.Fatal(err)
	}
	if node.Modifiers[0].Success.Value != 1 || node.Modifiers[0].Failure.Value != -1 || node.Modifiers[1].Compare.Value != -0.5 || node.Modifiers[2].Compare.Value != 1 || node.Modifiers[3].Compare.Value != -1 {
		t.Fatalf("incorrect signed thresholds: %#v", node.Modifiers)
	}
}

func TestSyntaxJSONCanonicalizesNegativeZero(t *testing.T) {
	node, err := ParseDiceNotation("1d6min-0r=-0")
	if err != nil {
		t.Fatal(err)
	}
	if !math.Signbit(node.Modifiers[0].Value) || !math.Signbit(node.Modifiers[1].Compare.Value) {
		t.Fatal("AST lost signed zero")
	}
	encoded, err := json.Marshal(node)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), `"value":-0`) {
		t.Fatalf("JSON differs from TypeScript's canonical zero: %s", encoded)
	}
}

func FuzzParseNotation(f *testing.F) {
	for _, input := range []string{"1d20", "1d6r!=1", "(1d20+2)adv", "max(abs(-2),(1+2)d(3+3))", "{1d6,2d8+3}kh1", "", "😀", "1d6!!p2>=6"} {
		f.Add(input)
	}
	f.Fuzz(func(t *testing.T, input string) {
		_, err := ParseNotation(input, DefaultDiceLimits())
		if err != nil && !IsDiceRollError(err) {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}
