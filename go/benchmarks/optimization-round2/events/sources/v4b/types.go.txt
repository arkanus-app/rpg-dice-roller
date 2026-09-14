package dicecore

// DiceSides is an int64 side count or "F" for Fudge dice.
type DiceSides = any

type DiceState = string
type GroupState = string

type EntityRange struct {
	Start int64 `json:"start"`
	Count int64 `json:"count"`
}

type PoolSummary struct {
	Successes    int64 `json:"successes"`
	Failures     int64 `json:"failures"`
	NetSuccesses int64 `json:"netSuccesses"`
}

type ResolvedDie struct {
	ID           string      `json:"id"`
	SourceNodeID string      `json:"sourceNodeId"`
	ParentDieID  *string     `json:"parentDieId"`
	RollIndex    int64       `json:"rollIndex"`
	RollDieIndex int64       `json:"rollDieIndex"`
	GroupID      string      `json:"groupId"`
	Sides        DiceSides   `json:"sides"`
	RawValue     float64     `json:"rawValue"`
	Value        float64     `json:"value"`
	Contribution float64     `json:"contribution"`
	Included     bool        `json:"included"`
	States       []DiceState `json:"states"`
}

type ResolvedGroup struct {
	ID           string       `json:"id"`
	SourceNodeID string       `json:"sourceNodeId"`
	RollIndex    int64        `json:"rollIndex"`
	Kind         string       `json:"kind"`
	Notation     string       `json:"notation"`
	Span         SourceSpan   `json:"span"`
	Value        float64      `json:"value"`
	Contribution float64      `json:"contribution"`
	Included     bool         `json:"included"`
	States       []GroupState `json:"states"`
	ChildIDs     []string     `json:"childIds"`
}

// DiceEvent preserves the discriminated event fields. Numeric values are float64;
// sequence and rollIndex counters are int64, and parentDieId is string or nil.
type DiceEvent = map[string]any

type ResolvedRoll struct {
	Index      int64        `json:"index"`
	Total      float64      `json:"total"`
	Pool       *PoolSummary `json:"pool"`
	DiceRange  EntityRange  `json:"diceRange"`
	GroupRange EntityRange  `json:"groupRange"`
	EventRange EntityRange  `json:"eventRange"`
}

type ResolvedRollSummary struct {
	Index int64        `json:"index"`
	Total float64      `json:"total"`
	Pool  *PoolSummary `json:"pool"`
}

type DiceRollResult struct {
	Type               string           `json:"type"`
	SchemaVersion      int64            `json:"schemaVersion"`
	Input              string           `json:"input"`
	Notation           string           `json:"notation"`
	NormalizedNotation string           `json:"normalizedNotation"`
	Comment            string           `json:"comment"`
	Total              float64          `json:"total"`
	Replay             ReplayDescriptor `json:"replay"`
	Stats              ExecutionStats   `json:"stats"`
	Pool               *PoolSummary     `json:"pool"`
	Output             string           `json:"output"`
	Rolls              []ResolvedRoll   `json:"rolls"`
	Groups             []ResolvedGroup  `json:"groups"`
	Dice               []ResolvedDie    `json:"dice"`
	Events             ResolvedEvents   `json:"events"`
}

type DiceRollDetails struct {
	Type               string                `json:"type"`
	SchemaVersion      int64                 `json:"schemaVersion"`
	Input              string                `json:"input"`
	Notation           string                `json:"notation"`
	NormalizedNotation string                `json:"normalizedNotation"`
	Comment            string                `json:"comment"`
	Total              float64               `json:"total"`
	Replay             ReplayDescriptor      `json:"replay"`
	Stats              ExecutionStats        `json:"stats"`
	Pool               *PoolSummary          `json:"pool"`
	Rolls              []ResolvedRollSummary `json:"rolls"`
	Dice               []ResolvedDie         `json:"dice"`
}

type DiceRollSummary struct {
	Type               string                `json:"type"`
	SchemaVersion      int64                 `json:"schemaVersion"`
	Input              string                `json:"input"`
	Notation           string                `json:"notation"`
	NormalizedNotation string                `json:"normalizedNotation"`
	Comment            string                `json:"comment"`
	Total              float64               `json:"total"`
	Replay             ReplayDescriptor      `json:"replay"`
	Stats              ExecutionStats        `json:"stats"`
	Pool               *PoolSummary          `json:"pool"`
	Rolls              []ResolvedRollSummary `json:"rolls"`
}

type FreezeResultsMode = string

// DiceCacheOptions uses absent keys for defaults, allowing explicit zero caps.
type DiceCacheOptions map[string]int64

type DiceCacheStats struct {
	InputEntries   int64 `json:"inputEntries"`
	ProgramEntries int64 `json:"programEntries"`
	ProgramNodes   int64 `json:"programNodes"`
	Hits           int64 `json:"hits"`
	Misses         int64 `json:"misses"`
	Evictions      int64 `json:"evictions"`
}

type DiceEngineOptions struct {
	Limits        DiceLimitOverrides
	FreezeResults FreezeResultsMode
	// Cache accepts nil (defaults), false (disabled), or DiceCacheOptions.
	Cache           any
	RandomAlgorithm RandomAlgorithm
}

type CompileOptions struct {
	Limits DiceLimitOverrides
}

type RollOptions struct {
	Limits DiceLimitOverrides
	// nil means omitted. A provided seed may be string, UTF16Seed, or number.
	Seed            any
	Replay          any
	RandomAlgorithm RandomAlgorithm
}
