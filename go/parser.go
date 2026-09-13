package dicecore

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// DiceParserLimits limits syntax construction independently of execution.
type DiceParserLimits struct {
	MaxDepth int64 `json:"maxDepth"`
	MaxNodes int64 `json:"maxNodes"`
}

var syntaxBinaryPrecedence = map[string]int{"+": 10, "-": 10, "*": 20, "/": 20, "%": 20, "^": 30, "**": 30}

func syntaxUnaryFunction(name string) bool {
	switch name {
	case "abs", "ceil", "cos", "exp", "floor", "log", "round", "sign", "sin", "sqrt", "tan":
		return true
	}
	return false
}
func syntaxBinaryFunction(name string) bool { return name == "pow" || name == "max" || name == "min" }
func syntaxMergeSpan(start, end SourceSpan) SourceSpan {
	return SourceSpan{Start: start.Start, End: end.End}
}
func syntaxExpression(kind string, span SourceSpan) *ExpressionNode {
	return &ExpressionNode{Kind: kind, ID: CreateNodeID(kind, span), Span: span}
}
func syntaxModifier(kind string, span SourceSpan) *ModifierNode {
	return &ModifierNode{Kind: kind, ID: CreateNodeID(kind, span), Span: span}
}
func syntaxSafeInteger(value float64) bool {
	return !math.IsInf(value, 0) && !math.IsNaN(value) && math.Trunc(value) == value && math.Abs(value) <= 9007199254740991
}
func syntaxNumberString(value float64) string { return strconv.FormatFloat(value, 'f', -1, 64) }

type diceNotationParser struct {
	input          string
	tokens         []SyntaxToken
	cursor         int
	recursionDepth int64
	limits         DiceParserLimits
}

// recoverDiceParserPanic is deferred at the public parsing boundary. Syntax
// failures become errors; unexpected panics retain their identity for the caller.
func recoverDiceParserPanic(root **ExpressionNode, err *error) {
	if r := recover(); r != nil {
		if parseErr, ok := r.(*DiceRollError); ok {
			*root, *err = nil, parseErr
		} else {
			panic(r)
		}
	}
}

// ParseDiceNotation parses one comment-free formula without an N# prefix. Its
// optional limits match the TypeScript syntax API; ParseNotation applies the
// bounded execution defaults appropriate for accepting untrusted input.
func ParseDiceNotation(input string, limits ...DiceParserLimits) (root *ExpressionNode, err error) {
	defer recoverDiceParserPanic(&root, &err)
	parserLimits := DiceParserLimits{MaxDepth: 9007199254740991, MaxNodes: 9007199254740991}
	if len(limits) > 0 {
		parserLimits = limits[0]
	}
	tokens, err := TokenizeDiceNotation(input)
	if err != nil {
		return nil, err
	}
	p := &diceNotationParser{input: input, tokens: tokens, limits: parserLimits}
	if input == "" {
		p.fail("Dice notation is required", p.current().Span, map[string]any{})
	}
	root = p.parseExpression(0)
	if modifiers := p.parseStructuralModifiers(); len(modifiers) > 0 {
		root = p.attachStructuralModifiers(root, modifiers)
	}
	trailing := p.current()
	if trailing.Kind != "eof" {
		p.fail(fmt.Sprintf("Unexpected token %q at offset %d", trailing.Lexeme, trailing.Span.Start), trailing.Span, map[string]any{"found": trailing.Lexeme, "expected": "end of notation"})
	}
	p.assertTreeLimits(root)
	return root, nil
}

// ParseNotation applies input, AST depth and AST node limits from DiceLimits.
func ParseNotation(input string, limits DiceLimits) (*ExpressionNode, error) {
	if err := NewExecutionBudget(limits).AssertInputLength(input); err != nil {
		return nil, err
	}
	return ParseDiceNotation(input, DiceParserLimits{MaxDepth: limits.MaxAstDepth, MaxNodes: limits.MaxAstNodes})
}

