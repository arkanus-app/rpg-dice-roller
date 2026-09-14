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

func fdHigh(x float64) int32 { return int32(math.Float64bits(x) >> 32) }
func fdWithHigh(x float64, high int32) float64 {
	return math.Float64frombits(uint64(uint32(high))<<32 | math.Float64bits(x)&0xffffffff)
}
func fdClearLow(x float64) float64 {
	return math.Float64frombits(math.Float64bits(x) & 0xffffffff00000000)
}

var fdTwoOverPi = [...]int32{
	0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C,
	0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A, 0x424DD2, 0xE00649,
	0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44,
	0x84E99C, 0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C, 0x845F8B,
	0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D,
	0x367ECF, 0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5,
	0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330,
	0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3, 0x91615E, 0xE61B08,
	0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA,
	0x73A8C9, 0x60E27B, 0xC08C6B,
}

var fdNPiOver2High = [...]int32{
	0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C,
	0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
	0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
	0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
	0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
	0x404858EB, 0x404921FB,
}

func fdRemPiOver2(x float64) (int, float64, float64) {
	const (
		invpio2 float64 = 6.36619772367581382433e-01
		pio2_1  float64 = 1.57079632673412561417e+00
		pio2_1t float64 = 6.07710050650619224932e-11
		pio2_2  float64 = 6.07710050630396597660e-11
		pio2_2t float64 = 2.02226624879595063154e-21
		pio2_3  float64 = 2.02226624871116645580e-21
		pio2_3t float64 = 8.47842766036889956997e-32
	)
	hx := fdHigh(x)
	ix := hx & 0x7fffffff
	if ix <= 0x3fe921fb {
		return 0, x, 0
	}
	if ix < 0x4002d97c {
		if hx > 0 {
			z := x - pio2_1
			if ix != 0x3ff921fb {
				y := z - pio2_1t
				return 1, y, (z - y) - pio2_1t
			}
			z -= pio2_2
			y := z - pio2_2t
			return 1, y, (z - y) - pio2_2t
		}
		z := x + pio2_1
		if ix != 0x3ff921fb {
			y := z + pio2_1t
			return -1, y, (z - y) + pio2_1t
		}
		z += pio2_2
		y := z + pio2_2t
		return -1, y, (z - y) + pio2_2t
	}
	if ix <= 0x413921fb {
		t := math.Abs(x)
		n := int(t*invpio2 + 0.5)
		fn := float64(n)
		r := t - fn*pio2_1
		w := fn * pio2_1t
		y0 := r - w
		if n >= 32 || ix == fdNPiOver2High[n-1] {
			j := ix >> 20
			i := j - ((fdHigh(y0) >> 20) & 0x7ff)
			if i > 16 {
				t = r
				w = fn * pio2_2
				r = t - w
				w = fn*pio2_2t - ((t - r) - w)
				y0 = r - w
				i = j - ((fdHigh(y0) >> 20) & 0x7ff)
				if i > 49 {
					t = r
					w = fn * pio2_3
					r = t - w
					w = fn*pio2_3t - ((t - r) - w)
					y0 = r - w
				}
			}
		}
		y1 := (r - y0) - w
		if hx < 0 {
			return -n, -y0, -y1
		}
		return n, y0, y1
	}
	if ix >= 0x7ff00000 {
		return 0, x - x, x - x
	}
	e0 := int(ix>>20) - 1046
	z := fdWithHigh(x, ix-int32(uint32(e0)<<20))
	var tx [3]float64
	for i := 0; i < 2; i++ {
		tx[i] = float64(int32(z))
		z = (z - tx[i]) * 0x1p24
	}
	tx[2] = z
	nx := 3
	for tx[nx-1] == 0 {
		nx--
	}
	n, y0, y1 := fdRemPiOver2Large(tx[:nx], e0)
	if hx < 0 {
		return -n, -y0, -y1
	}
	return n, y0, y1
}

