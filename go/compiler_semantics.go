package dicecore

import (
	"math"
	"math/big"
)

type compilerPool struct {
	quantity  int64
	modifiers []*ModifierNode
	stepDelta *big.Int
	stepSpan  *SourceSpan
}

func invalidCompilerPool(input string, node *ExpressionNode, reason string, details map[string]any) {
	message := "Pool transformation exceeds the safe dice quantity range"
	if reason == "conflicting-selection" {
		message = "Pool advantage or disadvantage cannot be combined with keep or drop"
	}
	details["reason"] = reason
	compilerFail("UNSUPPORTED_NOTATION", message, input, &node.Span, details)
}

func resolveCompilerPool(node *ExpressionNode, baseQuantity int64, input string) compilerPool {
	adjustedPool := float64(baseQuantity)
	selectionBalance := float64(0)
	var structuralSpan *SourceSpan
	result := compilerPool{modifiers: []*ModifierNode{}, stepDelta: new(big.Int)}
	for _, modifier := range node.Modifiers {
		switch modifier.Kind {
		case "pool-adjustment":
			next := adjustedPool + modifier.Delta
			if !syntaxSafeInteger(next) {
				invalidCompilerPool(input, node, "unsafe-pool-balance", map[string]any{"baseQuantity": baseQuantity, "delta": modifier.Delta})
			}
			adjustedPool = next
			structuralSpan = &modifier.Span
		case "pool-selection":
			if modifier.Selection == "highest" {
				selectionBalance++
			} else {
				selectionBalance--
			}
			structuralSpan = &modifier.Span
		case "dice-step":
			result.stepDelta.Add(result.stepDelta, big.NewInt(int64(modifier.Delta)))
			if result.stepSpan == nil {
				span := modifier.Span
				result.stepSpan = &span
			} else {
				result.stepSpan.End = modifier.Span.End
			}
		default:
			result.modifiers = append(result.modifiers, modifier)
		}
	}
	keptQuantity := math.Max(1, adjustedPool)
	effectiveSelection := selectionBalance + math.Min(0, adjustedPool-1)
	quantity := keptQuantity + math.Abs(effectiveSelection)
	if !syntaxSafeInteger(quantity) {
		invalidCompilerPool(input, node, "unsafe-pool-balance", map[string]any{"adjustedPool": adjustedPool, "selectionBalance": selectionBalance})
	}
	if effectiveSelection != 0 {
		for _, modifier := range result.modifiers {
			if modifier.Kind == "keep" || modifier.Kind == "drop" {
				invalidCompilerPool(input, node, "conflicting-selection", map[string]any{"modifier": modifier.Kind})
			}
		}
		selection := "lowest"
		if effectiveSelection > 0 {
			selection = "highest"
		}
		result.modifiers = append(result.modifiers, &ModifierNode{Kind: "keep", ID: CreateNodeID("keep", *structuralSpan), Span: *structuralSpan, Selection: selection, Quantity: keptQuantity})
	}
	result.quantity = int64(quantity)
	return result
}

func serializedCompilerStep(delta *big.Int) any {
	if delta.IsInt64() && delta.Int64() >= -maxSafeInteger && delta.Int64() <= maxSafeInteger {
		return delta.Int64()
	}
	return delta.String()
}

func invalidCompilerStep(input string, span *SourceSpan, reason string, details map[string]any) {
	message := "Dice step requires a standard numeric die"
	if reason == "dice-step-out-of-range" {
		message = "Dice step exceeds the supported side ladder"
	}
	details["reason"] = reason
	compilerFail("UNSUPPORTED_NOTATION", message, input, span, details)
}

