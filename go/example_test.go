package dicecore_test

import (
	"fmt"

	dicecore "github.com/arkanus-app/rpg-dice-roller/go"
)

func ExampleParseNotation() {
	input := "4d6kh3 + 2"
	limits := dicecore.UntrustedServerDiceLimits()
	budget := dicecore.NewExecutionBudget(limits)
	if err := budget.AssertInputLength(input); err != nil {
		panic(err)
	}
	normalized := dicecore.ParseNormalizedInput(input)
	tree, err := dicecore.ParseNotation(normalized.NormalizedNotation, limits)
	if err != nil {
		panic(err)
	}
	fmt.Println(tree.Kind)
	// Output: binary
}

func ExampleNewMersenneTwister19937() {
	random := dicecore.NewMersenneTwister19937(5489, nil)
	value, err := random.NextUint32()
	if err != nil {
		panic(err)
	}
	fmt.Println(value)
	// Output: 3499211612
}
