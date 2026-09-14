package dicecore

import (
	"math"
	"math/big"
	"strconv"
	"strings"
)

const MathProfile = "decimal12-v1"

func mathNumberString(value float64) string {
	switch {
	case math.IsNaN(value):
		return "NaN"
	case math.IsInf(value, 1):
		return "Infinity"
	case math.IsInf(value, -1):
		return "-Infinity"
	default:
		return strconv.FormatFloat(value, 'g', -1, 64)
	}
}

func ensureFiniteMath(value float64, input string) (float64, error) {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, newDiceError("NON_FINITE_RESULT", "Dice expression produced a non-finite result", input,
			map[string]any{"value": mathNumberString(value)})
	}
	if value == 0 {
		return 0, nil
	}
	return value, nil
}

// decimalRound follows the decimal rounding rule of JS toPrecision/toFixed:
// round the exact binary64 value to a decimal quantum, ties away from zero.
// strconv.FormatFloat alone uses ties-to-even and differs on exact midpoints.
func decimalRound(value float64, decimalPlaces int) float64 {
	negative := value < 0
	rat := new(big.Rat).SetFloat64(math.Abs(value))
	magnitude := decimalPlaces
	if magnitude < 0 {
		magnitude = -magnitude
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(magnitude)), nil)
	if decimalPlaces >= 0 {
		rat.Mul(rat, new(big.Rat).SetInt(scale))
	} else {
		rat.Quo(rat, new(big.Rat).SetInt(scale))
	}
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(rat.Num(), rat.Denom(), remainder)
	if remainder.Lsh(remainder, 1).Cmp(rat.Denom()) >= 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	rat.SetInt(quotient)
	if decimalPlaces >= 0 {
		rat.Quo(rat, new(big.Rat).SetInt(scale))
	} else {
		rat.Mul(rat, new(big.Rat).SetInt(scale))
	}
	result, _ := rat.Float64()
	if negative {
		result = -result
	}
	return result
}

// NormalizeMathValue applies the versioned numeric profile after each operation.
func NormalizeMathValue(value float64, input string) (float64, error) {
	finite, err := ensureFiniteMath(value, input)
	if err != nil {
		return 0, err
	}
	if math.Trunc(finite) == finite && math.Abs(finite) <= float64(maxSafeInteger) {
		return finite, nil
	}
	scientific := strconv.FormatFloat(math.Abs(finite), 'e', 17, 64)
	exponent, _ := strconv.Atoi(scientific[strings.LastIndexByte(scientific, 'e')+1:])
	return ensureFiniteMath(decimalRound(finite, 11-exponent), input)
}

func jsMathPow(left, right float64) float64 {
	if math.IsNaN(right) || (math.Abs(left) == 1 && math.IsInf(right, 0)) {
		return math.NaN()
	}
	return refinePowIntegerBoundary(left, right, fdPow(left, right))
}

func EvaluateBinary(operator string, left, right float64, input string) (float64, error) {
	var result float64
	switch operator {
	case "+":
		result = left + right
	case "-":
		result = left - right
	case "*":
		result = left * right
	case "/":
		result = left / right
	case "%":
		result = math.Mod(left, right)
	case "^", "**":
		result = jsMathPow(left, right)
	default:
		return 0, newDiceError("INVALID_NOTATION", "Unknown binary operator", input, map[string]any{"operator": operator})
	}
	return NormalizeMathValue(result, input)
}

// EvaluateUnaryFunction evaluates a math function with decimal12 normalization.
// Transcendental functions use the reference runtime's portable fdlibm kernels.
func EvaluateUnaryFunction(name string, value float64, input string) (float64, error) {
	var result float64
	switch name {
	case "abs":
		result = math.Abs(value)
	case "ceil":
		result = math.Ceil(value)
	case "cos":
		result = fdCos(value)
	case "exp":
		result = fdExp(value)
	case "floor":
		result = math.Floor(value)
	case "log":
		result = fdLog(value)
	case "round":
		result = math.Floor(value)
		if value-result >= 0.5 {
			result++
		}
	case "sign":
		switch {
		case math.IsNaN(value):
			result = value
		case value > 0:
			result = 1
		case value < 0:
			result = -1
		}
	case "sin":
		result = fdSin(value)
	case "sqrt":
		result = math.Sqrt(value)
	case "tan":
		result = fdTan(value)
	default:
		return 0, newDiceError("INVALID_NOTATION", "Unknown unary math function", input, map[string]any{"name": name})
	}
	return NormalizeMathValue(result, input)
}

func EvaluateBinaryFunction(name string, left, right float64, input string) (float64, error) {
	var result float64
	switch name {
	case "max":
		if math.IsNaN(left) || math.IsNaN(right) {
			result = math.NaN()
		} else {
			result = math.Max(left, right)
		}
	case "min":
		if math.IsNaN(left) || math.IsNaN(right) {
			result = math.NaN()
		} else {
			result = math.Min(left, right)
		}
	case "pow":
		result = jsMathPow(left, right)
	default:
		return 0, newDiceError("INVALID_NOTATION", "Unknown binary math function", input, map[string]any{"name": name})
	}
	return NormalizeMathValue(result, input)
}

func CompareValues(operator string, left, right float64) bool {
	switch operator {
	case "=":
		return left == right
	case "!=", "<>":
		return left != right
	case "<":
		return left < right
	case ">":
		return left > right
	case "<=":
		return left <= right
	case ">=":
		return left >= right
	default:
		return false
	}
}

func RoundResult(value float64) (float64, error) {
	normalized, err := NormalizeMathValue(value, "")
	if err != nil {
		return 0, err
	}
	// A finite integral binary64 is already unchanged by decimal toFixed(2).
	// Most dice totals take this path; fractional totals retain exact rounding.
	if math.Trunc(normalized) == normalized {
		return normalized, nil
	}
	return ensureFiniteMath(decimalRound(normalized, 2), "")
}
