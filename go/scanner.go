package dicecore

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf16"
)

var syntaxReservedWords = []string{
	"pool", "step", "adv", "dis", "floor", "round", "sqrt", "ceil", "sign",
	"abs", "cos", "exp", "log", "sin", "tan", "pow", "max", "min", "dF", "cs", "cf",
}

var syntaxPunctuationKinds = map[uint16]string{
	'(': "left-parenthesis", ')': "right-parenthesis", '{': "left-brace",
	'}': "right-brace", ',': "comma", '.': "dot", '!': "bang",
}

func syntaxUnits(input string) []uint16  { return utf16.Encode([]rune(input)) }
func syntaxString(input []uint16) string { return string(utf16.Decode(input)) }
func syntaxChar(input []uint16, i int) uint16 {
	if i < 0 || i >= len(input) {
		return 0
	}
	return input[i]
}
func syntaxDigit(c uint16) bool { return c >= '0' && c <= '9' }
func syntaxAlpha(c uint16) bool { return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' }
func syntaxWhitespace(c uint16) bool {
	return c == 0x09 || c == 0x0a || c == 0x0b || c == 0x0c || c == 0x0d || c == 0x20 || c == 0xa0 ||
		c == 0x1680 || c >= 0x2000 && c <= 0x200a || c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff
}
func syntaxInvalid(input, message string, span SourceSpan, details map[string]any) *DiceRollError {
	err := newDiceError("INVALID_NOTATION", message, input, details)
	err.Span = &span
	return err
}

// TokenizeDiceNotation scans compact notation, retaining JavaScript-compatible
// UTF-16 half-open source offsets. The scanner deliberately separates ! and =.
func TokenizeDiceNotation(input string) ([]SyntaxToken, error) {
	units := syntaxUnits(input)
	tokens := make([]SyntaxToken, 0, len(units)/2+1)
	for cursor := 0; cursor < len(units); {
		start, c := cursor, units[cursor]
		if syntaxWhitespace(c) {
			cursor++
			continue
		}
		token := SyntaxToken{Span: SourceSpan{Start: start}}
		switch {
		case syntaxDigit(c):
			for syntaxDigit(syntaxChar(units, cursor)) {
				cursor++
			}
			if syntaxChar(units, cursor) == '.' && syntaxDigit(syntaxChar(units, cursor+1)) {
				cursor++
				for syntaxDigit(syntaxChar(units, cursor)) {
					cursor++
				}
			}
			token.Kind, token.Lexeme = "number", syntaxString(units[start:cursor])
			value, err := strconv.ParseFloat(token.Lexeme, 64)
			if err != nil || math.IsInf(value, 0) || math.IsNaN(value) {
				return nil, syntaxInvalid(input, fmt.Sprintf("Numeric literal is not finite at offset %d", start), SourceSpan{Start: start, End: cursor}, map[string]any{"found": token.Lexeme})
			}
			token.NumberValue = value
		case syntaxAlpha(c):
			remaining := syntaxString(units[cursor:])
			for _, word := range syntaxReservedWords {
				if strings.HasPrefix(remaining, word) {
					token.Value = word
					break
				}
			}
			if token.Value == "" && strings.ContainsRune("dkrusfpolha", rune(c)) {
				token.Value = string(rune(c))
			}
			if token.Value == "" {
				return nil, syntaxInvalid(input, fmt.Sprintf("Unexpected identifier at offset %d", start), SourceSpan{Start: start, End: start + 1}, map[string]any{"found": string(rune(c))})
			}
			token.Kind, token.Lexeme = "identifier", token.Value
			cursor += len(token.Value)
		case c == '*' && syntaxChar(units, cursor+1) == '*':
			token.Kind, token.Value, token.Lexeme = "operator", "**", "**"
			cursor += 2
		case (c == '<' || c == '>') && syntaxChar(units, cursor+1) == '=' || c == '<' && syntaxChar(units, cursor+1) == '>':
			token.Kind, token.Value = "comparison", syntaxString(units[cursor:cursor+2])
			token.Lexeme = token.Value
			cursor += 2
		case strings.ContainsRune("+-*/%^", rune(c)):
			token.Kind, token.Value, token.Lexeme = "operator", string(rune(c)), string(rune(c))
			cursor++
		case c == '=' || c == '<' || c == '>':
			token.Kind, token.Value, token.Lexeme = "comparison", string(rune(c)), string(rune(c))
			cursor++
		default:
			kind, ok := syntaxPunctuationKinds[c]
			if !ok {
				return nil, syntaxInvalid(input, fmt.Sprintf("Unexpected character at offset %d", start), SourceSpan{Start: start, End: start + 1}, map[string]any{"found": syntaxString(units[start : start+1])})
			}
			token.Kind, token.Lexeme = kind, string(rune(c))
			cursor++
		}
		token.Span.End = cursor
		tokens = append(tokens, token)
	}
	return append(tokens, SyntaxToken{Kind: "eof", Span: SourceSpan{Start: len(units), End: len(units)}}), nil
}
