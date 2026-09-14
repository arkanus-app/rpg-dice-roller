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
