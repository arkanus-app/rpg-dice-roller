package dicecore

import (
	"math"
	"testing"
)

func TestMathArgumentReductionKernel(t *testing.T) {
	for _, x := range []float64{0, math.Copysign(0, -1), 0.5, -0.5} {
		n, high, low := fdRemPiOver2(x)
		if n != 0 || math.Float64bits(high) != math.Float64bits(x) || low != 0 {
			t.Fatalf("small argument %.17g: n=%d high=%.17g low=%.17g", x, n, high, low)
		}
	}
	for _, x := range []float64{math.Inf(1), math.Inf(-1), math.NaN()} {
		n, high, low := fdRemPiOver2(x)
		if n != 0 || !math.IsNaN(high) || !math.IsNaN(low) {
			t.Fatalf("non-finite reduction: n=%d high=%v low=%v", n, high, low)
		}
	}
	// The exact binary64 value nearest pi/2, represented as three 24-bit
	// limbs. This is a valid input to the large kernel even though the public
	// dispatcher normally selects its faster small-argument path. It exercises
	// cancellation and recomputation at a nearly exact multiple of pi/2.
	// The expected leading residual was independently rounded from 110-digit
	// Decimal pi. The tail compensates its rounding error without overlapping
	// the leading value; the kernel does not promise a correctly rounded tail.
	n, high, low := fdRemPiOver2Large([]float64{13176794, 10625384, 12582912}, -23)
	if n != 1 || math.Float64bits(high) != 0xbc91a62633145c07 || low <= 0 || low > (math.Nextafter(high, math.Inf(1))-high)/2 {
		t.Fatalf("pi/2 reduction: n=%d high=%016x low=%016x", n, math.Float64bits(high), math.Float64bits(low))
	}
	// Retaining all 72 input bits makes cancellation require additional 2/pi
	// limbs and eliminates a leading zero chunk from the final remainder.
	n, high, low = fdRemPiOver2Large([]float64{13176794, 10625384, 12727492}, -23)
	if n != 1 || math.Float64bits(high) != 0xbb78cc51701b839a || low >= 0 || -low > (math.Nextafter(high, math.Inf(1))-high)/2 {
		t.Fatalf("72-bit pi/2 reduction: n=%d high=%016x low=%016x", n, math.Float64bits(high), math.Float64bits(low))
	}
}

func TestMathKernelSpecialCases(t *testing.T) {
	// The reciprocal tangent kernel explicitly defines the zero remainder,
	// although no finite binary64 input equals an odd multiple of real pi/2.
	for _, x := range []float64{0, math.Copysign(0, -1)} {
		if got := fdKernelTan(x, 0, -1); !math.IsInf(got, 1) {
			t.Fatalf("reciprocal tangent(%v) = %v", x, got)
		}
	}
	// jsMathPow handles these before the portable kernel. Test the kernel's
	// own special-value contract too, independently of that public shortcut.
	for _, x := range []float64{1, -1} {
		for _, y := range []float64{math.Inf(1), math.Inf(-1)} {
			if got := fdPow(x, y); !math.IsNaN(got) {
				t.Fatalf("fdPow(%v, %v) = %v", x, y, got)
			}
		}
	}
}
