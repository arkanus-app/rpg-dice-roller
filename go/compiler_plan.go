package dicecore

import "unicode/utf16"

func validateCompilerProgramCaps(input, notation string, rollCount int64, program *CompiledDiceProgram, limits DiceLimits) {
	if program.Notation != notation {
		compilerFail("UNSUPPORTED_NOTATION", "Compiled program does not match normalized notation", input, nil, nil)
	}
	if program.NodeCount > limits.MaxAstNodes {
		compilerFail("TOO_MANY_NODES", "AST node count exceeds the execution limit", input, nil, map[string]any{"actual": program.NodeCount, "limit": limits.MaxAstNodes})
	}
	if program.MaxDepth > limits.MaxAstDepth {
		compilerFail("AST_TOO_DEEP", "AST depth exceeds the execution limit", input, nil, map[string]any{"actual": program.MaxDepth, "limit": limits.MaxAstDepth})
	}
	if program.MaximumSides > limits.MaxSides {
		compilerFail("DICE_SIDES_LIMIT_EXCEEDED", "Dice sides exceed the configured limit", input, nil, map[string]any{"sides": program.MaximumSides, "limit": limits.MaxSides})
	}
	if saturatingMultiply(program.StaticDice, rollCount) > limits.MaxInitialDice {
		compilerFail("TOO_MANY_INITIAL_DICE", "Initial dice count exceeds the execution limit", input, nil, map[string]any{"quantity": program.StaticDice, "rollCount": rollCount, "limit": limits.MaxInitialDice})
	}
}

func compilerSemanticChildren(node *ExpressionNode) []*ExpressionNode {
	if node.Kind == "dice" {
		return nil
	}
	return expressionChildren(node)
}

func compilerPlanGroupKind(node *ExpressionNode) string {
	switch node.Kind {
	case "dice", "function", "group":
		return node.Kind
	}
	return "expression"
}

func compilerGroupID(node *ExpressionNode) string { return "group:" + node.ID }

func createCompilerPlanGroups(root *ExpressionNode, notation string) []RollPlanGroup {
	groups := []RollPlanGroup{}
	units := utf16.Encode([]rune(notation))
	pending := []*ExpressionNode{root}
	for len(pending) > 0 {
		node := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		children := compilerSemanticChildren(node)
		ids := make([]string, len(children))
		for i, child := range children {
			ids[i] = compilerGroupID(child)
		}
		groups = append(groups, RollPlanGroup{ID: compilerGroupID(node), SourceNodeID: node.ID, Kind: compilerPlanGroupKind(node), Notation: string(utf16.Decode(units[node.Span.Start:node.Span.End])), Span: node.Span, ChildIDs: ids})
		for i := len(children) - 1; i >= 0; i-- {
			pending = append(pending, children[i])
		}
	}
	return groups
}

func compilerModifierIterations(modifier *ModifierNode, limits DiceLimits) int64 {
	switch modifier.Kind {
	case "explode":
		if modifier.MaxExplosions == nil {
			return limits.MaxModifierSteps
		}
		return min(int64(*modifier.MaxExplosions), limits.MaxModifierSteps)
	case "reroll", "unique":
		if modifier.Once {
			return 1
		}
		return limits.MaxModifierSteps
	}
	return 0
}

func createCompilerInspectionCost(program *CompiledDiceProgram, rollCount int64, limits DiceLimits) DiceInspectionCost {
	cost := DiceInspectionCost{}
	for _, spec := range program.DiceSpecs {
		generated, active, random := int64(0), spec.Quantity, spec.Quantity
		for _, modifier := range spec.Modifiers {
			iterations := compilerModifierIterations(modifier, limits)
			switch modifier.Kind {
			case "explode":
				additional := saturatingMultiply(spec.Quantity, iterations)
				generated = saturatingAdd(generated, additional)
				random = saturatingAdd(random, additional)
				if !modifier.Compound {
					active = saturatingAdd(active, additional)
				}
			case "reroll":
				random = saturatingAdd(random, saturatingMultiply(active, iterations))
			case "unique":
				random = saturatingAdd(random, saturatingMultiply(max(0, active-1), iterations))
			}
		}
		cost.StaticDice = saturatingAdd(cost.StaticDice, spec.Quantity)
		cost.WorstCaseGeneratedDice = saturatingAdd(cost.WorstCaseGeneratedDice, generated)
		cost.WorstCaseRandomCalls = saturatingAdd(cost.WorstCaseRandomCalls, random)
	}
	cost.TotalStaticDice = saturatingMultiply(cost.StaticDice, rollCount)
	cost.TotalWorstCaseGeneratedDice = saturatingMultiply(cost.WorstCaseGeneratedDice, rollCount)
	cost.TotalWorstCaseRandomCalls = saturatingMultiply(cost.WorstCaseRandomCalls, rollCount)
	return cost
}

