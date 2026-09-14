package dicecore

import "testing"

func BenchmarkEventNumber(b *testing.B) {
	for _, item := range []struct {
		name  string
		value float64
	}{{"integer", 6}, {"fraction", 1.25}, {"large", 1e21}} {
		b.Run(item.name, func(b *testing.B) {
			output := eventJSON{data: make([]byte, 1, 64)}
			for b.Loop() {
				output.data = output.data[:1]
				output.number("value", item.value)
			}
			eventEncodingSink = output.data
		})
	}
}

func BenchmarkEventEnvelope(b *testing.B) {
	for _, kind := range []string{"roll", "include", "transform"} {
		b.Run(kind, func(b *testing.B) {
			event := ResolvedEvent{Sequence: 123, RollIndex: 1, Type: kind, Subject: "die", SourceNodeID: "node-1",
				DieID: "roll-1:die-20", Value: 6, Contribution: 6, Details: &ResolvedEventDetails{From: 1, To: 6, Reason: "minimum"}}
			buffer := make([]byte, 0, 256)
			var err error
			b.ReportAllocs()
			for b.Loop() {
				buffer, err = event.appendJSON(buffer[:0])
				if err != nil {
					b.Fatal(err)
				}
			}
			eventEncodingSink = buffer
		})
	}
}
