package dicecore

import (
	"reflect"
	"strconv"
	"testing"
)

func TestWorkingDiceReservationIsBoundedAndDoesNotConsumeBudgets(t *testing.T) {
	for _, item := range []struct {
		name                     string
		quantity, initial, items int64
		usedInitial, usedItems   int64
		want                     int
	}{
		{"empty", 0, 1000, 1000, 0, 0, 0},
		{"one-needs-no-reservation", 1, 1000, 1000, 0, 0, 0},
		{"known-pool", 100, 1000, 1000, 0, 1, 100},
		{"prefix-only", 1000, 1000, 1000, 0, 1, 256},
		{"remaining-initial", 100, 10, 1000, 8, 1, 2},
		{"remaining-items", 100, 1000, 10, 0, 7, 3},
		{"exhausted", 100, 10, 10, 10, 10, 0},
		{"negative-quantity", -1, 1000, 1000, 0, 0, 0},
		{"negative-initial-limit", 100, -1, 1000, 0, 1, 0},
		{"negative-item-limit", 100, 1000, -1, 0, 1, 0},
	} {
		t.Run(item.name, func(t *testing.T) {
			limits := DefaultDiceLimits()
			limits.MaxInitialDice, limits.MaxResultItems = item.initial, item.items
			budget := NewExecutionBudget(limits)
			budget.snapshot.InitialDice, budget.snapshot.ResultItems = item.usedInitial, item.usedItems
			before := budget.Snapshot()
			dice := reserveWorkingDicePointers(item.quantity, budget)
			if len(dice) != 0 || cap(dice) != item.want || dice == nil {
				t.Fatalf("reservation: length=%d capacity=%d nil=%v; want non-nil capacity=%d", len(dice), cap(dice), dice == nil, item.want)
			}
			if budget.Snapshot() != before {
				t.Fatal("reservation consumed a logical budget")
			}
		})
	}
}

func TestWorkingDiceReservationsOwnIndependentPointerArrays(t *testing.T) {
	budget := NewExecutionBudget(DefaultDiceLimits())
	roll := reserveWorkingDicePointers(5, budget)
	local := reserveWorkingDicePointers(2, budget)
	root, sibling, generated := &workingDie{}, &workingDie{}, &workingDie{}
	roll = append(roll, root, sibling)
	local = append(local, root)
	local = append(local, generated)
	if roll[0] != root || roll[1] != sibling || local[1] != generated {
		t.Fatal("local modifier pool append changed the roll's index")
	}
	roll = append(roll, generated)
	local[0] = sibling
	if roll[0] != root || roll[2] != generated {
		t.Fatal("local pool assignment changed the roll's index")
	}
}

func TestWorkingDiceReservationPreservesExplosionGroupsAndRollOrder(t *testing.T) {
	engine, err := CreateDiceEngine()
	if err != nil {
		t.Fatal(err)
	}
	const input = "2#{2d1!2,3d1}sa"
	result, err := engine.Roll(input, RollOptions{Seed: "pointer-reservation"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 18 || len(result.Dice) != 18 || result.Stats.InitialDice != 10 || result.Stats.GeneratedDice != 8 {
		t.Fatalf("unexpected deterministic roll: total=%v dice=%d stats=%+v", result.Total, len(result.Dice), result.Stats)
	}
	for index, die := range result.Dice {
		roll, offset := index/9+1, index%9
		prefix := "roll-" + strconv.Itoa(roll) + "-die-"
		if die.ID != prefix+strconv.Itoa(offset+1) || die.RollIndex != int64(roll) || die.RollDieIndex != int64(offset+1) || die.Value != 1 {
			t.Fatalf("die chronology changed at %d: %+v", index, die)
		}
		parentIndex := map[int]int{2: 1, 3: 3, 4: 2, 5: 5}[offset]
		if parentIndex == 0 {
			if die.ParentDieID != nil {
				t.Fatalf("root die acquired parent: %+v", die)
			}
		} else if die.ParentDieID == nil || *die.ParentDieID != prefix+strconv.Itoa(parentIndex) {
			t.Fatalf("explosion parent changed: %+v", die)
		}
	}
	for index, roll := range result.Rolls {
		if roll.DiceRange != (EntityRange{Start: int64(index * 9), Count: 9}) {
			t.Fatalf("roll dice range changed: %+v", roll)
		}
	}
	for _, group := range result.Groups {
		if group.Kind != "group" {
			continue
		}
		start := (int(group.RollIndex) - 1) * 9
		want := []string{result.Dice[start+6].GroupID, result.Dice[start].GroupID}
		if !reflect.DeepEqual(group.ChildIDs, want) {
			t.Fatalf("sorted display order changed source dice chronology: got %v, want %v", group.ChildIDs, want)
		}
	}
	details, err := engine.RollDetails(input, RollOptions{Replay: result.Replay})
	if err != nil || !reflect.DeepEqual(details.Dice, result.Dice) || details.Stats != result.Stats {
		t.Fatalf("replay details changed after pointer reservation: %v", err)
	}
	result.Dice[0].Value = 99
	result.Dice[0].States[0] = "caller-mutation"
	again, err := engine.Roll(input, RollOptions{Replay: result.Replay})
	if err != nil || !reflect.DeepEqual(again.Dice, details.Dice) {
		t.Fatalf("returned dice storage leaked into another call: %v", err)
	}
}

func TestWorkingDiceReservationPreservesFirstBudgetError(t *testing.T) {
	plan, err := CompileDicePlan("2d1", DefaultDiceLimits())
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		initial, items, random int64
		code                   string
	}{
		{-1, 100, 100, "TOO_MANY_INITIAL_DICE"},
		{100, -1, 100, "RESULT_LIMIT_EXCEEDED"},
		{-1, -1, 0, "RESULT_LIMIT_EXCEEDED"},
		{0, 100, 0, "TOO_MANY_INITIAL_DICE"},
		{1, 1, 0, "RESULT_LIMIT_EXCEEDED"},
		{100, 100, 0, "RANDOM_BUDGET_EXCEEDED"},
	} {
		limits := DefaultDiceLimits()
		limits.MaxInitialDice, limits.MaxResultItems, limits.MaxRandomCalls = item.initial, item.items, item.random
		_, err := ExecuteRollPlan(plan, ExecuteRollPlanOptions{Limits: limits, Seed: "pointer-budget"})
		executorAssertError(t, err, item.code)
	}
}
