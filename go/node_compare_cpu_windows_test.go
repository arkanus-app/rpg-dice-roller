package dicecore

import (
	"fmt"
	"math/bits"
	"syscall"
	"unsafe"
)

var nodeCompareProcessTimes = syscall.NewLazyDLL("kernel32.dll").NewProc("GetProcessTimes")

var nodeComparePerformanceCounter = syscall.NewLazyDLL("kernel32.dll").NewProc("QueryPerformanceCounter")
var nodeComparePerformanceFrequency = syscall.NewLazyDLL("kernel32.dll").NewProc("QueryPerformanceFrequency")
var nodeCompareClockFrequency uint64

// Each clock belongs to one goroutine. Reusing its syscall output slot avoids
// allocating a pointer-escaping counter for every timing read.
type nodeCompareClock struct {
	counter int64
}

func nodeCompareClockSetup() (nodeCompareClockInfo, error) {
	var frequency int64
	ok, _, callErr := nodeComparePerformanceFrequency.Call(uintptr(unsafe.Pointer(&frequency)))
	if ok == 0 {
		return nodeCompareClockInfo{}, fmt.Errorf("QueryPerformanceFrequency: %w", callErr)
	}
	if frequency <= 0 {
		return nodeCompareClockInfo{}, fmt.Errorf("QueryPerformanceFrequency returned %d", frequency)
	}
	if err := nodeComparePerformanceCounter.Find(); err != nil {
		return nodeCompareClockInfo{}, err
	}
	// Written once by the coordinator before its goroutines start.
	nodeCompareClockFrequency = uint64(frequency)
	return nodeCompareClockInfo{Source: "QueryPerformanceCounter", FrequencyHz: frequency}, nil
}

func (clock *nodeCompareClock) now() int64 {
	ok, _, callErr := nodeComparePerformanceCounter.Call(uintptr(unsafe.Pointer(&clock.counter)))
	if ok == 0 {
		panic(fmt.Errorf("QueryPerformanceCounter: %w", callErr))
	}
	return clock.counter
}

func (clock *nodeCompareClock) elapsed(started int64) int64 {
	ticks := clock.now() - started
	if ticks < 0 {
		panic("QueryPerformanceCounter moved backwards")
	}
	// Convert the delta, not the absolute uptime counter. A 128-bit product
	// also avoids overflow for large tick frequencies or long measurements.
	high, low := bits.Mul64(uint64(ticks), 1_000_000_000)
	if high >= nodeCompareClockFrequency {
		panic("QueryPerformanceCounter duration exceeds the nanosecond range")
	}
	nanoseconds, _ := bits.Div64(high, low, nodeCompareClockFrequency)
	if nanoseconds > 1<<63-1 {
		panic("QueryPerformanceCounter duration exceeds int64 nanoseconds")
	}
	return int64(nanoseconds)
}

func nodeCompareCPU() nodeCompareCPUReading {
	reading := nodeCompareCPUReading{Source: "GetProcessTimes: user+kernel, process-wide"}
	process, err := syscall.GetCurrentProcess()
	if err != nil {
		reading.Reason = err.Error()
		return reading
	}
	var created, exited, kernel, user syscall.Filetime
	ok, _, callErr := nodeCompareProcessTimes.Call(uintptr(process), uintptr(unsafe.Pointer(&created)), uintptr(unsafe.Pointer(&exited)), uintptr(unsafe.Pointer(&kernel)), uintptr(unsafe.Pointer(&user)))
	if ok == 0 {
		reading.Reason = callErr.Error()
		return reading
	}
	reading.Available = true
	reading.UserNs = int64(uint64(user.HighDateTime)<<32|uint64(user.LowDateTime)) * 100
	reading.SystemNs = int64(uint64(kernel.HighDateTime)<<32|uint64(kernel.LowDateTime)) * 100
	return reading
}
