package dicecore

import (
	"strconv"
	"testing"
)

var randomPerformanceSink any

// Every constructor gets different seed words; the stream workload separately
// measures draws after initialization. No user-seed cache can help these paths.
func BenchmarkRandomBackend(b *testing.B) {
	b.Run("MTConstructUniqueWords", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			words := [4]uint32{uint32(i), uint32(i >> 32), 0xdeadbeef, 0xcafebabe}
			random, err := NewMersenneTwister19937FromWords(words[:], nil)
			if err != nil {
				b.Fatal(err)
			}
			_, err = random.NextUint32()
			if err != nil {
				b.Fatal(err)
			}
			randomPerformanceSink = random
		}
	})
	b.Run("MTStream", func(b *testing.B) {
		random := NewMersenneTwister19937(5489, nil)
		var total uint32
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			value, err := random.NextUint32()
			if err != nil {
				b.Fatal(err)
			}
			total ^= value
		}
		randomPerformanceSink = total
	})
	for _, prefix := range []string{"backend/request/", "backend/🎲/ação/"} {
		b.Run("SeedUnique/"+prefix, func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				seed, err := CreateProvidedSeed(prefix + strconv.Itoa(i))
				if err != nil {
					b.Fatal(err)
				}
				randomPerformanceSink = seed
			}
		})
	}
	b.Run("ReplayState", func(b *testing.B) {
		seed, _ := CreateProvidedSeed("backend/replay")
		replay, _ := CreateReplayDescriptor(seed, ReplayDescriptorOptions{})
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			state, err := CreateReplayState(replay)
			if err != nil {
				b.Fatal(err)
			}
			randomPerformanceSink = state
		}
	})
}
