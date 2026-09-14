// Adapted from Node.js v24.18.0 deps/v8/src/base/ieee754.cc (fdlibm).
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunSoft, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved.
// Original code modified significantly by Google Inc.
// Copyright 2016 the V8 project authors. All rights reserved.
// See THIRD_PARTY_NOTICES.md for the V8 BSD license and source provenance.
package dicecore

import "math"

func fdExp(x float64) float64 {
	const (
		ln2hi  float64 = 6.93147180369123816490e-01
		ln2lo  float64 = 1.90821492927058770002e-10
		invln2 float64 = 1.44269504088896338700e+00
		p1     float64 = 1.66666666666666019037e-01
		p2     float64 = -2.77777777770155933842e-03
		p3     float64 = 6.61375632143793436117e-05
		p4     float64 = -1.65339022054652515390e-06
		p5     float64 = 4.13813679705723846039e-08
	)
	hx := uint32(fdHigh(x))
	xsb := int(hx >> 31)
	hx &= 0x7fffffff
	if hx >= 0x40862e42 {
		if math.IsNaN(x) {
			return x + x
		}
		if x > 7.09782712893383973096e+02 {
			return math.Inf(1)
		}
		if x < -7.45133219101941108420e+02 {
			return 0
		}
	}
	k := 0
	hi, lo := float64(0), float64(0)
	if hx > 0x3fd62e42 {
		if hx < 0x3ff0a2b2 {
			if x == 1 {
				return 2.718281828459045
			}
			sign := float64(1 - 2*xsb)
			hi = x - sign*ln2hi
			lo = sign * ln2lo
			k = 1 - 2*xsb
		} else {
			k = int(invln2*x + float64(1-2*xsb)*0.5)
			t := float64(k)
			hi = x - t*ln2hi
			lo = t * ln2lo
		}
		x = hi - lo
	} else if hx < 0x3e300000 {
		return 1 + x
	}
	t := x * x
	var twopk float64
	if k >= -1021 {
		twopk = fdWithHigh(0, int32(uint32(0x3ff00000)+uint32(k)<<20))
	} else {
		twopk = fdWithHigh(0, int32(uint32(0x3ff00000)+uint32(k+1000)<<20))
	}
	c := x - t*(p1+t*(p2+t*(p3+t*(p4+t*p5))))
	if k == 0 {
		return 1 - ((x*c)/(c-2) - x)
	}
	y := 1 - ((lo - (x*c)/(2-c)) - hi)
	if k >= -1021 {
		if k == 1024 {
			return y * 2 * 0x1p1023
		}
		return y * twopk
	}
	return y * twopk * 0x1p-1000
}

func fdLog(x float64) float64 {
	const (
		ln2hi float64 = 6.93147180369123816490e-01
		ln2lo float64 = 1.90821492927058770002e-10
		lg1   float64 = 6.666666666666735130e-01
		lg2   float64 = 3.999999999940941908e-01
		lg3   float64 = 2.857142874366239149e-01
		lg4   float64 = 2.222219843214978396e-01
		lg5   float64 = 1.818357216161805012e-01
		lg6   float64 = 1.531383769920937332e-01
		lg7   float64 = 1.479819860511658591e-01
	)
	hx := fdHigh(x)
	k := int32(0)
	if hx < 0x00100000 {
		if x == 0 {
			return math.Inf(-1)
		}
		if hx < 0 {
			return math.NaN()
		}
		k -= 54
		x *= 0x1p54
		hx = fdHigh(x)
	}
	if hx >= 0x7ff00000 {
		return x + x
	}
	k += (hx >> 20) - 1023
	hx &= 0x000fffff
	i := (hx + 0x95f64) & 0x100000
	x = fdWithHigh(x, hx|(i^0x3ff00000))
	k += i >> 20
	f := x - 1
	if (0x000fffff & (2 + hx)) < 3 {
		if f == 0 {
			if k == 0 {
				return 0
			}
			dk := float64(k)
			return dk*ln2hi + dk*ln2lo
		}
		r := f * f * (0.5 - float64(0.33333333333333333)*f)
		if k == 0 {
			return f - r
		}
		dk := float64(k)
		return dk*ln2hi - ((r - dk*ln2lo) - f)
	}
	s := f / (2 + f)
	dk := float64(k)
	z := s * s
	i = hx - 0x6147a
	w := z * z
	j := int32(0x6b851) - hx
	t1 := w * (lg2 + w*(lg4+w*lg6))
	t2 := z * (lg1 + w*(lg3+w*(lg5+w*lg7)))
	i |= j
	r := t2 + t1
	if i > 0 {
		hfsq := 0.5 * f * f
		if k == 0 {
			return f - (hfsq - s*(hfsq+r))
		}
		return dk*ln2hi - ((hfsq - (s*(hfsq+r) + dk*ln2lo)) - f)
	}
	if k == 0 {
		return f - s*(f-r)
	}
	return dk*ln2hi - ((s*(f-r) - dk*ln2lo) - f)
}
