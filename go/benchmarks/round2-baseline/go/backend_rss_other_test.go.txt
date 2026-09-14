//go:build !windows && !linux

package dicecore

func backendRSS() map[string]any {
	return map[string]any{"available": false, "reason": "RSS measurement is implemented for Windows and Linux"}
}
