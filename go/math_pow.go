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

func fdLow(x float64) uint32 { return uint32(math.Float64bits(x)) }

func fdPow(x, y float64) float64 {
	bp := [...]float64{1, 1.5}
	dph := [...]float64{0, 5.84962487220764160156e-01}
	dpl := [...]float64{0, 1.35003920212974897128e-08}
	const (
		l1     float64 = 5.99999999999994648725e-01
		l2     float64 = 4.28571428578550184252e-01
		l3     float64 = 3.33333329818377432918e-01
		l4     float64 = 2.72728123808534006489e-01
		l5     float64 = 2.30660745775561754067e-01
		l6     float64 = 2.06975017800338417784e-01
		p1     float64 = 1.66666666666666019037e-01
		p2     float64 = -2.77777777770155933842e-03
		p3     float64 = 6.61375632143793436117e-05
		p4     float64 = -1.65339022054652515390e-06
		p5     float64 = 4.13813679705723846039e-08
		lg2    float64 = 6.93147180559945286227e-01
		lg2h   float64 = 6.93147182464599609375e-01
		lg2l   float64 = -1.90465429995776804525e-09
		ovt    float64 = 8.0085662595372944372e-0017
		cp     float64 = 9.61796693925975554329e-01
		cph    float64 = 9.61796700954437255859e-01
		cpl    float64 = -7.02846165095275826516e-09
		ivln2  float64 = 1.44269504088896338700e+00
		ivln2h float64 = 1.44269502162933349609e+00
		ivln2l float64 = 1.92596299112661746887e-08
	)
	hx, hy := fdHigh(x), fdHigh(y)
	lx, ly := fdLow(x), fdLow(y)
	ix, iy := hx&0x7fffffff, hy&0x7fffffff
	if uint32(iy)|ly == 0 {
		return 1
	}
	if ix > 0x7ff00000 || ix == 0x7ff00000 && lx != 0 || iy > 0x7ff00000 || iy == 0x7ff00000 && ly != 0 {
		return x + y
	}
	yisint := int32(0)
	if hx < 0 {
		if iy >= 0x43400000 {
			yisint = 2
		} else if iy >= 0x3ff00000 {
			k := (iy >> 20) - 0x3ff
			if k > 20 {
				j := ly >> uint(52-k)
				if j<<uint(52-k) == ly {
					yisint = 2 - int32(j&1)
				}
			} else if ly == 0 {
				j := iy >> uint(20-k)
				if j<<uint(20-k) == iy {
					yisint = 2 - (j & 1)
				}
			}
		}
	}
	if ly == 0 {
		if iy == 0x7ff00000 {
			if uint32(ix-0x3ff00000)|lx == 0 {
				return y - y
			} else if ix >= 0x3ff00000 {
				if hy >= 0 {
					return y
				}
				return 0
			} else {
				if hy < 0 {
					return -y
				}
				return 0
			}
		}
		if iy == 0x3ff00000 {
			if hy < 0 {
				return 1 / x
			}
			return x
		}
		if hy == 0x40000000 {
			return x * x
		}
		if hy == 0x3fe00000 && hx >= 0 {
			return math.Sqrt(x)
		}
	}
	ax := math.Abs(x)
	if lx == 0 && (ix == 0x7ff00000 || ix == 0 || ix == 0x3ff00000) {
		z := ax
		if hy < 0 {
			z = 1 / z
		}
		if hx < 0 {
			if (ix-0x3ff00000)|yisint == 0 {
				z = math.NaN()
			} else if yisint == 1 {
				z = -z
			}
		}
		return z
	}
	n := (hx >> 31) + 1
	if n|yisint == 0 {
		return math.NaN()
	}
	s := float64(1)
	if n|(yisint-1) == 0 {
		s = -1
	}
	var t1, t2 float64
	if iy > 0x41e00000 {
		if iy > 0x43f00000 {
			if ix <= 0x3fefffff {
				if hy < 0 {
					return math.Inf(1)
				}
				return 0
			}
			if ix >= 0x3ff00000 {
				if hy > 0 {
					return math.Inf(1)
				}
				return 0
			}
		}
		if ix < 0x3fefffff {
			if hy < 0 {
				return math.Copysign(math.Inf(1), s)
			}
			return math.Copysign(0, s)
		}
		if ix > 0x3ff00000 {
			if hy > 0 {
				return math.Copysign(math.Inf(1), s)
			}
			return math.Copysign(0, s)
		}
		t := ax - 1
		w := (t * t) * (0.5 - t*(float64(0.3333333333333333333333)-t*0.25))
		u := ivln2h * t
		v := t*ivln2l - w*ivln2
		t1 = fdClearLow(u + v)
		t2 = v - (t1 - u)
	} else {
		n = 0
		if ix < 0x00100000 {
			ax *= 0x1p53
			n -= 53
			ix = fdHigh(ax)
		}
		n += (ix >> 20) - 0x3ff
		j := ix & 0x000fffff
		ix = j | 0x3ff00000
		k := int32(0)
		if j <= 0x3988e {
			k = 0
		} else if j < 0xbb67a {
			k = 1
		} else {
			k = 0
			n++
			ix -= 0x00100000
		}
		ax = fdWithHigh(ax, ix)
		u := ax - bp[k]
		v := 1 / (ax + bp[k])
		ss := u * v
		sh := fdClearLow(ss)
		th := fdWithHigh(0, ((ix>>1)|0x20000000)+0x00080000+(k<<18))
		tl := ax - (th - bp[k])
		sl := v * ((u - sh*th) - sh*tl)
		s2 := ss * ss
		r := s2 * s2 * (l1 + s2*(l2+s2*(l3+s2*(l4+s2*(l5+s2*l6)))))
		r += sl * (sh + ss)
		s2 = sh * sh
		th = fdClearLow(3 + s2 + r)
		tl = r - ((th - 3) - s2)
		u = sh * th
		v = sl*th + tl*ss
		ph := fdClearLow(u + v)
		pl := v - (ph - u)
		zh := cph * ph
		zl := cpl*ph + pl*cp + dpl[k]
		t := float64(n)
		t1 = fdClearLow(((zh + zl) + dph[k]) + t)
		t2 = zl - (((t1 - t) - dph[k]) - zh)
	}
	y1 := fdClearLow(y)
	pl := (y-y1)*t1 + y*t2
	ph := y1 * t1
	z := pl + ph
	j := fdHigh(z)
	i := fdLow(z)
	if j >= 0x40900000 {
		if uint32(j-0x40900000)|i != 0 || pl+ovt > z-ph {
			return math.Copysign(math.Inf(1), s)
		}
	} else if j&0x7fffffff >= 0x4090cc00 {
		if uint32(j) != 0xc090cc00 || i != 0 || pl <= z-ph {
			return math.Copysign(0, s)
		}
	}
	ix = j & 0x7fffffff
	k := (ix >> 20) - 0x3ff
	n = 0
	if ix > 0x3fe00000 {
		n = j + (0x00100000 >> uint(k+1))
		k = ((n & 0x7fffffff) >> 20) - 0x3ff
		t := fdWithHigh(0, n & ^(0x000fffff>>uint(k)))
		n = ((n & 0x000fffff) | 0x00100000) >> uint(20-k)
		if j < 0 {
			n = -n
		}
		ph -= t
	}
	t := fdClearLow(pl + ph)
	u := t * lg2h
	v := (pl-(t-ph))*lg2 + t*lg2l
	z = u + v
	w := v - (z - u)
	t = z * z
	t1 = z - t*(p1+t*(p2+t*(p3+t*(p4+t*p5))))
	r := (z * t1) / ((t1 - 2) - (w + z*w))
	z = 1 - (r - z)
	j = fdHigh(z) + int32(uint32(n)<<20)
	if j>>20 <= 0 {
		z = math.Ldexp(z, int(n))
	} else {
		z = fdWithHigh(z, fdHigh(z)+int32(uint32(n)<<20))
	}
	return s * z
}
