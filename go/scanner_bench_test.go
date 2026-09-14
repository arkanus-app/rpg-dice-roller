package dicecore

import (
	"runtime"
	"strings"
	"testing"
)

func BenchmarkUTF16Length(b *testing.B) {
	for _, item := range []struct{ name, input string }{
		{"ascii-short", "1d20+5"},
		{"ascii-long", strings.Repeat("1d6+", 1024)},
		{"unicode-mixed", strings.Repeat("ação🎲\x00", 128)},
	} {
		b.Run(item.name, func(b *testing.B) {
			b.Run("conversion", func(b *testing.B) {
				b.ReportAllocs()
				length := 0
				for b.Loop() {
					length = len(syntaxUnits(item.input))
				}
				runtime.KeepAlive(length)
			})
			b.Run("count", func(b *testing.B) {
				b.ReportAllocs()
				length := 0
				for b.Loop() {
					length = syntaxLength(item.input)
				}
				runtime.KeepAlive(length)
			})
		})
	}
}
