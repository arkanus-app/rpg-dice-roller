// Package dicecore is the native Go port of the ERPG dice engine.
//
// It compiles and executes the TypeScript 3.7.1 dice language, including
// modifiers, deterministic replay, resource limits, and RPG system adapters.
// Engines may be shared across goroutines; results are caller-owned values.
// The runtime uses only Go's standard library.
package dicecore
