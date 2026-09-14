package dicecore

import (
	"syscall"
	"time"
)

func nodeCompareClockSetup() (nodeCompareClockInfo, error) {
	return nodeCompareClockInfo{Source: "time.Now/time.Since monotonic"}, nil
}

type nodeCompareClock struct{}

func (*nodeCompareClock) now() time.Time { return time.Now() }

func (*nodeCompareClock) elapsed(started time.Time) int64 { return time.Since(started).Nanoseconds() }

func nodeCompareCPU() nodeCompareCPUReading {
	reading := nodeCompareCPUReading{Source: "getrusage(RUSAGE_SELF): user+system, process-wide"}
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		reading.Reason = err.Error()
		return reading
	}
	reading.Available = true
	reading.UserNs = int64(usage.Utime.Sec)*1e9 + int64(usage.Utime.Usec)*1e3
	reading.SystemNs = int64(usage.Stime.Sec)*1e9 + int64(usage.Stime.Usec)*1e3
	return reading
}