// fdRemPiOver2Large specializes the reference kernel to its binary64 caller's
// precision (prec=2), retaining the 24-bit Payne-Hanek argument reduction.
func fdRemPiOver2Large(x []float64, e0 int) (int, float64, float64) {
	pi := [...]float64{1.57079625129699707031e+00, 7.54978941586159635335e-08,
		5.39030252995776476554e-15, 3.28200341580791294123e-22, 1.27065575308067607349e-29,
		1.22933308981111328932e-36, 2.73370053816464559624e-44, 2.16741683877804819444e-51}
	const jk = 4
	jx := len(x) - 1
	jv := (e0 - 3) / 24
	if jv < 0 {
		jv = 0
	}
	q0 := e0 - 24*(jv+1)
	var f, fq, q [20]float64
	var iq [20]int
	j := jv - jx
	for i := 0; i <= jx+jk; i++ {
		if j >= 0 {
			f[i] = float64(fdTwoOverPi[j])
		}
		j++
	}
	for i := 0; i <= jk; i++ {
		for j := 0; j <= jx; j++ {
			q[i] += x[j] * f[jx+i-j]
		}
	}
	jz := jk
	n, ih := 0, 0
	z := float64(0)
	for {
		z = q[jz]
		for i, j := 0, jz; j > 0; i, j = i+1, j-1 {
			fw := float64(int32(0x1p-24 * z))
			iq[i] = int(z - 0x1p24*fw)
			z = q[j-1] + fw
		}
		z = math.Ldexp(z, q0)
		z -= 8 * math.Floor(z*0.125)
		n = int(z)
		z -= float64(n)
		ih = 0
		if q0 > 0 {
			i := iq[jz-1] >> (24 - q0)
			n += i
			iq[jz-1] -= i << (24 - q0)
			ih = iq[jz-1] >> (23 - q0)
		} else if q0 == 0 {
			ih = iq[jz-1] >> 23
		} else if z >= 0.5 {
			ih = 2
		}
		if ih > 0 {
			n++
			carry := 0
			for i := 0; i < jz; i++ {
				j := iq[i]
				if carry == 0 {
					if j != 0 {
						carry = 1
						iq[i] = 0x1000000 - j
					}
				} else {
					iq[i] = 0xffffff - j
				}
			}
			if q0 > 0 {
				iq[jz-1] &= (1 << (24 - q0)) - 1
			}
			if ih == 2 {
				z = 1 - z
				if carry != 0 {
					z -= math.Ldexp(1, q0)
				}
			}
		}
		if z == 0 {
			j := 0
			for i := jz - 1; i >= jk; i-- {
				j |= iq[i]
			}
			if j == 0 {
				k := 1
				for jk >= k && iq[jk-k] == 0 {
					k++
				}
				for i := jz + 1; i <= jz+k; i++ {
					f[jx+i] = float64(fdTwoOverPi[jv+i])
					fw := float64(0)
					for j := 0; j <= jx; j++ {
						fw += x[j] * f[jx+i-j]
					}
					q[i] = fw
				}
				jz += k
				continue
			}
		}
		break
	}
	if z == 0 {
		jz--
		q0 -= 24
		for iq[jz] == 0 {
			jz--
			q0 -= 24
		}
	} else {
		z = math.Ldexp(z, -q0)
		if z >= 0x1p24 {
			fw := float64(int32(0x1p-24 * z))
			iq[jz] = int(z - 0x1p24*fw)
			jz++
			q0 += 24
			iq[jz] = int(fw)
		} else {
			iq[jz] = int(z)
		}
	}
	fw := math.Ldexp(1, q0)
	for i := jz; i >= 0; i-- {
		q[i] = fw * float64(iq[i])
		fw *= 0x1p-24
	}
	for i := jz; i >= 0; i-- {
		fw = 0
		for k := 0; k <= jk && k <= jz-i; k++ {
			fw += pi[k] * q[i+k]
		}
		fq[jz-i] = fw
	}
	fw = 0
	for i := jz; i >= 0; i-- {
		fw += fq[i]
	}
	y0 := fw
	fw = fq[0] - fw
	for i := 1; i <= jz; i++ {
		fw += fq[i]
	}
	y1 := fw
	if ih != 0 {
		y0 = -y0
		y1 = -y1
	}
	return n & 7, y0, y1
}

func fdKernelSin(x, y float64, tail bool) float64 {
	const (
		s1 float64 = -1.66666666666666324348e-01
		s2 float64 = 8.33333333332248946124e-03
		s3 float64 = -1.98412698298579493134e-04
		s4 float64 = 2.75573137070700676789e-06
		s5 float64 = -2.50507602534068634195e-08
		s6 float64 = 1.58969099521155010221e-10
	)
	if fdHigh(x)&0x7fffffff < 0x3e400000 {
		return x
	}
	z := x * x
	v := z * x
	r := s2 + z*(s3+z*(s4+z*(s5+z*s6)))
	if !tail {
		return x + v*(s1+z*r)
	}
	return x - ((z*(0.5*y-v*r) - y) - v*s1)
}

