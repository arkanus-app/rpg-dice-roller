package dicecore

import "testing"

func BenchmarkSystemProjection(b *testing.B) {
	for _, kind := range []string{"fate", "vampire-v5"} {
		for _, mode := range []string{"full", "compact"} {
			b.Run(kind+"/"+mode, func(b *testing.B) {
				var input any = map[string]any{"dice": float64(20)}
				if kind == "vampire-v5" {
					input = map[string]any{"pool": float64(10), "hunger": float64(3), "difficulty": float64(4)}
				}
				run, err := comparisonOperation(comparisonWorkload{Kind: kind, Mode: mode, Input: input, Cache: true, Seeds: []string{"system-benchmark"}, Algorithm: MT19937})
				if err != nil {
					b.Fatal(err)
				}
				for i := 0; i < 4; i++ {
					if _, err = run(i); err != nil {
						b.Fatal(err)
					}
				}
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					performanceSink, err = run(i)
					if err != nil {
						b.Fatal(err)
					}
				}
			})
		}
	}
}
