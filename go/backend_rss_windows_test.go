package dicecore

import (
	"syscall"
	"unsafe"
)

var backendMemoryInfo = syscall.NewLazyDLL("psapi.dll").NewProc("GetProcessMemoryInfo")

func backendRSS() map[string]any {
	var counters struct {
		Size                                                         uint32
		PageFaultCount                                               uint32
		PeakWorkingSet, WorkingSet                                   uintptr
		QuotaPeakPaged, QuotaPaged, QuotaPeakNonPaged, QuotaNonPaged uintptr
		Pagefile, PeakPagefile                                       uintptr
	}
	counters.Size = uint32(unsafe.Sizeof(counters))
	process, err := syscall.GetCurrentProcess()
	if err != nil {
		return map[string]any{"available": false, "reason": err.Error()}
	}
	ok, _, callErr := backendMemoryInfo.Call(uintptr(process), uintptr(unsafe.Pointer(&counters)), uintptr(counters.Size))
	if ok == 0 {
		return map[string]any{"available": false, "reason": callErr.Error()}
	}
	return map[string]any{"available": true, "rssBytes": uint64(counters.WorkingSet), "source": "GetProcessMemoryInfo.WorkingSetSize"}
}