func fdKernelCos(x, y float64) float64 {
	const (
		c1 float64 = 4.16666666666666019037e-02
		c2 float64 = -1.38888888888741095749e-03
		c3 float64 = 2.48015872894767294178e-05
		c4 float64 = -2.75573143513906633035e-07
		c5 float64 = 2.08757232129817482790e-09
		c6 float64 = -1.13596475577881948265e-11
	)
	ix := fdHigh(x) & 0x7fffffff
	if ix < 0x3e400000 {
		return 1
	}
	z := x * x
	r := z * (c1 + z*(c2+z*(c3+z*(c4+z*(c5+z*c6)))))
	if ix < 0x3fd33333 {
		return 1 - (0.5*z - (z*r - x*y))
	}
	qx := float64(0.28125)
	if ix <= 0x3fe90000 {
		qx = fdWithHigh(0, ix-0x00200000)
	}
	iz := 0.5*z - qx
	a := 1 - qx
	return a - (iz - (z*r - x*y))
}

func fdKernelTan(x, y float64, iy int) float64 {
	t := [...]float64{3.33333333333334091986e-01, 1.33333333333201242699e-01,
		5.39682539762260521377e-02, 2.18694882948595424599e-02, 8.86323982359930005737e-03,
		3.59207910759131235356e-03, 1.45620945432529025516e-03, 5.88041240820264096874e-04,
		2.46463134818469906812e-04, 7.81794442939557092300e-05, 7.14072491382608190305e-05,
		-1.85586374855275456654e-05, 2.59073051863633712884e-05}
	hx := fdHigh(x)
	ix := hx & 0x7fffffff
	if ix < 0x3e300000 {
		if x == 0 && iy == -1 {
			return math.Inf(1)
		}
		if iy == 1 {
			return x
		}
		w := x + y
		z := fdClearLow(w)
		v := y - (z - x)
		a := -1 / w
		tr := fdClearLow(a)
		s := 1 + tr*z
		return tr + a*(s+tr*v)
	}
	if ix >= 0x3fe59428 {
		if hx < 0 {
			x = -x
			y = -y
		}
		z := float64(7.85398163397448278999e-01) - x
		w := float64(3.06161699786838301793e-17) - y
		x = z + w
		y = 0
	}
	z := x * x
	w := z * z
	r := t[1] + w*(t[3]+w*(t[5]+w*(t[7]+w*(t[9]+w*t[11]))))
	v := z * (t[2] + w*(t[4]+w*(t[6]+w*(t[8]+w*(t[10]+w*t[12])))))
	s := z * x
	r = y + z*(s*(r+v)+y)
	r += t[0] * s
	w = x + r
	if ix >= 0x3fe59428 {
		v = float64(iy)
		return float64(1-((hx>>30)&2)) * (v - 2*(x-(w*w/(w+v)-r)))
	}
	if iy == 1 {
		return w
	}
	z = fdClearLow(w)
	v = r - (z - x)
	a := -1 / w
	tr := fdClearLow(a)
	s = 1 + tr*z
	return tr + a*(s+tr*v)
}

func fdSin(x float64) float64 {
	ix := fdHigh(x) & 0x7fffffff
	if ix <= 0x3fe921fb {
		return fdKernelSin(x, 0, false)
	}
	if ix >= 0x7ff00000 {
		return x - x
	}
	n, y0, y1 := fdRemPiOver2(x)
	switch n & 3 {
	case 0:
		return fdKernelSin(y0, y1, true)
	case 1:
		return fdKernelCos(y0, y1)
	case 2:
		return -fdKernelSin(y0, y1, true)
	default:
		return -fdKernelCos(y0, y1)
	}
}

func fdCos(x float64) float64 {
	ix := fdHigh(x) & 0x7fffffff
	if ix <= 0x3fe921fb {
		return fdKernelCos(x, 0)
	}
	if ix >= 0x7ff00000 {
		return x - x
	}
	n, y0, y1 := fdRemPiOver2(x)
	switch n & 3 {
	case 0:
		return fdKernelCos(y0, y1)
	case 1:
		return -fdKernelSin(y0, y1, true)
	case 2:
		return -fdKernelCos(y0, y1)
	default:
		return fdKernelSin(y0, y1, true)
	}
}

func fdTan(x float64) float64 {
	ix := fdHigh(x) & 0x7fffffff
	if ix <= 0x3fe921fb {
		return fdKernelTan(x, 0, 1)
	}
	if ix >= 0x7ff00000 {
		return x - x
	}
	n, y0, y1 := fdRemPiOver2(x)
	return fdKernelTan(y0, y1, 1-((n&1)<<1))
}
