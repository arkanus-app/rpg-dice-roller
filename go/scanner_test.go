package dicecore

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestScannerContextualNotEqual(t *testing.T) {
	tokens, err := TokenizeDiceNotation("1d6r!=1")
	if err != nil {
		t.Fatal(err)
	}
	expected := []SyntaxToken{
		{Kind: "number", Lexeme: "1", NumberValue: 1, Span: SourceSpan{Start: 0, End: 1}},
		{Kind: "identifier", Lexeme: "d", Value: "d", Span: SourceSpan{Start: 1, End: 2}},
		{Kind: "number", Lexeme: "6", NumberValue: 6, Span: SourceSpan{Start: 2, End: 3}},
		{Kind: "identifier", Lexeme: "r", Value: "r", Span: SourceSpan{Start: 3, End: 4}},
		{Kind: "bang", Lexeme: "!", Span: SourceSpan{Start: 4, End: 5}},
		{Kind: "comparison", Lexeme: "=", Value: "=", Span: SourceSpan{Start: 5, End: 6}},
		{Kind: "number", Lexeme: "1", NumberValue: 1, Span: SourceSpan{Start: 6, End: 7}},
		{Kind: "eof", Span: SourceSpan{Start: 7, End: 7}},
	}
	if !reflect.DeepEqual(tokens, expected) {
		t.Fatalf("got %#v", tokens)
	}
	encoded, err := json.Marshal(tokens)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"value":1`) || !strings.Contains(string(encoded), `"value":"="`) {
		t.Fatalf("incorrect token JSON: %s", encoded)
	}
}

func TestScannerWhitespaceAndUTF16Spans(t *testing.T) {
	whitespace := "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
	tokens, err := TokenizeDiceNotation(whitespace + "1")
	if err != nil {
		t.Fatal(err)
	}
	if tokens[0].Span.Start != 25 || tokens[0].Span.End != 26 {
		t.Fatalf("wrong whitespace span: %+v", tokens[0].Span)
	}
	_, err = TokenizeDiceNotation("1d6+😀")
	var diceErr *DiceRollError
	if !errors.As(err, &diceErr) || diceErr.Span == nil || *diceErr.Span != (SourceSpan{Start: 4, End: 5}) {
		t.Fatalf("wrong UTF16 error: %#v", err)
	}
}

func TestScannerRejectsUnknownAndNonFiniteTokens(t *testing.T) {
	for _, input := range []string{"@", "$", "?", "1d6&2", "z", "D6", strings.Repeat("9", 400)} {
		t.Run(input[:min(len(input), 20)], func(t *testing.T) {
			_, err := TokenizeDiceNotation(input)
			var diceErr *DiceRollError
			if !errors.As(err, &diceErr) || diceErr.Code != "INVALID_NOTATION" || diceErr.Span == nil {
				t.Fatalf("expected invalid notation, received %v", err)
			}
		})
	}
}

func TestScannerCompleteTokenSurface(t *testing.T) {
	tokens, err := TokenizeDiceNotation("pool(+1)step(-2)advdis 0.25**2<=1>=0<>3!=4<5>0=1 {dF.2,d%}! 1+2-3*4/5%6^7")
	if err != nil {
		t.Fatal(err)
	}
	comparisons := []string{}
	for _, token := range tokens {
		if token.Kind == "comparison" {
			comparisons = append(comparisons, token.Lexeme)
		}
	}
	if !reflect.DeepEqual(comparisons, []string{"<=", ">=", "<>", "=", "<", ">", "="}) {
		t.Fatalf("wrong comparisons: %v", comparisons)
	}
}