func (p *diceNotationParser) current(offset ...int) SyntaxToken {
	i := p.cursor
	if len(offset) > 0 {
		i += offset[0]
	}
	if i >= len(p.tokens) {
		return p.tokens[len(p.tokens)-1]
	}
	return p.tokens[i]
}
func (p *diceNotationParser) consume() SyntaxToken { token := p.current(); p.cursor++; return token }
func (p *diceNotationParser) fail(message string, span SourceSpan, details map[string]any) {
	panic(syntaxInvalid(p.input, message, span, details))
}
func (p *diceNotationParser) failLimit(code string, limit, actual int64, span SourceSpan) {
	message := "AST node count exceeds the parser limit"
	if code == "AST_TOO_DEEP" {
		message = "AST depth exceeds the parser limit"
	}
	err := newDiceError(code, message, p.input, map[string]any{"limit": limit, "actual": actual})
	err.Span = &span
	panic(err)
}

// countedSyntaxNode unifies expression, modifier and comparison nodes only for
// iterative budget traversal; arithmetic tree operations remain strongly typed.
type countedSyntaxNode struct {
	expression *ExpressionNode
	modifier   *ModifierNode
	compare    *ComparePointNode
}

func (n countedSyntaxNode) span() SourceSpan {
	if n.expression != nil {
		return n.expression.Span
	}
	if n.modifier != nil {
		return n.modifier.Span
	}
	return n.compare.Span
}
func syntaxCountedChildren(n countedSyntaxNode) []countedSyntaxNode {
	children := []countedSyntaxNode{}
	add := func(node *ExpressionNode) {
		if node != nil {
			children = append(children, countedSyntaxNode{expression: node})
		}
	}
	addCompare := func(node *ComparePointNode) {
		if node != nil {
			children = append(children, countedSyntaxNode{compare: node})
		}
	}
	if e := n.expression; e != nil {
		switch e.Kind {
		case "unary":
			add(e.Operand)
		case "binary":
			add(e.Left)
			add(e.Right)
		case "parenthesized":
			add(e.Expression)
		case "function":
			for _, node := range e.Arguments {
				add(node)
			}
		case "dice":
			add(e.Quantity)
			if e.DiceKind == "standard" {
				add(e.Sides)
			}
			for _, modifier := range e.Modifiers {
				children = append(children, countedSyntaxNode{modifier: modifier})
			}
		case "group":
			for _, node := range e.Expressions {
				add(node)
			}
			for _, modifier := range e.Modifiers {
				children = append(children, countedSyntaxNode{modifier: modifier})
			}
		}
	} else if m := n.modifier; m != nil {
		switch m.Kind {
		case "explode", "reroll", "unique", "critical-success", "critical-failure":
			addCompare(m.Compare)
		case "target":
			addCompare(m.Success)
			addCompare(m.Failure)
		}
	}
	return children
}
func (p *diceNotationParser) assertTreeLimits(root *ExpressionNode) {
	type entry struct {
		node  countedSyntaxNode
		depth int64
	}
	pending := []entry{{node: countedSyntaxNode{expression: root}, depth: 1}}
	var count int64
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		count++
		if count > p.limits.MaxNodes {
			p.failLimit("TOO_MANY_NODES", p.limits.MaxNodes, count, current.node.span())
		}
		if current.depth > p.limits.MaxDepth {
			p.failLimit("AST_TOO_DEEP", p.limits.MaxDepth, current.depth, current.node.span())
		}
		children := syntaxCountedChildren(current.node)
		for i := len(children) - 1; i >= 0; i-- {
			pending = append(pending, entry{children[i], current.depth + 1})
		}
	}
}
func (p *diceNotationParser) attachStructuralModifiers(expression *ExpressionNode, modifiers []*ModifierNode) *ExpressionNode {
	allZero := true
	for _, modifier := range modifiers {
		if modifier.Kind != "pool-adjustment" || modifier.Delta != 0 {
			allZero = false
			break
		}
	}
	if allZero {
		return expression
	}
	dice := []*ExpressionNode{}
	pending := []countedSyntaxNode{{expression: expression}}
	for len(pending) > 0 {
		node := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if node.expression != nil && node.expression.Kind == "dice" {
			dice = append(dice, node.expression)
		}
		pending = append(pending, syntaxCountedChildren(node)...)
	}
	last := modifiers[len(modifiers)-1]
	if len(dice) != 1 {
		p.fail("Structural modifier needs one dice node", syntaxMergeSpan(modifiers[0].Span, last.Span), map[string]any{"reason": "ambiguous-structural-modifier-target", "diceCount": len(dice)})
	}
	dice[0].Modifiers = append(dice[0].Modifiers, modifiers...)
	copy := *expression
	copy.Span = syntaxMergeSpan(expression.Span, last.Span)
	copy.ID = CreateNodeID(copy.Kind, copy.Span)
	return &copy
}
func (p *diceNotationParser) expect(kind, expected string) SyntaxToken {
	token := p.current()
	if token.Kind != kind {
		p.fail(fmt.Sprintf("Expected %s at offset %d", expected, token.Span.Start), token.Span, map[string]any{"found": token.Lexeme, "expected": expected})
	}
	return p.consume()
}
func (p *diceNotationParser) isIdentifier(value string, offset ...int) bool {
	token := p.current(offset...)
	return token.Kind == "identifier" && token.Value == value
}
func (p *diceNotationParser) parseExpression(minimumPrecedence int) *ExpressionNode {
	p.recursionDepth++
	if p.recursionDepth > p.limits.MaxDepth {
		p.failLimit("AST_TOO_DEEP", p.limits.MaxDepth, p.recursionDepth, p.current().Span)
	}
	defer func() { p.recursionDepth-- }()
	left := p.parsePrefix()
	for {
		token := p.current()
		if token.Kind != "operator" {
			break
		}
		precedence := syntaxBinaryPrecedence[token.Value]
		if precedence < minimumPrecedence {
			break
		}
		p.consume()
		nextPrecedence := precedence + 1
		if token.Value == "^" || token.Value == "**" {
			nextPrecedence = precedence
		}
		right := p.parseExpression(nextPrecedence)
		node := syntaxExpression("binary", syntaxMergeSpan(left.Span, right.Span))
		node.Operator, node.Left, node.Right = token.Value, left, right
		left = node
	}
	return left
}
func (p *diceNotationParser) parsePrefix() *ExpressionNode {
	token := p.current()
	if token.Kind == "operator" && (token.Value == "+" || token.Value == "-") {
		p.consume()
		operand := p.parseExpression(25)
		node := syntaxExpression("unary", syntaxMergeSpan(token.Span, operand.Span))
		node.Operator, node.Operand = token.Value, operand
		return node
	}
	return p.parsePrimary()
}
func (p *diceNotationParser) parsePrimary() *ExpressionNode {
	token := p.current()
	switch token.Kind {
	case "number":
		return p.parseDiceSuffix(p.parseNumber(""))
	case "left-parenthesis":
		return p.parseDiceSuffix(p.parseParenthesized())
	case "left-brace":
		return p.parseGroup()
	case "identifier":
		if token.Value == "d" || token.Value == "dF" {
			return p.parseDice(nil)
		}
		if syntaxUnaryFunction(token.Value) || syntaxBinaryFunction(token.Value) {
			return p.parseFunction()
		}
	}
	p.fail(fmt.Sprintf("Expected an expression at offset %d", token.Span.Start), token.Span, map[string]any{"found": token.Lexeme, "expected": "number, dice, group, parenthesis, or function"})
	return nil
}
func (p *diceNotationParser) parseNumber(sign string) *ExpressionNode {
	var signToken SyntaxToken
	if sign != "" {
		signToken = p.tokens[p.cursor-1]
	}
	token := p.expect("number", "a number")
	span := token.Span
	if sign != "" {
		span = syntaxMergeSpan(signToken.Span, span)
	}
	node := syntaxExpression("number", span)
	node.Value, node.Raw = token.NumberValue, sign+token.Lexeme
	if sign == "-" {
		node.Value = -node.Value
	}
	return node
}
func (p *diceNotationParser) implicitOne(offset int) *ExpressionNode {
	node := syntaxExpression("number", SourceSpan{Start: offset, End: offset})
	node.ID = CreateNodeID("implicit-number", node.Span)
	node.Value, node.Raw, node.Implicit = 1, "1", true
	return node
}
func (p *diceNotationParser) parseParenthesized() *ExpressionNode {
	opening := p.expect("left-parenthesis", `"("`)
	expression := p.parseExpression(0)
	closing := p.expect("right-parenthesis", `")"`)
	node := syntaxExpression("parenthesized", syntaxMergeSpan(opening.Span, closing.Span))
	node.Expression = expression
	return node
}
func (p *diceNotationParser) parseDiceSuffix(quantity *ExpressionNode) *ExpressionNode {
	if p.isIdentifier("d") || p.isIdentifier("dF") {
		p.validateDiceArgument(quantity, "quantity")
		return p.parseDice(quantity)
	}
	return quantity
}
func (p *diceNotationParser) validateDiceArgument(argument *ExpressionNode, label string) {
	minimum, requirement := float64(1), "positive"
	if label == "sides" {
		minimum, requirement = 0, "non-negative"
	}
	if argument.Kind == "number" && (math.Trunc(argument.Value) != argument.Value || argument.Value < minimum || len(argument.Raw) > 1 && strings.HasPrefix(argument.Raw, "0")) {
		p.fail(fmt.Sprintf("Dice %s must be a %s integer", label, requirement), argument.Span, map[string]any{"value": argument.Value, "argument": label})
	}
}
func (p *diceNotationParser) parseDice(quantity *ExpressionNode) *ExpressionNode {
	marker := p.expect("identifier", "a dice marker")
	start := marker.Span
	if quantity == nil {
		quantity = p.implicitOne(marker.Span.Start)
	} else {
		start = quantity.Span
	}
	node := &ExpressionNode{Kind: "dice", Quantity: quantity}
	var coreEnd SourceSpan
	if marker.Value == "dF" {
		node.DiceKind, node.Variant = "fudge", 2
		coreEnd = marker.Span
		if p.current().Kind == "dot" {
			p.consume()
			variant := p.expect("number", "Fudge variant 1 or 2")
			if (variant.NumberValue != 1 && variant.NumberValue != 2) || len(variant.Lexeme) != 1 {
				p.fail("Fudge dice variant must be 1 or 2", variant.Span, map[string]any{"found": variant.Lexeme})
			}
			node.Variant = int(variant.NumberValue)
			coreEnd = variant.Span
		}
	} else if sideToken := p.current(); sideToken.Kind == "operator" && sideToken.Value == "%" {
		p.consume()
		node.DiceKind = "percentile"
		coreEnd = sideToken.Span
	} else {
		node.DiceKind = "standard"
		if p.current().Kind == "left-parenthesis" {
			node.Sides = p.parseParenthesized()
		} else {
			node.Sides = p.parseNumber("")
		}
		p.validateDiceArgument(node.Sides, "sides")
		coreEnd = node.Sides.Span
	}
	node.Modifiers = p.parseModifiers()
	if len(node.Modifiers) > 0 {
		coreEnd = node.Modifiers[len(node.Modifiers)-1].Span
	}
	node.Span = syntaxMergeSpan(start, coreEnd)
	node.ID = CreateNodeID("dice", node.Span)
	return node
}
func (p *diceNotationParser) parseFunction() *ExpressionNode {
	name := p.expect("identifier", "a function name")
	p.expect("left-parenthesis", `"("`)
	first := p.parseExpression(0)
	node := &ExpressionNode{Kind: "function", Name: name.Value, FunctionKind: "unary", Arguments: []*ExpressionNode{first}}
	if !syntaxUnaryFunction(name.Value) {
		node.FunctionKind = "binary"
		p.expect("comma", `","`)
		node.Arguments = append(node.Arguments, p.parseExpression(0))
	}
	closing := p.expect("right-parenthesis", `")"`)
	node.Span = syntaxMergeSpan(name.Span, closing.Span)
	node.ID = CreateNodeID("function", node.Span)
	return node
}
func (p *diceNotationParser) parseGroup() *ExpressionNode {
	opening := p.expect("left-brace", `"{"`)
	expressions := []*ExpressionNode{p.parseExpression(0)}
	for p.current().Kind == "comma" {
		p.consume()
		expressions = append(expressions, p.parseExpression(0))
	}
	closing := p.expect("right-brace", `"}"`)
	modifiers := p.parseModifiers()
	end := closing.Span
	if len(modifiers) > 0 {
		end = modifiers[len(modifiers)-1].Span
	}
	node := syntaxExpression("group", syntaxMergeSpan(opening.Span, end))
	node.Expressions, node.Modifiers = expressions, modifiers
	return node
}
func (p *diceNotationParser) isComparePointStart() bool {
	token := p.current()
	return token.Kind == "comparison" || token.Kind == "bang" && p.current(1).Kind == "comparison" && p.current(1).Lexeme == "="
}
func (p *diceNotationParser) parseComparePoint() *ComparePointNode {
	first := p.current()
	var operator string
	var span SourceSpan
	if first.Kind == "bang" {
		p.consume()
		equals := p.expect("comparison", `"=" after "!"`)
		operator, span = "!=", syntaxMergeSpan(first.Span, equals.Span)
	} else {
		comparison := p.expect("comparison", "a comparison operator")
		operator, span = comparison.Value, comparison.Span
	}
	sign := ""
	candidate := p.current()
	if candidate.Kind == "operator" && (candidate.Value == "+" || candidate.Value == "-") {
		sign = candidate.Value
		p.consume()
	}
	value := p.parseNumber(sign)
	span = syntaxMergeSpan(span, value.Span)
	return &ComparePointNode{Kind: "compare-point", ID: CreateNodeID("compare-point", span), Span: span, Operator: operator, Value: value.Value}
}
func (p *diceNotationParser) parseModifiers() []*ModifierNode {
	modifiers := []*ModifierNode{}
	for {
		modifier := p.parseModifier()
		if modifier == nil {
			return modifiers
		}
		modifiers = append(modifiers, modifier)
	}
}
func (p *diceNotationParser) parseStructuralModifiers() []*ModifierNode {
	modifiers := []*ModifierNode{}
	for {
		modifier := p.parseStructuralModifier()
		if modifier == nil {
			return modifiers
		}
		modifiers = append(modifiers, modifier)
	}
}
func (p *diceNotationParser) parseStructuralModifier() *ModifierNode {
	token := p.current()
	if token.Kind != "identifier" {
		return nil
	}
	switch token.Value {
	case "pool":
		return p.parseSignedStructuralAdjustment("pool-adjustment", "pool", "Pool adjustment")
	case "step":
		return p.parseSignedStructuralAdjustment("dice-step", "step", "Dice step")
	case "adv":
		return p.parsePoolSelection("highest")
	case "dis":
		return p.parsePoolSelection("lowest")
	}
	return nil
}
func (p *diceNotationParser) parseModifier() *ModifierNode {
	token := p.current()
	if structural := p.parseStructuralModifier(); structural != nil {
		return structural
	}
	if token.Kind == "bang" {
		return p.parseExplode()
	}
	if token.Kind == "comparison" {
		return p.parseTarget()
	}
	if token.Kind != "identifier" {
		return nil
	}
	switch token.Value {
	case "d":
		return p.parseDropKeep("drop")
	case "k":
		return p.parseDropKeep("keep")
	case "min", "max":
		return p.parseMinMax(token.Value)
	case "r":
		return p.parseRerollUnique("reroll")
	case "u":
		return p.parseRerollUnique("unique")
	case "cs":
		return p.parseCritical("critical-success")
	case "cf":
		return p.parseCritical("critical-failure")
	case "s":
		return p.parseSort()
	}
	return nil
}
func (p *diceNotationParser) parseExplode() *ModifierNode {
	first := p.expect("bang", `"!"`)
	node := &ModifierNode{Kind: "explode"}
	if p.current().Kind == "bang" {
		node.Compound = true
		p.consume()
	}
	if p.isIdentifier("p") {
		node.Penetrate = true
		p.consume()
	}
	limit := p.current()
	if limit.Kind == "number" {
		if !syntaxSafeInteger(limit.NumberValue) || limit.NumberValue < 1 || limit.Lexeme != syntaxNumberString(limit.NumberValue) {
			p.fail("Invalid explosion limit", limit.Span, map[string]any{})
		}
		value := limit.NumberValue
		node.MaxExplosions = &value
		p.consume()
	}
	if p.isComparePointStart() {
		node.Compare = p.parseComparePoint()
	}
	end := p.tokens[p.cursor-1].Span
	if node.Compare != nil {
		end = node.Compare.Span
	}
	node.Span = syntaxMergeSpan(first.Span, end)
	node.ID = CreateNodeID(node.Kind, node.Span)
	return node
}
func (p *diceNotationParser) parseTarget() *ModifierNode {
	success := p.parseComparePoint()
	var failure *ComparePointNode
	if p.isIdentifier("f") {
		p.consume()
		failure = p.parseComparePoint()
	}
	end := success.Span
	if failure != nil {
		end = failure.Span
	}
	node := syntaxModifier("target", syntaxMergeSpan(success.Span, end))
	node.Success, node.Failure = success, failure
	return node
}
func (p *diceNotationParser) parsePositiveInteger(label string) *ExpressionNode {
	value := p.parseNumber("")
	if math.Trunc(value.Value) != value.Value || value.Value < 1 || len(value.Raw) > 1 && strings.HasPrefix(value.Raw, "0") {
		p.fail(label+" must be a positive integer", value.Span, map[string]any{"value": value.Value})
	}
	return value
}
func (p *diceNotationParser) parseDropKeep(kind string) *ModifierNode {
	opening := p.consume()
	selection := "highest"
	if kind == "drop" {
		selection = "lowest"
	}
	if p.isIdentifier("l") {
		p.consume()
		selection = "lowest"
	} else if p.isIdentifier("h") {
		p.consume()
		selection = "highest"
	}
	quantity := p.parsePositiveInteger(kind + " quantity")
	node := syntaxModifier(kind, syntaxMergeSpan(opening.Span, quantity.Span))
	node.Selection, node.Quantity = selection, quantity.Value
	return node
}
func (p *diceNotationParser) parseSignedFloat() *ExpressionNode {
	token := p.current()
	if token.Kind == "operator" && (token.Value == "+" || token.Value == "-") {
		p.consume()
		return p.parseNumber(token.Value)
	}
	return p.parseNumber("")
}
func (p *diceNotationParser) parseMinMax(kind string) *ModifierNode {
	opening := p.consume()
	value := p.parseSignedFloat()
	node := syntaxModifier(kind, syntaxMergeSpan(opening.Span, value.Span))
	node.Value = value.Value
	return node
}
func (p *diceNotationParser) parseRerollUnique(kind string) *ModifierNode {
	opening := p.consume()
	once := false
	if p.isIdentifier("o") {
		once = true
		p.consume()
	}
	var compare *ComparePointNode
	if p.isComparePointStart() {
		compare = p.parseComparePoint()
	}
	end := p.tokens[p.cursor-1].Span
	if compare != nil {
		end = compare.Span
	}
	node := syntaxModifier(kind, syntaxMergeSpan(opening.Span, end))
	node.Once, node.Compare = once, compare
	return node
}
func (p *diceNotationParser) parseCritical(kind string) *ModifierNode {
	opening := p.consume()
	var compare *ComparePointNode
	if p.isComparePointStart() {
		compare = p.parseComparePoint()
	}
	end := opening.Span
	if compare != nil {
		end = compare.Span
	}
	node := syntaxModifier(kind, syntaxMergeSpan(opening.Span, end))
	node.Compare = compare
	return node
}
func (p *diceNotationParser) parseSort() *ModifierNode {
	opening := p.consume()
	direction, end := "ascending", opening.Span
	if p.isIdentifier("a") {
		end = p.consume().Span
	} else if p.isIdentifier("d") {
		direction = "descending"
		end = p.consume().Span
	}
	node := syntaxModifier("sort", syntaxMergeSpan(opening.Span, end))
	node.Direction = direction
	return node
}
func (p *diceNotationParser) parseSignedStructuralAdjustment(kind, keyword, label string) *ModifierNode {
	opening := p.consume()
	p.expect("left-parenthesis", `"(" after "`+keyword+`"`)
	sign := p.current()
	allowsZero := kind == "pool-adjustment"
	hasSign := sign.Kind == "operator" && (sign.Value == "+" || sign.Value == "-")
	unsignedZero := allowsZero && sign.Kind == "number" && sign.Lexeme == "0"
	if !hasSign && !unsignedZero {
		p.fail(label+" requires an explicit sign", sign.Span, map[string]any{"found": sign.Lexeme, "expected": `"+" or "-"`})
	}
	if hasSign {
		p.consume()
	}
	requirement := "non-zero safe integer"
	if allowsZero {
		requirement = "safe integer"
	}
	quantity := p.expect("number", "a "+requirement+" "+strings.ToLower(label))
	if !syntaxSafeInteger(quantity.NumberValue) || !allowsZero && quantity.NumberValue == 0 || quantity.Lexeme != syntaxNumberString(quantity.NumberValue) {
		p.fail(label+" must be a "+requirement, quantity.Span, map[string]any{"value": quantity.NumberValue})
	}
	closing := p.expect("right-parenthesis", `")" after `+strings.ToLower(label))
	node := syntaxModifier(kind, syntaxMergeSpan(opening.Span, closing.Span))
	node.Delta = quantity.NumberValue
	if node.Delta != 0 && hasSign && sign.Value == "-" {
		node.Delta = -node.Delta
	}
	return node
}
func (p *diceNotationParser) parsePoolSelection(selection string) *ModifierNode {
	token := p.consume()
	node := syntaxModifier("pool-selection", token.Span)
	node.Selection = selection
	return node
}
