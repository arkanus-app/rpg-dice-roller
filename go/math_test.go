package dicecore

import (
	"errors"
	"math"
	"testing"
)

func requireErrorCode(t *testing.T, err error, code string) {
	t.Helper()
	var diceErr *DiceRollError
	if !errors.As(err, &diceErr) || diceErr.Code != code {
		t.Fatalf("got %v, want error code %s", err, code)
	}
}

func TestMathNumberFormatting(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value float64
		want  string
	}{
		{"integer", 42, "42"},
		{"negative fraction", -12.375, "-12.375"},
		{"zero", 0, "0"},
		{"negative zero", math.Copysign(0, -1), "-0"},
		{"subnormal", math.SmallestNonzeroFloat64, "5e-324"},
		{"large finite", 1e30, "1e+30"},
		{"not a number", math.NaN(), "NaN"},
		{"positive infinity", math.Inf(1), "Infinity"},
		{"negative infinity", math.Inf(-1), "-Infinity"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := mathNumberString(tc.value); got != tc.want {
				t.Fatalf("numeric diagnostic: got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestMathProfile(t *testing.T) {
	if MathProfile != "decimal12-v1" {
		t.Fatal(MathProfile)
	}
	for _, tc := range []struct{ value, want float64 }{
		{math.Copysign(0, -1), 0}, {0.1 + 0.2, 0.3}, {1.0 / 3, 0.333333333333},
		{float64(maxSafeInteger), float64(maxSafeInteger)}, {1.23456789012345e25, 1.23456789012e25},
		{123456789012.5, 123456789013}, {-123456789012.5, -123456789013},
		{math.SmallestNonzeroFloat64, math.SmallestNonzeroFloat64},
		{math.MaxFloat64, 1.79769313486e308},
	} {
		got, err := NormalizeMathValue(tc.value, "")
		if err != nil || got != tc.want || (got == 0 && math.Signbit(got)) {
			t.Errorf("normalize(%v): %v, %v; want %v", tc.value, got, err, tc.want)
		}
	}
	for _, value := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		_, err := NormalizeMathValue(value, "math")
		requireErrorCode(t, err, "NON_FINITE_RESULT")
	}
}

func TestBinaryMath(t *testing.T) {
	for _, tc := range []struct {
		op                string
		left, right, want float64
	}{
		{"+", 7, 2, 9}, {"-", 7, 2, 5}, {"*", 7, 2, 14}, {"/", 7, 2, 3.5},
		{"%", -7, 2, -1}, {"^", 7, 2, 49}, {"**", 2, 3, 8},
	} {
		got, err := EvaluateBinary(tc.op, tc.left, tc.right, "")
		if err != nil || got != tc.want {
			t.Errorf("%s: %v %v", tc.op, got, err)
		}
	}
	_, err := EvaluateBinary("/", 1, 0, "1/0")
	requireErrorCode(t, err, "NON_FINITE_RESULT")
	_, err = EvaluateBinary("?", 1, 2, "bad")
	requireErrorCode(t, err, "INVALID_NOTATION")
	for _, exponent := range []float64{math.Inf(1), math.Inf(-1), math.NaN()} {
		_, err = EvaluateBinary("^", 1, exponent, "")
		requireErrorCode(t, err, "NON_FINITE_RESULT")
	}
}

func TestMathFunctions(t *testing.T) {
	for _, tc := range []struct {
		name        string
		value, want float64
	}{
		{"abs", -2, 2}, {"ceil", 1.2, 2}, {"cos", 0, 1}, {"exp", 0, 1},
		{"floor", 1.8, 1}, {"log", 1, 0}, {"round", 1.6, 2}, {"round", -1.5, -1},
		{"round", 0.49999999999999994, 0}, {"round", -0.5, 0},
		{"sign", -4, -1}, {"sign", 4, 1}, {"sign", 0, 0},
		{"sin", 0, 0}, {"sqrt", 9, 3}, {"tan", 0, 0},
	} {
		got, err := EvaluateUnaryFunction(tc.name, tc.value, "")
		if err != nil || got != tc.want {
			t.Errorf("%s(%v): %v %v", tc.name, tc.value, got, err)
		}
	}
	_, err := EvaluateUnaryFunction("sign", math.NaN(), "")
	requireErrorCode(t, err, "NON_FINITE_RESULT")
	_, err = EvaluateUnaryFunction("sqrt", -1, "sqrt(-1)")
	requireErrorCode(t, err, "NON_FINITE_RESULT")
	_, err = EvaluateUnaryFunction("unknown", 1, "")
	requireErrorCode(t, err, "INVALID_NOTATION")
	for _, tc := range []struct {
		name              string
		left, right, want float64
	}{
		{"min", 2, 8, 2}, {"max", 2, 8, 8}, {"pow", 2, 8, 256},
	} {
		got, err := EvaluateBinaryFunction(tc.name, tc.left, tc.right, "")
		if err != nil || got != tc.want {
			t.Errorf("%s: %v %v", tc.name, got, err)
		}
	}
	_, err = EvaluateBinaryFunction("unknown", 1, 2, "")
	requireErrorCode(t, err, "INVALID_NOTATION")
}

func TestCompareAndRound(t *testing.T) {
	for _, op := range []string{"=", "<=", ">="} {
		if !CompareValues(op, 2, 2) {
			t.Error(op)
		}
	}
	for _, op := range []string{"!=", "<>", "<"} {
		if !CompareValues(op, 2, 3) {
			t.Error(op)
		}
	}
	if !CompareValues(">", 3, 2) || CompareValues("?", 2, 2) {
		t.Fatal("comparison")
	}
	for _, tc := range []struct{ value, want float64 }{
		{1.234, 1.23}, {-0.001, 0}, {1.125, 1.13}, {-1.125, -1.13}, {1.005, 1},
		{1e21, 1e21}, {0, 0},
	} {
		got, err := RoundResult(tc.value)
		if err != nil || got != tc.want || (got == 0 && math.Signbit(got)) {
			t.Errorf("round(%v): %v %v", tc.value, got, err)
		}
	}
	_, err := RoundResult(math.NaN())
	requireErrorCode(t, err, "NON_FINITE_RESULT")
}
