package dicecore

import "fmt"

// RandomCallBudget charges every raw draw, including rejected integer samples.
type RandomCallBudget interface {
	ConsumeRandomCalls(count int64) error
}

// RandomSource is a deterministic generator owned by one execution. Instances
// must not be shared concurrently; independent instances have no shared state.
type RandomSource interface {
	NextUint32() (uint32, error)
	Integer(min, max int64) (int64, error)
	Real() (float64, error)
}

const randomUint32Range uint64 = 1 << 32
const randomMaxSafeInteger int64 = 1<<53 - 1

func randomInteger(source RandomSource, min, max int64) (int64, error) {
	if min < -randomMaxSafeInteger || max > randomMaxSafeInteger || min > max {
		return 0, fmt.Errorf("Random integer bounds must be ordered safe integers")
	}
	// Bounds are restricted to the JS safe-integer domain before subtraction.
	width := uint64(max - min + 1)
	if width < 1 || width > randomUint32Range {
		return 0, fmt.Errorf("Random integer range must contain at most 2^32 values")
	}
	limit := randomUint32Range / width * width
	for {
		value, err := source.NextUint32()
		if err != nil {
			return 0, err
		}
		if uint64(value) < limit {
			return min + int64(uint64(value)%width), nil
		}
	}
}

func randomReal(source RandomSource) (float64, error) {
	value, err := source.NextUint32()
	if err != nil {
		return 0, err
	}
	return float64(value) / float64(randomUint32Range), nil
}

// MersenneTwister19937 implements the original 32-bit MT19937 algorithm.
type MersenneTwister19937 struct {
	state  [624]uint32
	index  int
	budget RandomCallBudget
}

// init_by_array always starts from this same fixed seed. Copying its immutable
// initialized state avoids 623 identical recurrence steps for every execution,
// including fresh user seeds. Each generator still owns its entire mutable state.
var mtArrayInitialState = NewMersenneTwister19937(19650218, nil).state

// NewMersenneTwister19937 initializes MT using a single raw uint32 seed.
// User string/numeric seeds go through CreateProvidedSeed and FromWords.
func NewMersenneTwister19937(seed uint32, budget RandomCallBudget) *MersenneTwister19937 {
	random := &MersenneTwister19937{budget: budget}
	random.initialize(seed)
	return random
}

// NewMersenneTwister19937FromWords preserves the reference init_by_array path.
// Words are consumed during construction and are not retained.
func NewMersenneTwister19937FromWords(words []uint32, budget RandomCallBudget) (*MersenneTwister19937, error) {
	if len(words) == 0 {
		return nil, newDiceError("INVALID_SEED", "MT19937 requires at least one seed word", "", nil)
	}
	random := &MersenneTwister19937{state: mtArrayInitialState, index: 624, budget: budget}
	i, j := 1, 0
	for remaining := max(624, len(words)); remaining > 0; remaining-- {
		previous := random.state[i-1]
		random.state[i] = (random.state[i] ^ ((previous ^ (previous >> 30)) * 1664525)) + words[j] + uint32(j)
		i++
		j++
		if i >= 624 {
			random.state[0] = random.state[623]
			i = 1
		}
		if j >= len(words) {
			j = 0
		}
	}
	for remaining := 623; remaining > 0; remaining-- {
		previous := random.state[i-1]
		random.state[i] = (random.state[i] ^ ((previous ^ (previous >> 30)) * 1566083941)) - uint32(i)
		i++
		if i >= 624 {
			random.state[0] = random.state[623]
			i = 1
		}
	}
	random.state[0] = 0x80000000
	return random, nil
}

func (r *MersenneTwister19937) initialize(seed uint32) {
	r.state[0] = seed
	for i := 1; i < len(r.state); i++ {
		previous := r.state[i-1]
		r.state[i] = 1812433253*(previous^(previous>>30)) + uint32(i)
	}
	r.index = len(r.state)
}

func (r *MersenneTwister19937) twist() {
	// Split the wraparound boundaries so every state index is a direct offset.
	// The second range intentionally reads words already updated by the first.
	for i := 0; i < 227; i++ {
		bits := (r.state[i] & 0x80000000) | (r.state[i+1] & 0x7fffffff)
		r.state[i] = r.state[i+397] ^ (bits >> 1) ^ ((0 - (bits & 1)) & 0x9908b0df)
	}
	for i := 227; i < 623; i++ {
		bits := (r.state[i] & 0x80000000) | (r.state[i+1] & 0x7fffffff)
		r.state[i] = r.state[i-227] ^ (bits >> 1) ^ ((0 - (bits & 1)) & 0x9908b0df)
	}
	bits := (r.state[623] & 0x80000000) | (r.state[0] & 0x7fffffff)
	r.state[623] = r.state[396] ^ (bits >> 1) ^ ((0 - (bits & 1)) & 0x9908b0df)
	r.index = 0
}

func (r *MersenneTwister19937) NextUint32() (uint32, error) {
	if r.budget != nil {
		if err := r.budget.ConsumeRandomCalls(1); err != nil {
			return 0, err
		}
	}
	if r.index >= len(r.state) {
		r.twist()
	}
	value := r.state[r.index]
	r.index++
	value ^= value >> 11
	value ^= (value << 7) & 0x9d2c5680
	value ^= (value << 15) & 0xefc60000
	value ^= value >> 18
	return value, nil
}

func (r *MersenneTwister19937) Integer(min, max int64) (int64, error) {
	return randomInteger(r, min, max)
}

func (r *MersenneTwister19937) Real() (float64, error) { return randomReal(r) }

// Xoshiro128StarStar implements xoshiro128** 1.1 by Blackman and Vigna.
type Xoshiro128StarStar struct {
	state  [4]uint32
	budget RandomCallBudget
}

func NewXoshiro128StarStar(words []uint32, budget RandomCallBudget) (*Xoshiro128StarStar, error) {
	if len(words) != 4 {
		return nil, newDiceError("INVALID_SEED", "xoshiro128** requires exactly four seed words", "", map[string]any{"wordCount": len(words)})
	}
	random := &Xoshiro128StarStar{budget: budget}
	copy(random.state[:], words)
	if random.state == [4]uint32{} {
		// Preserve the TS repair for the absorbing all-zero state.
		random.state[3] = 0x9e3779b9
	}
	return random, nil
}

func rotateRandomLeft(value uint32, count uint) uint32 {
	return value<<count | value>>(32-count)
}

func (r *Xoshiro128StarStar) NextUint32() (uint32, error) {
	if r.budget != nil {
		if err := r.budget.ConsumeRandomCalls(1); err != nil {
			return 0, err
		}
	}
	result := rotateRandomLeft(r.state[1]*5, 7) * 9
	shifted := r.state[1] << 9
	r.state[2] ^= r.state[0]
	r.state[3] ^= r.state[1]
	r.state[1] ^= r.state[2]
	r.state[0] ^= r.state[3]
	r.state[2] ^= shifted
	r.state[3] = rotateRandomLeft(r.state[3], 11)
	return result, nil
}

func (r *Xoshiro128StarStar) Integer(min, max int64) (int64, error) {
	return randomInteger(r, min, max)
}

func (r *Xoshiro128StarStar) Real() (float64, error) { return randomReal(r) }
