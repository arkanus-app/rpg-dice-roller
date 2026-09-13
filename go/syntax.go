package dicecore

import (
	"encoding/json"
	"fmt"
)

// ExpressionNode is one node in the dice expression tree. Kind determines the
// active fields; children are pointers so structural modifiers retain their target.
type ExpressionNode struct {
	Kind         string
	ID           string
	Span         SourceSpan
	Value        float64
	Raw          string
	Implicit     bool
	Operator     string
	Operand      *ExpressionNode
	Left         *ExpressionNode
	Right        *ExpressionNode
	Expression   *ExpressionNode
	FunctionKind string
	Name         string
	Arguments    []*ExpressionNode
	DiceKind     string
	Quantity     *ExpressionNode
	Sides        *ExpressionNode
	Variant      int
	Expressions  []*ExpressionNode
	Modifiers    []*ModifierNode
}

type SyntaxTree = ExpressionNode

// ComparePointNode retains the comparison's original source span.
type ComparePointNode struct {
	Kind     string     `json:"kind"`
	ID       string     `json:"id"`
	Span     SourceSpan `json:"span"`
	Operator string     `json:"operator"`
	Value    float64    `json:"value"`
}

// ModifierNode represents runtime and structural modifiers in source order.
type ModifierNode struct {
	Kind          string
	ID            string
	Span          SourceSpan
	Compound      bool
	Penetrate     bool
	MaxExplosions *float64
	Compare       *ComparePointNode
	Success       *ComparePointNode
	Failure       *ComparePointNode
	Selection     string
	Quantity      float64
	Value         float64
	Once          bool
	Direction     string
	Delta         float64
}

func CreateNodeID(kind string, span SourceSpan) string {
	return fmt.Sprintf("%s@%d:%d", kind, span.Start, span.End)
}

// JSON.stringify canonicalizes negative zero even though the in-memory AST keeps it.
func syntaxJSONNumber(value float64) float64 {
	if value == 0 {
		return 0
	}
	return value
}

func (n ComparePointNode) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{
		"kind": n.Kind, "id": n.ID, "span": n.Span,
		"operator": n.Operator, "value": syntaxJSONNumber(n.Value),
	})
}

func (n ExpressionNode) MarshalJSON() ([]byte, error) {
	m := map[string]any{"kind": n.Kind, "id": n.ID, "span": n.Span}
	switch n.Kind {
	case "number":
		m["value"], m["raw"], m["implicit"] = syntaxJSONNumber(n.Value), n.Raw, n.Implicit
	case "unary":
		m["operator"], m["operand"] = n.Operator, n.Operand
	case "binary":
		m["operator"], m["left"], m["right"] = n.Operator, n.Left, n.Right
	case "parenthesized":
		m["expression"] = n.Expression
	case "function":
		m["functionKind"], m["name"], m["arguments"] = n.FunctionKind, n.Name, n.Arguments
	case "dice":
		m["diceKind"], m["quantity"], m["modifiers"] = n.DiceKind, n.Quantity, n.Modifiers
		if n.DiceKind == "standard" {
			m["sides"] = n.Sides
		}
		if n.DiceKind == "fudge" {
			m["variant"] = n.Variant
		}
	case "group":
		m["expressions"], m["modifiers"] = n.Expressions, n.Modifiers
	}
	return json.Marshal(m)
}

func (n ModifierNode) MarshalJSON() ([]byte, error) {
	m := map[string]any{"kind": n.Kind, "id": n.ID, "span": n.Span}
	switch n.Kind {
	case "explode":
		m["compound"], m["penetrate"], m["maxExplosions"], m["compare"] = n.Compound, n.Penetrate, n.MaxExplosions, n.Compare
	case "target":
		m["success"], m["failure"] = n.Success, n.Failure
	case "drop", "keep":
		m["selection"], m["quantity"] = n.Selection, n.Quantity
	case "min", "max":
		m["value"] = syntaxJSONNumber(n.Value)
	case "reroll", "unique":
		m["once"], m["compare"] = n.Once, n.Compare
	case "critical-success", "critical-failure":
		m["compare"] = n.Compare
	case "sort":
		m["direction"] = n.Direction
	case "pool-adjustment", "dice-step":
		m["delta"] = n.Delta
	case "pool-selection":
		m["selection"] = n.Selection
	}
	return json.Marshal(m)
}

// SyntaxToken uses NumberValue for numbers and Value for identifiers/operators.
type SyntaxToken struct {
	Kind        string
	Lexeme      string
	Value       string
	NumberValue float64
	Span        SourceSpan
}

func (t SyntaxToken) MarshalJSON() ([]byte, error) {
	m := map[string]any{"kind": t.Kind, "lexeme": t.Lexeme, "span": t.Span}
	if t.Kind == "number" {
		m["value"] = t.NumberValue
	} else if t.Value != "" {
		m["value"] = t.Value
	}
	return json.Marshal(m)
}
