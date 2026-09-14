package dicecore

import (
	"fmt"
	"math"
	"reflect"
	"strconv"
	"testing"
)

// Preserve the pre-optimization selection as an independent oracle for active
// filtering, tie ordering, mutation order, journal events and budget failures.
func referenceWorkingDieSelection(dice []*workingDie, modifier *ModifierNode, state *rollState) {
	active := activeWorkingDice(dice)
	values := make([]float64, len(active))
	for i, die := range active {
		values[i] = die.Value
	}
	for _, index := range executorIndexesToExclude(values, modifier.Kind, modifier.Selection, modifier.Quantity) {
		die := active[index]
		if !die.Included {
			continue
		}
		die.Included = false
		appendDieState(die, "dropped")
		syncDieContribution(die)
		recordDieEvent(state, die, ResolvedEvent{Type: "exclude"}, ResolvedEventDetails{Reason: modifier.Kind})
	}
}

func selectionTestDice(count, stride int, shape string, preexcluded bool) []*workingDie {
	dice := make([]*workingDie, count)
	for index := range dice {
		value := float64(index)
		switch shape {
		case "descending":
			value = float64(count - index)
		case "ties":
			value = float64(index % 3)
		case "fractional":
			value = float64((index*17)%23-11) / 4
			if index%13 == 0 {
				value = math.Copysign(0, -1)
			}
		}
		active := stride > 0 && index%stride == 0
		included := active && (!preexcluded || index%7 != 0)
		id := "selection-die-" + strconv.Itoa(index)
		die := &workingDie{ID: id, SourceNodeID: "selection-node", GroupID: "selection-group",
			spec: &CompiledDiceSpec{Sides: int64(6)}, RawValue: value, Value: value, Contribution: value, Included: included,
			States: []string{"existing"}, active: active}
		if !included {
			die.Contribution = 0
			die.States = append(die.States, "dropped")
		}
		if index%3 == 0 {
			parent := "selection-parent-" + strconv.Itoa(index)
			die.ParentDieID = &parent
		}
		dice[index] = die
	}
	return dice
}

func selectionTestState(limits DiceLimits, materialize bool) *rollState {
	budget := NewExecutionBudget(limits)
	return &rollState{rollIndex: 2, context: &ExecutionContext{Limits: limits, Budget: budget,
		Journal: NewExecutionJournal(budget, materialize)}}
}

func selectionTestRun(apply func([]*workingDie, *ModifierNode, *rollState), dice []*workingDie, modifier *ModifierNode, state *rollState) (err error) {
	defer func() {
		if failure := recover(); failure != nil {
			err = failure.(error)
		}
	}()
	apply(dice, modifier, state)
	return nil
}

func assertSelectionStateMatches(t *testing.T, wanted, actual []*workingDie, reference, candidate *rollState, wantedErr, actualErr error) {
	t.Helper()
	if !reflect.DeepEqual(wantedErr, actualErr) {
		t.Fatalf("selection error changed: wanted %#v; got %#v", wantedErr, actualErr)
	}
	if !reflect.DeepEqual(wanted, actual) {
		t.Fatal("selection changed dice values, inclusion, states or identity")
	}
	if !reflect.DeepEqual(reference.context.Journal.events, candidate.context.Journal.events) {
		t.Fatalf("selection changed exact event order or contents: wanted %+v; got %+v", reference.context.Journal.events, candidate.context.Journal.events)
	}
	if reference.context.Journal.Length() != candidate.context.Journal.Length() || reference.context.Budget.Snapshot() != candidate.context.Budget.Snapshot() {
		t.Fatal("selection changed logical event count or budget state")
	}
}

func TestWorkingDieSelectionMatchesStableReference(t *testing.T) {
	for _, count := range []int{0, 1, 20, 32, 33, 100, 129, 257} {
		for _, shape := range []string{"ascending", "descending", "ties", "fractional"} {
			for _, stride := range []int{1, 4} {
				for _, kind := range []string{"keep", "drop"} {
					for _, selection := range []string{"lowest", "highest"} {
						for _, quantity := range []float64{0, 1, float64(count) / 2, float64(count + 1)} {
							name := fmt.Sprintf("n%d/%s/stride%d/%s/%s/q%g", count, shape, stride, kind, selection, quantity)
							t.Run(name, func(t *testing.T) {
								wanted := selectionTestDice(count, stride, shape, true)
								actual := selectionTestDice(count, stride, shape, true)
								limits := DefaultDiceLimits()
								reference, candidate := selectionTestState(limits, true), selectionTestState(limits, true)
								modifier := &ModifierNode{Kind: kind, Selection: selection, Quantity: quantity}
								wantedErr := selectionTestRun(referenceWorkingDieSelection, wanted, modifier, reference)
								actualErr := selectionTestRun(applyDieSelection, actual, modifier, candidate)
								assertSelectionStateMatches(t, wanted, actual, reference, candidate, wantedErr, actualErr)
								if actualErr != nil {
									t.Fatalf("unexpected selection failure: %v", actualErr)
								}
							})
						}
					}
				}
			}
		}
	}
}

func TestWorkingDieSelectionPreservesSequentialExclusionsAndFailures(t *testing.T) {
	for _, materialize := range []bool{false, true} {
		for _, stride := range []int{0, 1, 4, 32} {
			for _, limited := range []string{"none", "events", "items"} {
				for _, cap := range []int64{0, 1, 9, 64, 500} {
					name := fmt.Sprintf("materialize%t/stride%d/%s/%d", materialize, stride, limited, cap)
					t.Run(name, func(t *testing.T) {
						limits := DefaultDiceLimits()
						if limited == "events" {
							limits.MaxEvents = cap
						} else if limited == "items" {
							limits.MaxResultItems = cap
						}
						wanted := selectionTestDice(129, stride, "fractional", false)
						actual := selectionTestDice(129, stride, "fractional", false)
						reference, candidate := selectionTestState(limits, materialize), selectionTestState(limits, materialize)
						for _, modifier := range []*ModifierNode{
							{Kind: "keep", Selection: "highest", Quantity: 17},
							{Kind: "drop", Selection: "lowest", Quantity: 110},
							{Kind: "keep", Selection: "lowest", Quantity: 7},
							{Kind: "drop", Selection: "highest", Quantity: 129},
						} {
							wantedErr := selectionTestRun(referenceWorkingDieSelection, wanted, modifier, reference)
							actualErr := selectionTestRun(applyDieSelection, actual, modifier, candidate)
							assertSelectionStateMatches(t, wanted, actual, reference, candidate, wantedErr, actualErr)
							if actualErr != nil {
								break
							}
						}
					})
				}
			}
		}
	}
}