func resolveCompilerSteppedSides(base int64, delta *big.Int, input string, span *SourceSpan) int64 {
	if delta.Sign() == 0 {
		return base
	}
	ladder := []int64{2, 4, 6, 8, 10, 12, 20, 100}
	candidates := []int64{}
	if delta.Sign() > 0 {
		for _, side := range ladder {
			if side > base {
				candidates = append(candidates, side)
			}
		}
	} else {
		for i := len(ladder) - 1; i >= 0; i-- {
			if ladder[i] < base {
				candidates = append(candidates, ladder[i])
			}
		}
	}
	distance := new(big.Int).Abs(delta)
	if distance.Cmp(big.NewInt(int64(len(candidates)))) > 0 {
		invalidCompilerStep(input, span, "dice-step-out-of-range", map[string]any{"baseSides": base, "delta": serializedCompilerStep(delta), "ladderMinimum": 2, "ladderMaximum": 100})
	}
	return candidates[int(distance.Int64())-1]
}

type compilerNumericRange struct {
	minimum, maximum float64
	integersOnly     bool
}

func comparisonAlwaysMatchesRange(compare *ComparePointNode, minimum, maximum float64, integersOnly bool) bool {
	switch compare.Operator {
	case "=":
		return minimum == maximum && minimum == compare.Value
	case "!=", "<>":
		return (integersOnly && math.Trunc(compare.Value) != compare.Value) || compare.Value < minimum || compare.Value > maximum
	case "<":
		return maximum < compare.Value
	case "<=":
		return maximum <= compare.Value
	case ">":
		return minimum > compare.Value
	case ">=":
		return minimum >= compare.Value
	}
	return false
}

func comparisonCanMatchRange(compare *ComparePointNode, r compilerNumericRange) bool {
	switch compare.Operator {
	case "=":
		return (!r.integersOnly || math.Trunc(compare.Value) == compare.Value) && compare.Value >= r.minimum && compare.Value <= r.maximum
	case "!=", "<>":
		return r.minimum != r.maximum || r.minimum != compare.Value
	case "<":
		return r.minimum < compare.Value
	case "<=":
		return r.minimum <= compare.Value
	case ">":
		return r.maximum > compare.Value
	case ">=":
		return r.maximum >= compare.Value
	}
	return false
}

func rangeCanMatch(r compilerNumericRange, compare *ComparePointNode, defaultValue float64) bool {
	if compare == nil {
		return defaultValue >= r.minimum && defaultValue <= r.maximum && (!r.integersOnly || math.Trunc(defaultValue) == defaultValue)
	}
	return comparisonCanMatchRange(compare, r)
}

func rangeAlwaysMatches(r compilerNumericRange, compare *ComparePointNode, defaultValue float64) bool {
	if compare == nil {
		return r.minimum == r.maximum && r.minimum == defaultValue
	}
	return comparisonAlwaysMatchesRange(compare, r.minimum, r.maximum, r.integersOnly)
}

func applyCompilerLimitToRange(r compilerNumericRange, limit float64, clamp func(float64, float64) float64) compilerNumericRange {
	minimum, maximum := clamp(r.minimum, limit), clamp(r.maximum, limit)
	if minimum == r.minimum && maximum == r.maximum {
		return r
	}
	return compilerNumericRange{minimum, maximum, r.integersOnly && math.Trunc(limit) == limit}
}

func compilerValueMatches(value float64, compare *ComparePointNode, defaultValue float64) bool {
	if compare == nil {
		return value == defaultValue
	}
	return CompareValues(compare.Operator, value, compare.Value)
}

// Ordered values preserve JS Set traversal while bounding semantic analysis.
// Go map iteration alone would change where the shared transition budget ends.
type compilerValueSet struct {
	values  []float64
	present map[float64]bool
}

func newCompilerValueSet() *compilerValueSet { return &compilerValueSet{present: map[float64]bool{}} }
func (s *compilerValueSet) add(value float64) {
	if !s.present[value] {
		s.present[value] = true
		s.values = append(s.values, value)
	}
}

func enumerateCompilerFaces(minimum, maximum, possibleValues int64) *compilerValueSet {
	if possibleValues > 4096 {
		return nil
	}
	values := newCompilerValueSet()
	for value := minimum; value <= maximum; value++ {
		values.add(float64(value))
	}
	return values
}

func mapCompilerValues(values *compilerValueSet, transform func(float64) float64) *compilerValueSet {
	if values == nil {
		return nil
	}
	result := newCompilerValueSet()
	for _, value := range values.values {
		result.add(transform(value))
	}
	return result
}

