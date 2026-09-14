package dicecore

import "testing"

func BenchmarkEngineOverhead(b *testing.B) {
	b.Run("compile-hot", func(b *testing.B) {
		engine, _ := CreateDiceEngine()
		_, _ = engine.Compile("2#4d6kh3+1d8")
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			var err error
			performanceSink, err = engine.Compile("2#4d6kh3+1d8")
			if err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("round-integer", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			value, err := RoundResult(float64(1 + i%600))
			if err != nil || value < 1 {
				b.Fatal(value, err)
			}
		}
	})
}
