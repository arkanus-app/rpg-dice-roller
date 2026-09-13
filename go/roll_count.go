package dicecore

import "strings"

func syntaxTrimSpace(input string) string {
	return strings.TrimFunc(input, func(r rune) bool { return r <= 0xffff && syntaxWhitespace(uint16(r)) })
}
func syntaxRemoveWhitespace(input string) string {
	return strings.Map(func(r rune) rune {
		if r <= 0xffff && syntaxWhitespace(uint16(r)) {
			return -1
		}
		return r
	}, input)
}
func syntaxGroupCloser(c byte) byte {
	switch c {
	case '(':
		return ')'
	case '[':
		return ']'
	case '{':
		return '}'
	}
	return 0
}
func syntaxUnwrapOuterGroups(expression string) string {
	current := syntaxTrimSpace(expression)
	for len(current) > 0 {
		closer := syntaxGroupCloser(current[0])
		if closer == 0 || current[len(current)-1] != closer {
			return current
		}
		stack := []byte{}
		closesEarly := false
		for i := 0; i < len(current); i++ {
			c := current[i]
			if closer := syntaxGroupCloser(c); closer != 0 {
				stack = append(stack, closer)
				continue
			}
			if c != ')' && c != ']' && c != '}' {
				continue
			}
			if len(stack) == 0 || stack[len(stack)-1] != c {
				return current
			}
			stack = stack[:len(stack)-1]
			if len(stack) == 0 && i < len(current)-1 {
				closesEarly = true
				break
			}
		}
		if closesEarly || len(stack) != 0 {
			return current
		}
		current = syntaxTrimSpace(current[1 : len(current)-1])
	}
	return current
}
func syntaxExpressionChildren(node *ExpressionNode) []*ExpressionNode {
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
func syntaxEvaluateConstant(root *ExpressionNode, input string) (float64, bool) {
	type entry struct {
		node    *ExpressionNode
		visited bool
	}
	pending := []entry{{node: root}}
	constants := map[*ExpressionNode]float64{}
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if !current.visited {
			pending = append(pending, entry{node: current.node, visited: true})
			children := syntaxExpressionChildren(current.node)
			for i := len(children) - 1; i >= 0; i-- {
				pending = append(pending, entry{node: children[i]})
			}
			continue
		}
		node := current.node
		var value float64
		var ok bool
		var err error
		switch node.Kind {
		case "number":
			value, ok = node.Value, true
		case "unary":
			value, ok = constants[node.Operand]
			if ok {
				if node.Operator == "-" {
					value = -value
				}
				value, err = NormalizeMathValue(value, input)
			}
		case "parenthesized":
			value, ok = constants[node.Expression]
		case "binary":
			left, leftOK := constants[node.Left]
			right, rightOK := constants[node.Right]
			ok = leftOK && rightOK
			if ok {
				operator := node.Operator
				if operator == "**" {
					operator = "^"
				}
				value, err = EvaluateBinary(operator, left, right, input)
			}
		case "function":
			first, firstOK := constants[node.Arguments[0]]
			ok = firstOK
			if ok {
				if node.FunctionKind == "unary" {
					value, err = EvaluateUnaryFunction(node.Name, first, input)
				} else {
					second, secondOK := constants[node.Arguments[1]]
					ok = secondOK
					if ok {
						value, err = EvaluateBinaryFunction(node.Name, first, second, input)
					}
				}
			}
		}
		if err != nil {
			return 0, false
		}
		if ok {
			constants[node] = value
		}
	}
	value, ok := constants[root]
	return value, ok
}

// ResolveRollCountExpression evaluates a deterministic formula before the #
// marker. Invalid formulas and expressions depending on dice return ok=false.
func ResolveRollCountExpression(expression string) (value float64, ok bool) {
	normalized := syntaxRemoveWhitespace(syntaxUnwrapOuterGroups(expression))
	if normalized == "" {
		return 0, false
	}
	root, err := ParseDiceNotation(normalized, DiceParserLimits{MaxDepth: 64, MaxNodes: 512})
	if err != nil {
		return 0, false
	}
	return syntaxEvaluateConstant(root, normalized)
}