func unionCompilerValues(sets ...*compilerValueSet) *compilerValueSet {
	result := newCompilerValueSet()
	for _, values := range sets {
		if values == nil {
			return nil
		}
		for _, value := range values.values {
			result.add(value)
			if len(result.values) > 4096 {
				return nil
			}
		}
	}
	return result
}

func compilerSemanticLimit(input string, modifier *ModifierNode) {
	compilerFail("UNSUPPORTED_NOTATION", "Unsupported interaction", input, &modifier.Span, map[string]any{"reason": "semantic-analysis-limit"})
}
func anyCompilerValueMatches(values *compilerValueSet, compare *ComparePointNode, defaultValue float64) bool {
	for _, value := range values.values {
		if compilerValueMatches(value, compare, defaultValue) {
			return true
		}
	}
	return false
}
func everyCompilerValueMatches(values *compilerValueSet, compare *ComparePointNode, defaultValue float64) bool {
	for _, value := range values.values {
		if !compilerValueMatches(value, compare, defaultValue) {
			return false
		}
	}
	return true
}

func analyzeCompilerCompound(root, raw *compilerValueSet, modifier *ModifierNode, maxExplosions int64, maximum float64, budget *int64) *compilerValueSet {
	if root == nil || raw == nil {
		return nil
	}
	outcomes, pending := newCompilerValueSet(), newCompilerValueSet()
	for _, value := range root.values {
		if compilerValueMatches(value, modifier.Compare, maximum) {
			pending.add(value)
		} else {
			outcomes.add(value)
		}
	}
	for depth := int64(1); depth <= maxExplosions; depth++ {
		next := newCompilerValueSet()
		for _, sum := range pending.values {
			for _, rawValue := range raw.values {
				*budget--
				if *budget < 0 {
					return nil
				}
				stored := rawValue
				if modifier.Penetrate {
					stored--
				}
				nextSum := sum + stored
				if depth == maxExplosions || !compilerValueMatches(rawValue, modifier.Compare, maximum) {
					outcomes.add(nextSum)
				} else {
					next.add(nextSum)
				}
				if len(outcomes.values)+len(next.values) > 4096 {
					return nil
				}
			}
		}
		pending = next
		if len(pending.values) == 0 {
			break
		}
	}
	return outcomes
}