// BindDicePlan binds a normalized envelope to a compiled program. A nil program
// requests compilation; otherwise cached IR is revalidated against current caps.
func BindDicePlan(prepared PreparedDicePlanInput, program *CompiledDiceProgram, limits DiceLimits) (plan *RollPlan, err error) {
	normalized := prepared.Normalized
	defer compilerRecover(&err, normalized.Input)
	if program == nil {
		program, err = CompileDiceProgram(normalized.Notation, normalized.Input, limits)
		if err != nil {
			return nil, err
		}
	}
	validateCompilerProgramCaps(normalized.Input, normalized.Notation, int64(normalized.RollCount), program, limits)
	plan = &RollPlan{Type: "roll-plan", SchemaVersion: 3, CompilerVersion: DiceCompilerVersion, PlanFingerprint: FingerprintDicePlan(normalized.NormalizedNotation), Input: normalized.Input, Comment: normalized.Comment, Notation: normalized.Notation, NormalizedNotation: normalized.NormalizedNotation, IsMultiRoll: normalized.IsMultiRoll, RollCount: int64(normalized.RollCount), Groups: createCompilerPlanGroups(program.AST, normalized.Notation), Cost: createCompilerInspectionCost(program, int64(normalized.RollCount), limits), program: program}
	plan.identity = plan
	snapshot := *plan
	snapshot.Groups = make([]RollPlanGroup, len(plan.Groups))
	for index, group := range plan.Groups {
		snapshot.Groups[index] = group
		snapshot.Groups[index].ChildIDs = append([]string{}, group.ChildIDs...)
	}
	snapshot.identity = &snapshot
	plan.canonical = &snapshot
	return plan, nil
}

func CompileDicePlan(input string, limits DiceLimits) (*RollPlan, error) {
	prepared, err := PrepareDicePlanInput(input, limits)
	if err != nil {
		return nil, err
	}
	return BindDicePlan(prepared, nil, limits)
}

func HasPlanProgram(plan *RollPlan) bool {
	return plan != nil && plan.program != nil && plan.identity == plan
}

// GetPlanProgram borrows the compiler's shared IR for read-only inspection.
// Callers must not mutate it or its maps, slices, nodes, or modifiers.
func GetPlanProgram(plan *RollPlan) (*CompiledDiceProgram, error) {
	if !HasPlanProgram(plan) {
		input := ""
		schema := 0
		if plan != nil {
			input = plan.Input
			schema = plan.SchemaVersion
		}
		return nil, newDiceError("UNSUPPORTED_NOTATION", "Roll plan was not created by this compiler instance", input, map[string]any{"schemaVersion": schema})
	}
	return plan.program, nil
}

// canonicalRollPlan resolves the private immutable envelope saved at binding.
// Public plan fields are caller-owned; changing them never changes execution.
func canonicalRollPlan(plan *RollPlan) (*RollPlan, error) {
	if _, err := GetPlanProgram(plan); err != nil {
		return nil, err
	}
	for plan.canonical != nil {
		plan = plan.canonical
	}
	return plan, nil
}

// GetPlanAST borrows the shared AST for read-only inspection. Mutating any
// reachable node violates the compiler contract, including during a roll.
func GetPlanAST(plan *RollPlan) (*ExpressionNode, error) {
	program, err := GetPlanProgram(plan)
	if err != nil {
		return nil, err
	}
	return program.AST, nil
}

func ValidatePlanLimits(plan *RollPlan, limits DiceLimits) (err error) {
	plan, err = canonicalRollPlan(plan)
	if err != nil {
		return err
	}
	program := plan.program
	defer compilerRecover(&err, plan.Input)
	if err = NewExecutionBudget(limits).AssertInputLength(plan.Input); err != nil {
		return err
	}
	if plan.RollCount > limits.MaxRolls {
		compilerFail("TOO_MANY_ROLLS", "Roll count exceeds the execution limit", plan.Input, nil, map[string]any{"rollCount": plan.RollCount, "limit": limits.MaxRolls})
	}
	validateCompilerProgramCaps(plan.Input, plan.Notation, plan.RollCount, program, limits)
	return nil
}

// InspectDiceNotation validates and estimates without consuming randomness.
func InspectDiceNotation(input string, limits DiceLimits) DiceNotationInspection {
	plan, err := CompileDicePlan(input, limits)
	if err == nil {
		return DiceNotationInspection{Type: "dice-notation-inspection", Input: input, Notation: plan.Notation, NormalizedNotation: plan.NormalizedNotation, Comment: plan.Comment, IsValid: true, Plan: plan, Groups: plan.Groups, Cost: &plan.Cost}
	}
	normalized := ParseNormalizedDiceInput(input)
	return DiceNotationInspection{Type: "dice-notation-inspection", Input: input, Notation: normalized.Notation, NormalizedNotation: normalized.NormalizedNotation, Comment: normalized.Comment, Groups: []RollPlanGroup{}, Error: normalizeCompilerError(err, input)}
}
