package dicecore

import "unicode/utf16"

// ExecutionStats counts logical work, independently of materialized output.
type ExecutionStats struct {
	Rolls          int64 `json:"rolls"`
	InitialDice    int64 `json:"initialDice"`
	GeneratedDice  int64 `json:"generatedDice"`
	RandomCalls    int64 `json:"randomCalls"`
	ModifierSteps  int64 `json:"modifierSteps"`
	Events         int64 `json:"events"`
	ResolvedGroups int64 `json:"resolvedGroups"`
	ResultItems    int64 `json:"resultItems"`
}

type ExecutionBudgetSnapshot struct {
	AstNodes int64 `json:"astNodes"`
	ExecutionStats
}

// ExecutionBudget belongs to one execution. Do not share it across goroutines.
// Independent executions can run concurrently with separate budgets.
type ExecutionBudget struct {
	limits   DiceLimits
	snapshot ExecutionBudgetSnapshot
}

func NewExecutionBudget(limits DiceLimits) *ExecutionBudget {
	return &ExecutionBudget{limits: limits}
}

func (b *ExecutionBudget) Limits() DiceLimits                { return b.limits }
func (b *ExecutionBudget) Snapshot() ExecutionBudgetSnapshot { return b.snapshot }
func (b *ExecutionBudget) Stats() ExecutionStats             { return b.snapshot.ExecutionStats }

func budgetLimitError(code, message, name string, limit, actual int64, details map[string]any, input string) error {
	details["limitName"], details["limit"], details["actual"] = name, limit, actual
	return newDiceError(code, message, input, details)
}

func (b *ExecutionBudget) AssertInputLength(input string) error {
	length := int64(len(utf16.Encode([]rune(input))))
	if length > b.limits.MaxInputLength {
		return budgetLimitError("INPUT_TOO_LONG", "Dice input exceeds the maximum length", "maxInputLength",
			b.limits.MaxInputLength, length, map[string]any{"inputLength": length}, input)
	}
	return nil
}

func (b *ExecutionBudget) ConsumeAstNode(depth int64) error {
	if depth < 1 || depth > maxSafeInteger {
		return newDiceError("ROLL_EXECUTION_LIMIT", "AST depth must be a positive safe integer", "", map[string]any{"depth": depth})
	}
	if depth > b.limits.MaxAstDepth {
		return budgetLimitError("AST_TOO_DEEP", "AST exceeds the maximum depth", "maxAstDepth",
			b.limits.MaxAstDepth, depth, map[string]any{"depth": depth}, "")
	}
	return b.consume(&b.snapshot.AstNodes, 1, b.limits.MaxAstNodes, "TOO_MANY_NODES", "AST exceeds the maximum node count", "maxAstNodes")
}

func (b *ExecutionBudget) ConsumeRolls(count int64) error {
	return b.consume(&b.snapshot.Rolls, count, b.limits.MaxRolls, "TOO_MANY_ROLLS", "Roll count exceeds the execution limit", "maxRolls")
}
func (b *ExecutionBudget) ConsumeInitialDice(count int64) error {
	return b.consume(&b.snapshot.InitialDice, count, b.limits.MaxInitialDice, "TOO_MANY_INITIAL_DICE", "Initial dice count exceeds the execution limit", "maxInitialDice")
}
func (b *ExecutionBudget) ConsumeGeneratedDice(count int64) error {
	return b.consume(&b.snapshot.GeneratedDice, count, b.limits.MaxGeneratedDice, "GENERATED_DICE_LIMIT_EXCEEDED", "Generated dice count exceeds the execution limit", "maxGeneratedDice")
}
func (b *ExecutionBudget) ConsumeRandomCalls(count int64) error {
	return b.consume(&b.snapshot.RandomCalls, count, b.limits.MaxRandomCalls, "RANDOM_BUDGET_EXCEEDED", "Random call count exceeds the execution limit", "maxRandomCalls")
}
func (b *ExecutionBudget) ConsumeEvents(count int64) error {
	return b.consume(&b.snapshot.Events, count, b.limits.MaxEvents, "EVENT_LIMIT_EXCEEDED", "Event count exceeds the execution limit", "maxEvents")
}
func (b *ExecutionBudget) ConsumeModifierSteps(count int64) error {
	return b.consume(&b.snapshot.ModifierSteps, count, b.limits.MaxModifierSteps, "MODIFIER_STEP_LIMIT_EXCEEDED", "Modifier step count exceeds the execution limit", "maxModifierSteps")
}
func (b *ExecutionBudget) ConsumeResolvedGroups(count int64) error {
	return b.consume(&b.snapshot.ResolvedGroups, count, b.limits.MaxResolvedGroups, "RESOLVED_GROUP_LIMIT_EXCEEDED", "Resolved group count exceeds the execution limit", "maxResolvedGroups")
}
func (b *ExecutionBudget) ConsumeResultItems(count int64) error {
	return b.consume(&b.snapshot.ResultItems, count, b.limits.MaxResultItems, "RESULT_LIMIT_EXCEEDED", "Result item count exceeds the execution limit", "maxResultItems")
}

func validateBudgetCount(count int64) error {
	if count < 0 || count > maxSafeInteger {
		return newDiceError("ROLL_EXECUTION_LIMIT", "Budget consumption must be a non-negative safe integer", "", map[string]any{"count": count})
	}
	return nil
}

func (b *ExecutionBudget) AssertOutputLength(length int64) error {
	if err := validateBudgetCount(length); err != nil {
		return err
	}
	if length > b.limits.MaxOutputLength {
		return budgetLimitError("OUTPUT_LIMIT_EXCEEDED", "Output exceeds the maximum length", "maxOutputLength",
			b.limits.MaxOutputLength, length, map[string]any{"outputLength": length}, "")
	}
	return nil
}

func (b *ExecutionBudget) consume(current *int64, count, limit int64, code, message, name string) error {
	if err := validateBudgetCount(count); err != nil {
		return err
	}
	// Both terms are at most MaxSafeInteger; their sum cannot overflow int64.
	next := *current + count
	if next > maxSafeInteger || next > limit {
		// On failure, retain the reference's binary64 diagnostic at the safe
		// integer boundary. The rejected operation never mutates the counter.
		reported := int64(float64(*current) + float64(count))
		return budgetLimitError(code, message, name, limit, reported, map[string]any{"consumed": reported}, "")
	}
	*current = next
	return nil
}
