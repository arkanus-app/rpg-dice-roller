package dicecore

import (
	"fmt"
	"testing"
)

// This diagnostic isolates selection and its bookkeeping. Resetting the same
// mutable dice and counters is included in both sides; RNG and JSON are absent.
// States already contain "dropped", so allocations expose ranking buffers rather
// than repeated state-string storage. Public API benchmarks remain the main gate.
func BenchmarkWorkingDieSelection(b *testing.B) {
	for _, count := range []int{20, 32, 33, 100, 1000} {
		for _, stride := range []int{1, 16} {
			for _, implementation := range []struct {
				name  string
				apply func([]*workingDie, *ModifierNode, *rollState)
			}{{"reference", referenceWorkingDieSelection}, {"current", applyDieSelection}} {
				b.Run(fmt.Sprintf("n%d/stride%d/%s", count, stride, implementation.name), func(b *testing.B) {
					dice := selectionTestDice(count, stride, "fractional", false)
					active := 0
					for _, die := range dice {
						die.States = []string{"dropped"}
						if die.active {
							active++
						}
					}
					modifier := &ModifierNode{Kind: "keep", Selection: "highest", Quantity: float64(active / 2)}
					state := selectionTestState(DefaultDiceLimits(), false)
					b.ReportAllocs()
					for b.Loop() {
						for _, die := range dice {
							die.Included = die.active
							die.Contribution = die.Value
						}
						state.context.Budget.snapshot = ExecutionBudgetSnapshot{}
						state.context.Journal.eventCount = 0
						implementation.apply(dice, modifier, state)
					}
					performanceSink = state
				})
			}
		}
	}
}
