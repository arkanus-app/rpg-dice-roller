package dicecore

import (
	"strconv"
	"testing"
)

func TestExecutionIDsRemainStableAcrossGrowth(t *testing.T) {
	for _, count := range []int64{-1, 1, 20, 100, 1 << 30} {
		var ids executionIDs
		values := make([]string, 2500)
		for i := range values {
			values[i] = ids.dieID(7, int64(i+1), count)
		}
		for i, value := range values {
			want := "roll-7-die-" + strconv.Itoa(i+1)
			if value != want {
				t.Fatalf("reservation %d, id %d: got %q, want %q", count, i, value, want)
			}
		}
		var next executionIDs
		if next.dieID(8, 1, 1) != "roll-8-die-1" || values[0] != "roll-7-die-1" {
			t.Fatal("a later roll changed retained IDs")
		}
	}
}
