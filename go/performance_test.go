package dicecore

import (
	"fmt"
	"testing"
)

var performanceSink any

// BenchmarkBackendOperation profiles the public API with both reused and
// changing seeds. All setup is outside timing; returned results escape as they
// do when passed to a backend consumer.
func BenchmarkBackendOperation(b *testing.B) {
	for _, notation := range []string{"1d20+5", "100d6", "20d6!2ro=1kh10"} {
		for _, mode := range []string{"full", "details", "summary"} {
			for _, changing := range []bool{false, true} {
				name := fmt.Sprintf("%s/%s/changing=%t", notation, mode, changing)
				b.Run(name, func(b *testing.B) {
					engine, err := CreateDiceEngine()
					if err != nil {
						b.Fatal(err)
					}
					if _, err = engine.Compile(notation); err != nil {
						b.Fatal(err)
					}
					seeds := make([]RollOptions, 128)
					for i := range seeds {
						seeds[i].Seed = fmt.Sprintf("backend-profile/%d", i)
					}
					b.ReportAllocs()
					b.ResetTimer()
					for i := 0; i < b.N; i++ {
						index := 0
						if changing {
							index = i % len(seeds)
						}
						switch mode {
						case "full":
							performanceSink, err = engine.Roll(notation, seeds[index])
						case "details":
							performanceSink, err = engine.RollDetails(notation, seeds[index])
						case "summary":
							performanceSink, err = engine.RollSummary(notation, seeds[index])
						}
						if err != nil {
							b.Fatal(err)
						}
					}
				})
			}
		}
	}
}
