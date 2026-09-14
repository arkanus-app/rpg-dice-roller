package dicecore

import (
	"reflect"
	"testing"
)

func TestExecutionJournalChronologyAndSlices(t *testing.T) {
	journal := NewExecutionJournal(nil)
	input := DiceEvent{"type": "roll", "subject": "die", "dieId": "die-1", "parentDieId": nil, "rollIndex": int64(0), "sourceNodeId": "node-1", "value": float64(6)}
	first, err := journal.Record(input)
	if err != nil {
		t.Fatal(err)
	}
	input["value"] = float64(1)
	second, err := journal.Record(DiceEvent{"type": "explode", "subject": "die", "dieId": "die-1", "parentDieId": nil, "childDieId": "die-2", "value": float64(4)})
	if err != nil {
		t.Fatal(err)
	}
	if first["sequence"] != int64(1) || second["sequence"] != int64(2) || first["value"] != float64(6) {
		t.Fatal("events were not copied in causal order")
	}
	all := journal.ToArray()
	if !reflect.DeepEqual(journal.Slice(0), all) || !reflect.DeepEqual(journal.Slice(1, 2), all[1:]) || !reflect.DeepEqual(journal.Slice(-1), all[1:]) || !reflect.DeepEqual(journal.Slice(0, -1), all[:1]) {
		t.Fatal("slice differs from JS array slice")
	}
	if len(journal.Slice(5)) != 0 || len(journal.Slice(1, 0)) != 0 || len(journal.Slice(-20, -20)) != 0 {
		t.Fatal("out-of-range slice was not clamped")
	}
	all[0] = nil
	if journal.ToArray()[0] == nil {
		t.Fatal("ToArray exposed slice storage")
	}
}

func TestExecutionJournalBudgetsBeforeMutation(t *testing.T) {
	for _, field := range []string{"maxEvents", "maxResultItems"} {
		t.Run(field, func(t *testing.T) {
			limits, err := CreateDiceLimits(DiceLimitOverrides{field: 1})
			if err != nil {
				t.Fatal(err)
			}
			budget := NewExecutionBudget(limits)
			journal := NewExecutionJournal(budget)
			event := DiceEvent{"type": "roll"}
			if _, err := journal.Record(event); err != nil {
				t.Fatal(err)
			}
			_, err = journal.Record(event)
			code := "EVENT_LIMIT_EXCEEDED"
			if field == "maxResultItems" {
				code = "RESULT_LIMIT_EXCEEDED"
			}
			executorAssertError(t, err, code)
			if journal.Length() != 1 || len(journal.ToArray()) != 1 {
				t.Fatal("journal mutated before budget failure")
			}
		})
	}
	budget := NewExecutionBudget(DefaultDiceLimits())
	journal := NewExecutionJournal(budget, false)
	event, err := journal.Record(DiceEvent{"type": "roll"})
	if err != nil {
		t.Fatal(err)
	}
	if event != nil || journal.Length() != 1 || len(journal.Slice(0)) != 0 || len(journal.ToArray()) != 0 || budget.Stats().Events != 1 {
		t.Fatal("suppression changed logical accounting")
	}
}
