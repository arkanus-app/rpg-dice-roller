package dicecore

import "testing"

// Preserve the original recurrence as a differential reference for the faster
// array initializer and twist. Inputs include seed lengths on both sides of the
// state boundary, and comparisons cross several successive twist boundaries.
func originalMTArrayState(words []uint32) [624]uint32 {
	state := NewMersenneTwister19937(19650218, nil).state
	i, j := 1, 0
	for remaining := max(624, len(words)); remaining > 0; remaining-- {
		previous := state[i-1]
		state[i] = (state[i] ^ ((previous ^ (previous >> 30)) * 1664525)) + words[j] + uint32(j)
		i++
		j++
		if i >= 624 {
			state[0] = state[623]
			i = 1
		}
		if j >= len(words) {
			j = 0
		}
	}
	for remaining := 623; remaining > 0; remaining-- {
		previous := state[i-1]
		state[i] = (state[i] ^ ((previous ^ (previous >> 30)) * 1566083941)) - uint32(i)
		i++
		if i >= 624 {
			state[0] = state[623]
			i = 1
		}
	}
	state[0] = 0x80000000
	return state
}

func originalMTTwist(state *[624]uint32) {
	for i := range state {
		bits := (state[i] & 0x80000000) | (state[(i+1)%624] & 0x7fffffff)
		oddMask := uint32(0)
		if bits&1 != 0 {
			oddMask = 0x9908b0df
		}
		state[i] = state[(i+397)%624] ^ (bits >> 1) ^ oddMask
	}
}

func TestMTOptimizationPreservesArrayState(t *testing.T) {
	for _, length := range []int{1, 2, 4, 623, 624, 625, 1297} {
		for sequence := range 12 {
			words := make([]uint32, length)
			for i := range words {
				words[i] = uint32(i+sequence*13) * 0x9e3779b9
			}
			want := originalMTArrayState(words)
			budget := &testRandomBudget{limit: 6240}
			actual, err := NewMersenneTwister19937FromWords(words, budget)
			if err != nil || actual.state != want || actual.index != 624 || budget.calls != 0 {
				t.Fatalf("length %d sequence %d: initializer changed state or consumed a draw", length, sequence)
			}
			for cycle := range 10 {
				originalMTTwist(&want)
				for index := range want {
					value := want[index]
					value ^= value >> 11
					value ^= (value << 7) & 0x9d2c5680
					value ^= (value << 15) & 0xefc60000
					value ^= value >> 18
					got, err := actual.NextUint32()
					if err != nil || got != value {
						t.Fatalf("length %d sequence %d cycle %d draw %d: got %d, want %d: %v", length, sequence, cycle, index, got, value, err)
					}
				}
				if actual.state != want || budget.calls != int64((cycle+1)*624) {
					t.Fatal("twist state or draw accounting changed")
				}
			}
		}
	}
}
