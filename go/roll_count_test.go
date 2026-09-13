package dicecore

import (
	"strings"
	"testing"
)

func TestResolveRollCountExpression(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  float64
	}{
		{"3-1", 2}, {"(3-1)", 2}, {"{3-1}", 2}, {"[3-1]", 2}, {"([{3-1}])", 2},
		{"ceil(3/2)", 2}, {"max(1,pow(2,3))", 8}, {"-2^2", -4}, {"2**3", 8},
		{" +1 ", 1}, {"[ 2 ]", 2}, {"1/2", 0.5}, {"abs(-2)", 2}, {"min(5,3)", 3}, {"1 + 2", 3},
	} {
		t.Run(tc.input, func(t *testing.T) {
			value, ok := ResolveRollCountExpression(tc.input)
			if !ok || value != tc.want {
				t.Fatalf("got (%v,%v), want (%v,true)", value, ok, tc.want)
			}
		})
	}
	for _, input := range []string{"", " ", "()", "1d6", "1dF", "max({1,2},3)", "{1,2}", "1+1d6", "-(1d6)", "(1d6)", "abs(1d6)", "max(1,1d6)", "max(1d6,1)", "(1)+(2)", "([1)]", "[{1)]", "(1))", "[1", "sqrt(-1)", "1/0", strings.Repeat("abs(", 65) + "1" + strings.Repeat(")", 65), strings.Repeat("1+", 300) + "1"} {
		t.Run("reject-"+input[:min(len(input), 30)], func(t *testing.T) {
			// Separate parenthesized terms remain valid arithmetic, rather than an outer group.
			if input == "(1)+(2)" {
				value, ok := ResolveRollCountExpression(input)
				if !ok || value != 3 {
					t.Fatalf("got %v,%v", value, ok)
				}
				return
			}
			if value, ok := ResolveRollCountExpression(input); ok {
				t.Fatalf("unexpected constant %v", value)
			}
		})
	}
}
