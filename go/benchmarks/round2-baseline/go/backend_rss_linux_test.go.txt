package dicecore

import (
	"os"
	"strconv"
	"strings"
)

func backendRSS() map[string]any {
	data, err := os.ReadFile("/proc/self/statm")
	if err != nil {
		return map[string]any{"available": false, "reason": err.Error()}
	}
	fields := strings.Fields(string(data))
	if len(fields) < 2 {
		return map[string]any{"available": false, "reason": "invalid /proc/self/statm"}
	}
	pages, err := strconv.ParseUint(fields[1], 10, 64)
	if err != nil {
		return map[string]any{"available": false, "reason": err.Error()}
	}
	return map[string]any{"available": true, "rssBytes": pages * uint64(os.Getpagesize()), "source": "/proc/self/statm resident pages"}
}
