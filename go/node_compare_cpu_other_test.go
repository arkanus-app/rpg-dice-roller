//go:build !windows && !linux

package dicecore

import "time"

func nodeCompareClockSetup() (nodeCompareClockInfo, error) {
	return nodeCompareClockInfo{Source: "time.Now/time.Since monotonic"}, nil
}

type nodeCompareClock struct{}

func (*nodeCompareClock) now() time.Time { return time.Now() }

func (*nodeCompareClock) elapsed(started time.Time) int64 { return time.Since(started).Nanoseconds() }

func nodeCompareCPU() nodeCompareCPUReading {
	return nodeCompareCPUReading{Reason: "Process CPU measurement is implemented for Windows and Linux"}
}
