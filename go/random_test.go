package dicecore

import (
	"errors"
	"reflect"
	"sync"
	"testing"
)

type testRandomBudget struct {
	calls int64
	limit int64
}

var errTestRandomBudget = errors.New("random budget exhausted")

func (budget *testRandomBudget) ConsumeRandomCalls(count int64) error {
	if budget.calls+count > budget.limit {
		return errTestRandomBudget
	}
	budget.calls += count
	return nil
}

func assertRandomErrorCode(t *testing.T, err error, code string) {
	t.Helper()
	var diceErr *DiceRollError
	if !errors.As(err, &diceErr) || diceErr.Code != code {
		t.Fatalf("expected %s, got %v", code, err)
	}
}

func randomValues(t *testing.T, source RandomSource, count int) []uint32 {
	t.Helper()
	values := make([]uint32, count)
	for i := range values {
		var err error
		values[i], err = source.NextUint32()
		if err != nil {
			t.Fatal(err)
		}
	}
	return values
}

func TestRandomTypeScriptReferenceSequences(t *testing.T) {
	mt := NewMersenneTwister19937(5489, nil)
	wantMT := []uint32{3499211612, 581869302, 3890346734, 3586334585, 545404204, 4161255391, 3922919429, 949333985, 2715962298, 1323567403}
	if got := randomValues(t, mt, len(wantMT)); !reflect.DeepEqual(got, wantMT) {
		t.Fatalf("MT reference: %v", got)
	}
	xoshiro, err := NewXoshiro128StarStar([]uint32{1, 2, 3, 4}, nil)
	if err != nil {
		t.Fatal(err)
	}
	wantXoshiro := []uint32{11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597, 4258142804}
	if got := randomValues(t, xoshiro, len(wantXoshiro)); !reflect.DeepEqual(got, wantXoshiro) {
		t.Fatalf("xoshiro reference: %v", got)
	}
}

func TestRandomRangeRejectionAndBudget(t *testing.T) {
	budget := &testRandomBudget{limit: 100}
	random := NewMersenneTwister19937(5489, budget)
	got, err := random.Integer(0, 2147483648)
	if err != nil || got != 581869302 || budget.calls != 2 {
		t.Fatalf("rejection sampling: value=%d, calls=%d, error=%v", got, budget.calls, err)
	}
	full := NewMersenneTwister19937(5489, nil)
	got, err = full.Integer(-2147483648, 2147483647)
	if err != nil || got != 1351727964 {
		t.Fatalf("full uint32 width: %d, %v", got, err)
	}
	for _, bounds := range [][2]int64{{2, 1}, {-2147483648, 2147483648}, {-1 << 63, 0}, {0, 1<<63 - 1}, {-randomMaxSafeInteger, randomMaxSafeInteger}} {
		if _, err := full.Integer(bounds[0], bounds[1]); err == nil {
			t.Fatalf("accepted invalid bounds %v", bounds)
		}
	}
	xoshiro, _ := NewXoshiro128StarStar([]uint32{1, 2, 3, 4}, budget)
	for range 7 {
		_, _ = xoshiro.NextUint32()
	}
	before := budget.calls
	got, err = xoshiro.Integer(0, 2147483648)
	if err != nil || got < 0 || got > 2147483648 || budget.calls-before < 2 {
		t.Fatalf("xoshiro rejection: %d, calls=%d, %v", got, budget.calls-before, err)
	}
}

func TestRandomBudgetFailureDoesNotAdvanceState(t *testing.T) {
	for _, algorithm := range []RandomAlgorithm{MT19937, Xoshiro128SS} {
		t.Run(string(algorithm), func(t *testing.T) {
			budget := &testRandomBudget{limit: 0}
			var source RandomSource
			if algorithm == MT19937 {
				source = NewMersenneTwister19937(5489, budget)
			} else {
				source, _ = NewXoshiro128StarStar([]uint32{1, 2, 3, 4}, budget)
			}
			if _, err := source.Real(); !errors.Is(err, errTestRandomBudget) {
				t.Fatalf("budget error: %v", err)
			}
			budget.limit = 1
			value, err := source.NextUint32()
			want := uint32(3499211612)
			if algorithm == Xoshiro128SS {
				want = 11520
			}
			if err != nil || value != want {
				t.Fatalf("failed draw advanced state: %d, %v", value, err)
			}
		})
	}
	budget := &testRandomBudget{limit: 1}
	mt := NewMersenneTwister19937(5489, budget)
	if _, err := mt.Integer(0, 2147483648); !errors.Is(err, errTestRandomBudget) {
		t.Fatalf("rejected samples must exhaust budget: %v", err)
	}
}

func TestRandomArraySeedsAndIsolation(t *testing.T) {
	_, err := NewMersenneTwister19937FromWords(nil, nil)
	assertRandomErrorCode(t, err, "INVALID_SEED")
	_, err = NewXoshiro128StarStar([]uint32{1, 2, 3}, nil)
	assertRandomErrorCode(t, err, "INVALID_SEED")
	zero, _ := NewXoshiro128StarStar([]uint32{0, 0, 0, 0}, nil)
	values := randomValues(t, zero, 3)
	if values[0] != 0 || values[2] == 0 {
		t.Fatalf("all-zero repair: %v", values)
	}
	words := []uint32{1, 2, 3, 4}
	first, _ := NewMersenneTwister19937FromWords(words, nil)
	want := randomValues(t, first, 1300) // crosses two twist boundaries
	var group sync.WaitGroup
	for range 8 {
		group.Go(func() {
			random, err := NewMersenneTwister19937FromWords(words, nil)
			if err != nil {
				t.Error(err)
				return
			}
			if got := randomValues(t, random, len(want)); !reflect.DeepEqual(got, want) {
				t.Error("independent generator changed reference stream")
			}
		})
	}
	group.Wait()
}

func TestRandomRealsAndSingletonStillConsumeDraws(t *testing.T) {
	budget := &testRandomBudget{limit: 101}
	xoshiro, _ := NewXoshiro128StarStar([]uint32{1, 2, 3, 4}, budget)
	for range 100 {
		value, err := xoshiro.Real()
		if err != nil || value < 0 || value >= 1 {
			t.Fatalf("invalid real %v, %v", value, err)
		}
	}
	value, err := xoshiro.Integer(7, 7)
	if err != nil || value != 7 || budget.calls != 101 {
		t.Fatalf("singleton draw %v, calls=%v, %v", value, budget.calls, err)
	}
}
