package dicecore

const DiceCompilerVersion = 1

type DiceInspectionCost struct {
	StaticDice                  int64 `json:"staticDice"`
	WorstCaseGeneratedDice      int64 `json:"worstCaseGeneratedDice"`
	WorstCaseRandomCalls        int64 `json:"worstCaseRandomCalls"`
	TotalStaticDice             int64 `json:"totalStaticDice"`
	TotalWorstCaseGeneratedDice int64 `json:"totalWorstCaseGeneratedDice"`
	TotalWorstCaseRandomCalls   int64 `json:"totalWorstCaseRandomCalls"`
}

type RollPlanGroup struct {
	ID           string     `json:"id"`
	SourceNodeID string     `json:"sourceNodeId"`
	Kind         string     `json:"kind"`
	Notation     string     `json:"notation"`
	Span         SourceSpan `json:"span"`
	ChildIDs     []string   `json:"childIds"`
}

// RollPlan's private program binds a plan to this compiler. A JSON roundtrip
// only carries the public envelope and cannot create executable program state.
type RollPlan struct {
	Type               string             `json:"type"`
	SchemaVersion      int                `json:"schemaVersion"`
	CompilerVersion    int                `json:"compilerVersion"`
	PlanFingerprint    string             `json:"planFingerprint"`
	Input              string             `json:"input"`
	Comment            string             `json:"comment"`
	Notation           string             `json:"notation"`
	NormalizedNotation string             `json:"normalizedNotation"`
	IsMultiRoll        bool               `json:"isMultiRoll"`
	RollCount          int64              `json:"rollCount"`
	Groups             []RollPlanGroup    `json:"groups"`
	Cost               DiceInspectionCost `json:"cost"`
	program            *CompiledDiceProgram
	identity           *RollPlan
	canonical          *RollPlan
}

type DiceNotationInspection struct {
	Type               string              `json:"type"`
	Input              string              `json:"input"`
	Notation           string              `json:"notation"`
	NormalizedNotation string              `json:"normalizedNotation"`
	Comment            string              `json:"comment"`
	IsValid            bool                `json:"isValid"`
	Plan               *RollPlan           `json:"plan"`
	Groups             []RollPlanGroup     `json:"groups"`
	Cost               *DiceInspectionCost `json:"cost"`
	Error              *DiceRollError      `json:"error"`
}

type CompiledDiceSpec struct {
	NodeID        string          `json:"nodeId"`
	Quantity      int64           `json:"quantity"`
	Sides         DiceSides       `json:"sides"`
	Minimum       int64           `json:"minimum"`
	Maximum       int64           `json:"maximum"`
	PossibleFaces int64           `json:"possibleFaces"`
	Modifiers     []*ModifierNode `json:"modifiers"`
}

type CompiledDiceProgram struct {
	CompilerVersion     int                          `json:"compilerVersion"`
	Notation            string                       `json:"notation"`
	ProgramFingerprint  string                       `json:"programFingerprint"`
	AST                 *ExpressionNode              `json:"ast"`
	PostOrder           []*ExpressionNode            `json:"postOrder"`
	NodeCount           int64                        `json:"nodeCount"`
	MaxDepth            int64                        `json:"maxDepth"`
	StaticDice          int64                        `json:"staticDice"`
	MaximumSides        int64                        `json:"maximumSides"`
	DiceSpecs           map[string]*CompiledDiceSpec `json:"diceSpecs"`
	GroupModifiers      map[string][]*ModifierNode   `json:"groupModifiers"`
	Constants           map[string]float64           `json:"constants"`
	SupportsFastSummary bool                         `json:"supportsFastSummary"`
}

type PreparedDicePlanInput struct {
	Normalized NormalizedDiceInput `json:"normalized"`
}
