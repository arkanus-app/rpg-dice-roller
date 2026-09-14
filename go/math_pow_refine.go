package dicecore

import (
	"math"
	"math/big"
)

const powRefinePrecision uint = 320

// This constant has more digits than the working precision. Receivers below
// never alias it, so simultaneous rolls may safely use the same value.
var powRefineLn2, _ = new(big.Float).SetPrec(powRefinePrecision).SetString(
	"0.693147180559945309417232121458176568075500134360255254120680009493393621969694715605863326996418687542001481020570685733685520235758130557")

func powRefineFloat() *big.Float { return new(big.Float).SetPrec(powRefinePrecision) }

// refinePowIntegerBoundary resolves the one-ulp ambiguity of the fdlibm
// approximation where decimal12-v1's safe-integer shortcut makes it observable.
// The reference Windows runtime rounds these powers to the nearest binary64.
// Most powers remain on the ordinary fdlibm path.
func refinePowIntegerBoundary(x, y, approximation float64) float64 {
	a := math.Abs(approximation)
	if a < 1 || a > 0x1p53 || math.IsNaN(a) {
		return approximation
	}
	ulp := math.Nextafter(a, math.Inf(1)) - a
	if math.Abs(a-math.Round(a)) > 2*ulp {
		return approximation
	}
	// These operations are exact or already correctly rounded by binary64
	// arithmetic. Keeping them also preserves their specified special cases.
	if y == 0 || y == 1 || y == 2 || math.Abs(x) == 1 {
		return approximation
	}
	logarithm := precisePowLog(math.Abs(x))
	exponent := powRefineFloat().Mul(logarithm, powRefineFloat().SetFloat64(y))
	result := precisePowExp(exponent)
	return math.Copysign(result, approximation)
}

func precisePowLog(x float64) *big.Float {
	m := powRefineFloat().SetFloat64(x)
	e := m.MantExp(m)
	if xmantissa, _ := m.Float64(); xmantissa < math.Sqrt(0.5) {
		m.SetMantExp(m, 1)
		e--
	}
	one := powRefineFloat().SetInt64(1)
	z := powRefineFloat().Quo(powRefineFloat().Sub(m, one), powRefineFloat().Add(m, one))
	z2 := powRefineFloat().Mul(z, z)
	power := powRefineFloat().Set(z)
	sum := powRefineFloat().Set(z)
	term, denominator := powRefineFloat(), powRefineFloat()
	// |z| <= 0.171573: the omitted tail is below 2^-650, comfortably
	// smaller than the 320-bit working precision even after multiplying y.
	for k := int64(3); k <= 257; k += 2 {
		power.Mul(power, z2)
		term.Quo(power, denominator.SetInt64(k))
		sum.Add(sum, term)
	}
	sum.SetMantExp(sum, 1)
	return sum.Add(sum, term.Mul(powRefineLn2, denominator.SetInt64(int64(e))))
}

func precisePowExp(x *big.Float) float64 {
	quotient, _ := powRefineFloat().Quo(x, powRefineLn2).Float64()
	n := int64(math.Round(quotient))
	r := powRefineFloat().Sub(x, powRefineFloat().Mul(powRefineLn2, powRefineFloat().SetInt64(n)))
	term := powRefineFloat().SetInt64(1)
	sum := powRefineFloat().SetInt64(1)
	denominator := powRefineFloat()
	// |r| <= ln(2)/2: the omitted tail is below 2^-650.
	for k := int64(1); k <= 112; k++ {
		term.Mul(term, r)
		term.Quo(term, denominator.SetInt64(k))
		sum.Add(sum, term)
	}
	sum.SetMantExp(sum, int(n))
	result, _ := sum.Float64()
	return result
}
