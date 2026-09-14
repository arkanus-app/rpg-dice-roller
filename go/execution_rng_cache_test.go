package dicecore

import (
	"fmt"
	"sync"
	"testing"
)

func TestExecutionRNGCachePreservesStreamsAndBudgets(t *testing.T) {
	var cache executionRNGCache
	a, b := [4]uint32{1, 2, 3, 4}, [4]uint32{5, 6, 7, 8}
	for phase, words := range [][4]uint32{a, a, a, b, b, b, a, a, a} {
		limits := DefaultDiceLimits()
		limits.MaxRandomCalls = 1300
		budget := NewExecutionBudget(limits)
		actual := cache.newMT(words, budget)
		expected, _ := NewMersenneTwister19937FromWords(words[:], nil)
		for draw := 0; draw < 1300; draw++ {
			got, err := actual.NextUint32()
			want, _ := expected.NextUint32()
			if err != nil || got != want {
				t.Fatalf("phase %d draw %d: %d != %d (%v)", phase, draw, got, want, err)
			}
		}
		if _, err := actual.NextUint32(); err == nil || budget.Stats().RandomCalls != 1300 {
			t.Fatal("prepared state bypassed or reused another execution's budget")
		}
		// Mutating the returned state must not corrupt the retained cache entry.
		actual.state[0] = 0
	}
	if cached := cache.prepared.Load(); cached == nil || cached.words != a {
		t.Fatal("cache did not retain exactly the last promoted seed")
	}
}

func TestExecutionRNGCacheNewSeedsDoNotAllocateEntries(t *testing.T) {
	var cache executionRNGCache
	for i := uint32(1); i <= 64; i++ {
		cache.newMT([4]uint32{i, 0, 0, 0}, nil)
	}
	if cache.prepared.Load() != nil {
		t.Fatal("new seed stream populated prepared-state cache")
	}
}

func TestExecutionRNGCacheConcurrentOwnership(t *testing.T) {
	var cache executionRNGCache
	var workers sync.WaitGroup
	errors := make(chan error, 8)
	for worker := 0; worker < 8; worker++ {
		workers.Go(func() {
			for iteration := 0; iteration < 64; iteration++ {
				words := [4]uint32{uint32(iteration % 3), 22, 33, 44}
				actual := cache.newMT(words, nil)
				expected, _ := NewMersenneTwister19937FromWords(words[:], nil)
				for draw := 0; draw < 32; draw++ {
					a, _ := actual.NextUint32()
					b, _ := expected.NextUint32()
					if a != b {
						errors <- fmt.Errorf("concurrent stream changed at draw %d", draw)
						return
					}
				}
			}
		})
	}
	workers.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}
}