func createCompilerDiceSpec(node *ExpressionNode, input string, limits DiceLimits, constants map[string]float64, semanticBudget *int64) *CompiledDiceSpec {
	baseQuantity := readCompilerDiceInteger(node.Quantity, input, "quantity", constants)
	pool := resolveCompilerPool(node, baseQuantity, input)
	spec := &CompiledDiceSpec{NodeID: node.ID, Quantity: pool.quantity}
	if node.DiceKind == "standard" {
		baseSides := readCompilerDiceInteger(node.Sides, input, "sides", constants)
		span := pool.stepSpan
		if span == nil {
			span = &node.Sides.Span
		}
		sides := resolveCompilerSteppedSides(baseSides, pool.stepDelta, input, span)
		if sides > limits.MaxSides {
			compilerFail("DICE_SIDES_LIMIT_EXCEEDED", "Dice sides exceed the configured limit", input, &node.Sides.Span, map[string]any{"sides": sides, "limit": limits.MaxSides})
		}
		spec.Sides = sides
		spec.Minimum = 1
		if sides == 0 {
			spec.Minimum = 0
		}
		spec.Maximum = sides
		spec.PossibleFaces = max(1, sides)
	} else {
		if pool.stepDelta.Sign() != 0 {
			invalidCompilerStep(input, pool.stepSpan, "dice-step-non-standard-die", map[string]any{"diceKind": node.DiceKind, "delta": serializedCompilerStep(pool.stepDelta)})
		}
		if node.DiceKind == "percentile" {
			spec.Sides = int64(100)
			spec.Minimum = 1
			spec.Maximum = 100
			spec.PossibleFaces = 100
		} else {
			spec.Sides = "F"
			spec.Minimum = -1
			spec.Maximum = 1
			spec.PossibleFaces = 3
		}
	}
	spec.Modifiers = OrderCompiledModifiers(pool.modifiers)
	var capped *ModifierNode
	for _, modifier := range spec.Modifiers {
		if modifier.Kind == "explode" && modifier.MaxExplosions != nil {
			capped = modifier
			break
		}
	}
	needsAnalysis := false
	if capped != nil {
		for _, modifier := range spec.Modifiers {
			if (modifier.Kind == "reroll" && !modifier.Once) || (modifier.Kind == "unique" && !modifier.Once && (!capped.Compound || spec.Quantity > 1)) {
				needsAnalysis = true
			}
		}
	}
	var rawValues *compilerValueSet
	if needsAnalysis {
		rawValues = enumerateCompilerFaces(spec.Minimum, spec.Maximum, spec.PossibleFaces)
	}
	rawRange := compilerNumericRange{float64(spec.Minimum), float64(spec.Maximum), true}
	rootValues := rawValues
	var childValues *compilerValueSet
	if rawValues != nil {
		childValues = newCompilerValueSet()
	}
	rootRange := rawRange
	guaranteedDice := spec.Quantity
	unchangedMinimum, unchangedMaximum := float64(spec.Minimum), float64(spec.Maximum)
	for _, modifier := range spec.Modifiers {
		switch modifier.Kind {
		case "min":
			unchangedMinimum = math.Max(unchangedMinimum, math.Ceil(modifier.Value))
			rootValues = mapCompilerValues(rootValues, func(v float64) float64 { return math.Max(v, modifier.Value) })
			rootRange = applyCompilerLimitToRange(rootRange, modifier.Value, math.Max)
		case "max":
			unchangedMaximum = math.Min(unchangedMaximum, math.Floor(modifier.Value))
			rootValues = mapCompilerValues(rootValues, func(v float64) float64 { return math.Min(v, modifier.Value) })
			rootRange = applyCompilerLimitToRange(rootRange, modifier.Value, math.Min)
		case "explode":
			rawAlways := rangeAlwaysMatches(rawRange, modifier.Compare, float64(spec.Maximum))
			if modifier.MaxExplosions == nil {
				if rawAlways {
					compilerFail("NON_TERMINATING_MODIFIER", "Explode modifier cannot terminate for this die", input, &modifier.Span, map[string]any{"reason": "non-terminating-explode", "minimum": spec.Minimum, "maximum": spec.Maximum})
				}
				continue
			}
			maximumExplosions := int64(*modifier.MaxExplosions)
			rootCan := false
			if rootValues == nil {
				rootCan = rangeCanMatch(rootRange, modifier.Compare, float64(spec.Maximum))
			} else {
				rootCan = anyCompilerValueMatches(rootValues, modifier.Compare, float64(spec.Maximum))
			}
			if modifier.Compound {
				if !rootCan {
					continue
				}
				rootValues = analyzeCompilerCompound(rootValues, rawValues, modifier, maximumExplosions, float64(spec.Maximum), semanticBudget)
				childValues = nil
				if rootValues != nil {
					childValues = newCompilerValueSet()
				}
				unchangedAlways := false
				if modifier.Compare == nil {
					unchangedAlways = unchangedMinimum == unchangedMaximum && unchangedMinimum == float64(spec.Maximum)
				} else {
					unchangedAlways = comparisonAlwaysMatchesRange(modifier.Compare, unchangedMinimum, unchangedMaximum, true)
				}
				if unchangedMinimum <= unchangedMaximum && unchangedAlways {
					unchangedMinimum = unchangedMaximum + 1
				}
			} else {
				penetration := float64(0)
				if modifier.Penetrate {
					penetration = 1
				}
				if rootCan {
					childValues = mapCompilerValues(rawValues, func(v float64) float64 { return v - penetration })
				} else {
					childValues = nil
					if rootValues != nil {
						childValues = newCompilerValueSet()
					}
				}
				rootAlways := false
				if rootValues == nil {
					rootAlways = rangeAlwaysMatches(rootRange, modifier.Compare, float64(spec.Maximum))
				} else {
					rootAlways = everyCompilerValueMatches(rootValues, modifier.Compare, float64(spec.Maximum))
				}
				if rootAlways {
					guaranteed := int64(1)
					if rawAlways {
						guaranteed = maximumExplosions
					}
					guaranteedDice = saturatingAdd(guaranteedDice, saturatingMultiply(spec.Quantity, guaranteed))
				}
			}
		case "reroll":
			rawAlways := rangeAlwaysMatches(rawRange, modifier.Compare, float64(spec.Minimum))
			current := unionCompilerValues(rootValues, childValues)
			currentCan := current != nil && anyCompilerValueMatches(current, modifier.Compare, float64(spec.Minimum))
			if !modifier.Once && rawAlways && (!needsAnalysis || currentCan || unchangedMinimum <= unchangedMaximum) {
				compilerFail("NON_TERMINATING_MODIFIER", "Reroll modifier cannot terminate for this die", input, &modifier.Span, map[string]any{"reason": "non-terminating-reroll", "minimum": spec.Minimum, "maximum": spec.Maximum})
			}
			if !modifier.Once && rawAlways && needsAnalysis && current == nil {
				compilerSemanticLimit(input, modifier)
			}
			if needsAnalysis && rawValues != nil {
				if rootValues != nil && anyCompilerValueMatches(rootValues, modifier.Compare, float64(spec.Minimum)) {
					rootValues = unionCompilerValues(rootValues, rawValues)
				}
				if childValues != nil && anyCompilerValueMatches(childValues, modifier.Compare, float64(spec.Minimum)) {
					childValues = unionCompilerValues(childValues, rawValues)
				}
			}
		case "unique":
			impossibleQuantity, uniqueCount := int64(-1), int64(-1)
			if !modifier.Once && needsAnalysis && guaranteedDice > 1 {
				if rawValues == nil || rootValues == nil || childValues == nil {
					compilerSemanticLimit(input, modifier)
				}
				rootUnique := unionCompilerValues(rootValues, rawValues)
				guaranteedChildren := max(0, guaranteedDice-spec.Quantity)
				childUnique := unionCompilerValues(childValues, rawValues)
				allUnique := unionCompilerValues(rootValues, childValues, rawValues)
				if rootUnique == nil || childUnique == nil || allUnique == nil {
					compilerSemanticLimit(input, modifier)
				}
				if spec.Quantity > int64(len(rootUnique.values)) && (modifier.Compare == nil || everyCompilerValueMatches(rootUnique, modifier.Compare, float64(spec.Minimum))) {
					impossibleQuantity = spec.Quantity
					uniqueCount = int64(len(rootUnique.values))
				} else if guaranteedChildren > int64(len(childUnique.values)) && (modifier.Compare == nil || everyCompilerValueMatches(childUnique, modifier.Compare, float64(spec.Minimum))) {
					impossibleQuantity = guaranteedChildren
					uniqueCount = int64(len(childUnique.values))
				} else if guaranteedDice > int64(len(allUnique.values)) && (modifier.Compare == nil || everyCompilerValueMatches(allUnique, modifier.Compare, float64(spec.Minimum))) {
					impossibleQuantity = guaranteedDice
					uniqueCount = int64(len(allUnique.values))
				}
			} else if !modifier.Once && !needsAnalysis && spec.Quantity > spec.PossibleFaces && (modifier.Compare == nil || comparisonAlwaysMatchesRange(modifier.Compare, float64(spec.Minimum), float64(spec.Maximum), true)) {
				impossibleQuantity = spec.Quantity
				uniqueCount = spec.PossibleFaces
			}
			if impossibleQuantity >= 0 && uniqueCount >= 0 {
				compilerFail("IMPOSSIBLE_UNIQUE", "Unique modifier cannot produce enough distinct faces", input, &modifier.Span, map[string]any{"reason": "impossible-unique", "quantity": impossibleQuantity, "possibleFaces": uniqueCount})
			}
		}
	}
	return spec
}
