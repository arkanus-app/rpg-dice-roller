package dicecore

import (
	"regexp"
	"strconv"
	"strings"
)

type NormalizedDiceInput struct {
	Input              string  `json:"input"`
	Comment            string  `json:"comment"`
	Notation           string  `json:"notation"`
	NormalizedNotation string  `json:"normalizedNotation"`
	RollCount          float64 `json:"rollCount"`
	IsMultiRoll        bool    `json:"isMultiRoll"`
}
type syntaxCleanedInput struct {
	notation string
	comment  string
}

func syntaxBoundary(c uint16) bool { return c == 0 || !(syntaxAlpha(c) || syntaxDigit(c) || c == '_') }
func syntaxLower(c uint16) uint16 {
	if c >= 'A' && c <= 'Z' {
		return c + ('a' - 'A')
	}
	return c
}
func syntaxOperatorComparison(c uint16) bool { return c == '<' || c == '>' || c == '=' || c == '!' }
func syntaxFind(units []uint16, start int, sequence string) int {
	for i := start; i <= len(units)-len(sequence); i++ {
		match := true
		for j := range sequence {
			if units[i+j] != uint16(sequence[j]) {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}
func syntaxLineEnd(units []uint16, start int) int {
	for i := start; i < len(units); i++ {
		c := units[i]
		if c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029 {
			return i
		}
	}
	return len(units)
}
func syntaxAllDigits(input string) bool {
	if input == "" {
		return false
	}
	for i := range input {
		if input[i] < '0' || input[i] > '9' {
			return false
		}
	}
	return true
}
func syntaxValidComputedCount(expression string) bool {
	value, ok := ResolveRollCountExpression(expression)
	return ok && syntaxSafeInteger(value) && value >= 0
}
func syntaxCleanInput(input string) syntaxCleanedInput {
	units := syntaxUnits(input)
	notation := []uint16{}
	comments := []string{}
	retainedMarker := false
	pushComment := func(comment []uint16) {
		normalized := syntaxTrimSpace(syntaxString(comment))
		if normalized != "" {
			comments = append(comments, normalized)
		}
	}
	for cursor := 0; cursor < len(units); {
		c, next := units[cursor], syntaxChar(units, cursor+1)
		if c == '/' && next == '*' {
			end := syntaxFind(units, cursor+2, "*/")
			commentEnd := end
			if end < 0 {
				commentEnd = len(units)
			}
			pushComment(units[cursor+2 : commentEnd])
			if end < 0 {
				cursor = len(units)
			} else {
				cursor = end + 2
			}
			continue
		}
		if c == '/' && next == '/' {
			end := syntaxLineEnd(units, cursor+2)
			pushComment(units[cursor+2 : end])
			cursor = end
			continue
		}
		if c == '[' {
			end := syntaxFind(units, cursor+1, "]")
			commentEnd := end
			if end < 0 {
				commentEnd = len(units)
			}
			if len(notation) == 0 && end >= 0 {
				after := end + 1
				for syntaxWhitespace(syntaxChar(units, after)) {
					after++
				}
				prefix := units[cursor : end+1]
				if syntaxChar(units, after) == '#' && syntaxValidComputedCount(syntaxString(prefix)) {
					notation = append(notation, prefix...)
					cursor = end + 1
					continue
				}
			}
			pushComment(units[cursor+1 : commentEnd])
			if end < 0 {
				cursor = len(units)
			} else {
				cursor = end + 1
			}
			continue
		}
		if c == '#' {
			prefix := syntaxRemoveWhitespace(syntaxString(notation))
			literal := syntaxAllDigits(prefix)
			computed, hasComputed := float64(0), false
			if !literal {
				computed, hasComputed = ResolveRollCountExpression(prefix)
				hasComputed = hasComputed && syntaxSafeInteger(computed) && computed >= 0
			}
			if !retainedMarker && (literal || hasComputed) {
				if hasComputed {
					notation = syntaxUnits(syntaxNumberString(computed))
				}
				notation = append(notation, c)
				retainedMarker = true
				cursor++
				continue
			}
			end := syntaxLineEnd(units, cursor+1)
			pushComment(units[cursor+1 : end])
			cursor = end
			continue
		}
		if !syntaxWhitespace(c) {
			notation = append(notation, c)
		}
		cursor++
	}
	return syntaxCleanedInput{notation: syntaxString(notation), comment: syntaxTrimSpace(strings.Join(comments, " "))}
}
func syntaxReadWhile(source []uint16, start int, matcher func(uint16) bool) (string, int) {
	cursor := start
	for cursor < len(source) && matcher(source[cursor]) {
		cursor++
	}
	return syntaxString(source[start:cursor]), cursor
}
func syntaxReadDiceSides(source []uint16, start int) (string, int) {
	c := syntaxChar(source, start)
	if c == '(' {
		return "", start
	}
	if c == '%' {
		return "%", start + 1
	}
	if syntaxLower(c) == 'f' {
		cursor := start + 1
		if syntaxChar(source, cursor) == '.' && (syntaxChar(source, cursor+1) == '1' || syntaxChar(source, cursor+1) == '2') {
			return "F." + string(rune(source[cursor+1])), cursor + 2
		}
		return "F", cursor
	}
	if syntaxDigit(c) {
		return syntaxReadWhile(source, start, syntaxDigit)
	}
	return "20", start
}
func syntaxNormalizeAlpha(token string, next uint16) string {
	lower := strings.ToLower(token)
	if lower == "f" && syntaxBoundary(next) && !syntaxOperatorComparison(next) {
		return "4dF"
	}
	if lower == "ei" && (syntaxDigit(next) || syntaxOperatorComparison(next) || next == 0) {
		if syntaxDigit(next) {
			return "!>="
		}
		return "!"
	}
	switch lower {
	case "km":
		if syntaxDigit(next) {
			return "kl"
		}
		return "kl1"
	case "kh", "kl", "k":
		if syntaxDigit(next) {
			return lower
		}
		return lower + "1"
	}
	return token
}
func syntaxNormalizeFriendly(notation string) string {
	source := syntaxUnits(notation)
	var output strings.Builder
	for cursor := 0; cursor < len(source); {
		c := source[cursor]
		if syntaxDigit(c) {
			quantity, afterQuantity := syntaxReadWhile(source, cursor, syntaxDigit)
			marker, afterMarker := syntaxChar(source, afterQuantity), syntaxChar(source, afterQuantity+1)
			if syntaxLower(marker) == 'd' && (afterMarker == 0 || syntaxBoundary(afterMarker) || syntaxDigit(afterMarker) || afterMarker == '%' || syntaxLower(afterMarker) == 'f') {
				sides, afterSides := syntaxReadDiceSides(source, afterQuantity+1)
				value, _ := strconv.ParseFloat(quantity, 64)
				if value == 0 {
					output.WriteByte('0')
				} else {
					output.WriteString(quantity + "d" + sides)
				}
				cursor = afterSides
				continue
			}
			if syntaxLower(marker) == 'f' && syntaxBoundary(afterMarker) && !syntaxOperatorComparison(afterMarker) {
				output.WriteString(quantity + "dF")
				cursor = afterQuantity + 1
				continue
			}
			output.WriteString(quantity)
			cursor = afterQuantity
			continue
		}
		if syntaxLower(c) == 'd' {
			next := syntaxChar(source, cursor+1)
			if syntaxLower(next) == 'f' || next == 0 || syntaxBoundary(next) || syntaxDigit(next) || next == '%' {
				sides, afterSides := syntaxReadDiceSides(source, cursor+1)
				output.WriteString("d" + sides)
				cursor = afterSides
				continue
			}
		}
		if syntaxAlpha(c) {
			token, afterToken := syntaxReadWhile(source, cursor, syntaxAlpha)
			output.WriteString(syntaxNormalizeAlpha(token, syntaxChar(source, afterToken)))
			cursor = afterToken
			continue
		}
		// Copy complete surrogate pairs so non-BMP comments/invalid source remain intact.
		if c >= 0xd800 && c <= 0xdbff && syntaxChar(source, cursor+1) >= 0xdc00 && syntaxChar(source, cursor+1) <= 0xdfff {
			output.WriteString(syntaxString(source[cursor : cursor+2]))
			cursor += 2
		} else {
			output.WriteString(syntaxString(source[cursor : cursor+1]))
			cursor++
		}
	}
	return output.String()
}

var syntaxPullAlias = regexp.MustCompile(`(?i)pull`)
var syntaxStrepAlias = regexp.MustCompile(`(?i)strep`)
var syntaxStructuralWords = regexp.MustCompile(`(?i)pool|step|adv|dis`)
var syntaxStructuralSign = regexp.MustCompile(`([+-])(pool|step)\(([0-9]+)\)`)

func syntaxNormalizeStructural(notation string) string {
	canonical := syntaxPullAlias.ReplaceAllString(notation, "pool")
	canonical = syntaxStrepAlias.ReplaceAllString(canonical, "step")
	canonical = syntaxStructuralWords.ReplaceAllStringFunc(canonical, strings.ToLower)
	return syntaxStructuralSign.ReplaceAllString(canonical, `${2}(${1}${3})`)
}
func syntaxNormalizeOperators(notation string) string {
	normalized := notation
	for {
		previous := normalized
		normalized = strings.ReplaceAll(normalized, "+-", "-")
		normalized = strings.ReplaceAll(normalized, "-+", "-")
		normalized = strings.ReplaceAll(normalized, "++", "+")
		normalized = strings.ReplaceAll(normalized, "--", "+")
		if normalized == previous {
			break
		}
	}
	if strings.HasPrefix(normalized, "+") || strings.HasPrefix(normalized, "-") {
		normalized = normalized[1:]
	}
	return normalized
}
func syntaxNormalized(cleaned syntaxCleanedInput) string {
	return syntaxNormalizeOperators(syntaxNormalizeStructural(syntaxNormalizeFriendly(cleaned.notation)))
}

// NormalizeRPGDiceNotation applies the existing ERPG friendly aliases and strips comments.
func NormalizeRPGDiceNotation(input string) string { return syntaxNormalized(syntaxCleanInput(input)) }
func NormalizeNotation(input string) string        { return NormalizeRPGDiceNotation(input) }

// ParseNormalizedDiceInput extracts comments and deterministic multi-roll prefixes.
func ParseNormalizedDiceInput(input string) NormalizedDiceInput {
	cleaned := syntaxCleanInput(input)
	normalized := syntaxNormalized(cleaned)
	notation := normalized
	count := float64(1)
	multi := false
	if marker := strings.IndexByte(normalized, '#'); marker > 0 && syntaxAllDigits(normalized[:marker]) {
		count, _ = strconv.ParseFloat(normalized[:marker], 64)
		notation = normalized[marker+1:]
		multi = true
	}
	return NormalizedDiceInput{Input: input, Comment: cleaned.comment, Notation: notation, NormalizedNotation: normalized, RollCount: count, IsMultiRoll: multi}
}
func ParseNormalizedInput(input string) NormalizedDiceInput { return ParseNormalizedDiceInput(input) }
