package dicecore

import (
	"strconv"
	"strings"
)

// executionIDs stores a roll's immutable IDs in an append-only string buffer.
// It must never be copied, reset, or pooled: result strings own its storage.
type executionIDs struct {
	buffer strings.Builder
	prefix string
}

func (ids *executionIDs) dieID(rollIndex, index, knownCount int64) string {
	if ids.prefix == "" {
		// Small pools do not amortize a separate builder and its retained tail.
		if knownCount < 32 {
			return "roll-" + strconv.FormatInt(rollIndex, 10) + "-die-" + strconv.FormatInt(index, 10)
		}
		ids.prefix = "roll-" + strconv.FormatInt(rollIndex, 10) + "-die-"
		count := min(knownCount, 1024)
		ids.buffer.Grow(int(count) * (len(ids.prefix) + len(strconv.FormatInt(count, 10))))
	}
	start := ids.buffer.Len()
	ids.buffer.WriteString(ids.prefix)
	var digits [20]byte
	ids.buffer.Write(strconv.AppendInt(digits[:0], index, 10))
	return ids.buffer.String()[start:]
}
