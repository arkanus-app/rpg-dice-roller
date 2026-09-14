package dicecore

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"unicode/utf16"
)

func compilerFail(code, message, input string, span *SourceSpan, details map[string]any) {
	err := newDiceError(code, message, input, details)
	err.Span = span
	panic(err)
}

func normalizeCompilerError(err error, input string) *DiceRollError {
	var typed *DiceRollError
	if errors.As(err, &typed) {
		if typed.Input == input {
			return typed
		}
		result := newDiceError(typed.Code, typed.Message, input, typed.Details)
		result.Span = typed.Span
		return result
	}
	return newDiceError("INVALID_NOTATION", "Invalid dice notation", input, map[string]any{"cause": err.Error()})
}

func compilerRecover(err *error, input string) {
	if value := recover(); value != nil {
		if caught, ok := value.(error); ok {
			*err = normalizeCompilerError(caught, input)
		} else {
			*err = newDiceError("INVALID_NOTATION", "Invalid dice notation", input, map[string]any{"cause": "Unknown parser error"})
		}
	}
}

func saturatingAdd(left, right int64) int64 {
	if left >= maxSafeInteger-right {
		return maxSafeInteger
	}
	return left + right
}

func saturatingMultiply(left, right int64) int64 {
	if left == 0 || right == 0 {
		return 0
	}
	if left > maxSafeInteger/right {
		return maxSafeInteger
	}
	return left * right
}

var compiledModifierOrder = map[string]int{"min": 1, "max": 2, "explode": 3, "reroll": 4, "unique": 5, "keep": 6, "drop": 7, "target": 8, "critical-success": 9, "critical-failure": 10, "sort": 11}

// OrderCompiledModifiers preserves the last modifier of each runtime kind and
// executes kinds in the defined V3 pipeline, regardless of textual order.
func OrderCompiledModifiers(modifiers []*ModifierNode) []*ModifierNode {
	seen := map[string]bool{}
	result := []*ModifierNode{}
	for i := len(modifiers) - 1; i >= 0; i-- {
		modifier := modifiers[i]
		if !seen[modifier.Kind] {
			seen[modifier.Kind] = true
			result = append(result, modifier)
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		return compiledModifierOrder[result[i].Kind] < compiledModifierOrder[result[j].Kind]
	})
	return result
}

func expressionChildren(node *ExpressionNode) []*ExpressionNode {
	switch node.Kind {
	case "unary":
		return []*ExpressionNode{node.Operand}
	case "binary":
		return []*ExpressionNode{node.Left, node.Right}
	case "parenthesized":
		return []*ExpressionNode{node.Expression}
	case "function":
		return node.Arguments
	case "dice":
		if node.DiceKind == "standard" {
			return []*ExpressionNode{node.Quantity, node.Sides}
		}
		return []*ExpressionNode{node.Quantity}
	case "group":
		return node.Expressions
	}
	return nil
}

func buildCompilerPostOrder(root *ExpressionNode) []*ExpressionNode {
	type frame struct {
		node    *ExpressionNode
		visited bool
	}
	pending := []frame{{root, false}}
	result := []*ExpressionNode{}
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if current.visited {
			result = append(result, current.node)
			continue
		}
		pending = append(pending, frame{current.node, true})
		children := expressionChildren(current.node)
		for i := len(children) - 1; i >= 0; i-- {
			pending = append(pending, frame{children[i], false})
		}
	}
	return result
}

func measureCompilerProgram(root *ExpressionNode) (count, maxDepth int64) {
	type frame struct {
		node  countedSyntaxNode
		depth int64
	}
	pending := []frame{{countedSyntaxNode{expression: root}, 1}}
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		count++
		maxDepth = max(maxDepth, current.depth)
		for _, child := range syntaxCountedChildren(current.node) {
			pending = append(pending, frame{child, current.depth + 1})
		}
	}
	return
}

func foldCompilerConstant(node *ExpressionNode, constants map[string]float64, input string) (float64, bool) {
	read := func(n *ExpressionNode) (float64, bool) { value, ok := constants[n.ID]; return value, ok }
	var value float64
	var err error
	switch node.Kind {
	case "number":
		return node.Value, true
	case "group":
		return 0, false
	case "unary":
		value, ok := read(node.Operand)
		if node.Operator == "-" {
			value = -value
		}
		return value, ok
	case "parenthesized":
		return read(node.Expression)
	case "binary":
		left, lok := read(node.Left)
		right, rok := read(node.Right)
		if !lok || !rok {
			return 0, false
		}
		value, err = EvaluateBinary(node.Operator, left, right, input)
	case "function":
		first, ok := read(node.Arguments[0])
		if !ok {
			return 0, false
		}
		if node.FunctionKind == "unary" {
			value, err = EvaluateUnaryFunction(node.Name, first, input)
		} else {
			second, ok := read(node.Arguments[1])
			if !ok {
				return 0, false
			}
			value, err = EvaluateBinaryFunction(node.Name, first, second, input)
		}
	}
	if err != nil {
		original := normalizeCompilerError(err, input)
		compilerFail(original.Code, "Dice argument produced a non-finite result", input, &node.Span, original.Details)
	}
	return value, true
}

