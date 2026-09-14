package dicecore

import (
	"encoding/json"
	"testing"
)

var eventEncodingSink []byte

func BenchmarkResolvedEventsJSON(b *testing.B) {
	for _, input := range []string{"1d20+5", "100d6", "20d6!2ro=1kh10"} {
		b.Run(input, func(b *testing.B) {
			engine, _ := CreateDiceEngine()
			result, err := engine.Roll(input, RollOptions{Seed: "event-json-throughput"})
			if err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for index := 0; index < b.N; index++ {
				eventEncodingSink, err = json.Marshal(result)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
