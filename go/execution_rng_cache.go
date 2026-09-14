package dicecore

import (
	"sync"
	"sync/atomic"
)

type preparedExecutionMT struct {
	words [4]uint32
	state [624]uint32
}

// executionRNGCache retains at most one immutable prepared MT state per engine.
// Only a repeated seed is promoted. Streams of new seeds do not allocate cache
// entries; every returned generator still owns its mutable state and budget.
type executionRNGCache struct {
	prepared atomic.Pointer[preparedExecutionMT]
	mu       sync.Mutex
	previous [4]uint32
	seen     bool
}

func (cache *executionRNGCache) newMT(words [4]uint32, budget RandomCallBudget) *MersenneTwister19937 {
	if prepared := cache.prepared.Load(); prepared != nil && prepared.words == words {
		return &MersenneTwister19937{state: prepared.state, index: 0, budget: budget}
	}
	cache.mu.Lock()
	promote := cache.seen && cache.previous == words
	cache.previous, cache.seen = words, true
	cache.mu.Unlock()
	// Four uint32 words always satisfy the public constructor's validation.
	random, _ := NewMersenneTwister19937FromWords(words[:], budget)
	if promote {
		// Twisting consumes no random draw or budget. Cache the same first block
		// as the reference TypeScript cache, before any value is returned.
		random.twist()
		cache.prepared.Store(&preparedExecutionMT{words: words, state: random.state})
	}
	return random
}