func readCompilerDiceInteger(node *ExpressionNode, input, argument string, constants map[string]float64) int64 {
	value, ok := constants[node.ID]
	if !ok {
		compilerFail("INVALID_NOTATION", "Dice arguments must be constant expressions", input, &node.Span, map[string]any{"argument": argument, "nodeKind": node.Kind})
	}
	minimum := float64(1)
	description := "positive"
	if argument == "sides" {
		minimum = 0
		description = "non-negative"
	}
	if !syntaxSafeInteger(value) || value < minimum {
		compilerFail("INVALID_NOTATION", "Dice "+argument+" must be a "+description+" safe integer", input, &node.Span, map[string]any{"argument": argument, "value": value})
	}
	return int64(value)
}

// FingerprintDicePlan hashes UTF-16 units using the compiler-version namespace.
func FingerprintDicePlan(value string) string {
	units := utf16.Encode([]rune(fmt.Sprintf("dicecore:%d:%s", DiceCompilerVersion, value)))
	words := [4]uint32{0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35}
	for i, hash := range words {
		for _, unit := range units {
			hash ^= uint32(unit)
			hash *= 0x01000193
			hash ^= hash >> 13
		}
		words[i] = hash
	}
	return seedWordsHex(words)
}

func validateCompilerNormalizedInput(parsed NormalizedDiceInput, limits DiceLimits) {
	if parsed.Notation == "" {
		compilerFail("DICE_NOTATION_REQUIRED", "Dice notation is required", parsed.Input, nil, nil)
	}
	if !syntaxSafeInteger(parsed.RollCount) || parsed.RollCount < 1 {
		var count any = parsed.RollCount
		if math.IsInf(parsed.RollCount, 0) || math.IsNaN(parsed.RollCount) {
			count = mathNumberString(parsed.RollCount)
		}
		compilerFail("INVALID_NOTATION", "Roll count must be a positive safe integer", parsed.Input, nil, map[string]any{"rollCount": count})
	}
	if parsed.RollCount > float64(limits.MaxRolls) {
		compilerFail("TOO_MANY_ROLLS", "Roll count exceeds the execution limit", parsed.Input, nil, map[string]any{"rollCount": parsed.RollCount, "limit": limits.MaxRolls})
	}
}

func PrepareDicePlanInput(input string, limits DiceLimits) (prepared PreparedDicePlanInput, err error) {
	defer compilerRecover(&err, input)
	if err := NewExecutionBudget(limits).AssertInputLength(input); err != nil {
		panic(err)
	}
	normalized := ParseNormalizedDiceInput(input)
	validateCompilerNormalizedInput(normalized, limits)
	return PreparedDicePlanInput{Normalized: normalized}, nil
}

// CompileDiceProgram compiles a normalized formula independently of comment and
// roll-count envelopes. sourceInput is retained in all diagnostics.
func CompileDiceProgram(notation, sourceInput string, limits DiceLimits) (program *CompiledDiceProgram, err error) {
	defer compilerRecover(&err, sourceInput)
	ast, parseErr := ParseDiceNotation(notation, DiceParserLimits{MaxDepth: limits.MaxAstDepth, MaxNodes: limits.MaxAstNodes})
	if parseErr != nil {
		panic(parseErr)
	}
	postOrder := buildCompilerPostOrder(ast)
	nodeCount, maxDepth := measureCompilerProgram(ast)
	result := &CompiledDiceProgram{CompilerVersion: DiceCompilerVersion, Notation: notation, ProgramFingerprint: FingerprintDicePlan(notation), AST: ast, PostOrder: postOrder, NodeCount: nodeCount, MaxDepth: maxDepth, DiceSpecs: map[string]*CompiledDiceSpec{}, GroupModifiers: map[string][]*ModifierNode{}, Constants: map[string]float64{}, SupportsFastSummary: true}
	semanticBudget := int64(1_000_000)
	for _, node := range postOrder {
		if node.Kind == "group" {
			result.SupportsFastSummary = result.SupportsFastSummary && len(node.Modifiers) == 0
			for _, modifier := range node.Modifiers {
				if modifier.Kind != "keep" && modifier.Kind != "drop" && modifier.Kind != "sort" {
					compilerFail("UNSUPPORTED_GROUP_MODIFIER", "Modifier "+modifier.Kind+" is not supported on roll groups", sourceInput, &modifier.Span, map[string]any{"modifier": modifier.Kind})
				}
			}
			result.GroupModifiers[node.ID] = OrderCompiledModifiers(node.Modifiers)
		}
		if node.Kind == "dice" {
			spec := createCompilerDiceSpec(node, sourceInput, limits, result.Constants, &semanticBudget)
			fast := len(spec.Modifiers) == 0
			if node == ast && len(spec.Modifiers) == 1 {
				switch spec.Modifiers[0].Kind {
				case "min", "max", "keep", "drop", "target":
					fast = true
				}
			}
			result.SupportsFastSummary = result.SupportsFastSummary && fast
			result.DiceSpecs[node.ID] = spec
			result.StaticDice = saturatingAdd(result.StaticDice, spec.Quantity)
			if sides, ok := spec.Sides.(int64); ok {
				result.MaximumSides = max(result.MaximumSides, sides)
			}
		} else if value, ok := foldCompilerConstant(node, result.Constants, sourceInput); ok {
			result.Constants[node.ID] = value
		}
	}
	return result, nil
}
