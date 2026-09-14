package dicecore

import (
	"fmt"
	"runtime"
	"slices"
	"strconv"
	"strings"
)

type ExecuteRollPlanOptions struct {
	Limits          DiceLimits
	Seed            any
	Replay          any
	RandomAlgorithm RandomAlgorithm
}

type workingDie struct {
	ResolvedDie
	active bool
}
type workingGroup struct{ ResolvedGroup }
type rollEvaluation struct {
	value     float64
	rendered  string
	groupID   string
	diceRange EntityRange
}
type groupItem struct {
	evaluation rollEvaluation
	value      float64
	included   bool
}
type rollState struct {
	context      *ExecutionContext
	plan         *RollPlan
	program      *CompiledDiceProgram
	rollIndex    int64
	dice         []*workingDie
	groups       []*workingGroup
	groupByID    map[string]*workingGroup
	renderOutput bool
	nextDieIndex int64
	dieArena     []workingDie
	dieArenaUsed int
	initialDice  int64
}

func executorCheck(err error) {
	if err != nil {
		panic(err)
	}
}
func executorValue[T any](value T, err error) T { executorCheck(err); return value }
func recoverExecutor[T any](value **T, err *error) {
	if failure := recover(); failure != nil {
		if _, bug := failure.(runtime.Error); bug {
			panic(failure)
		}
		if failureError, ok := failure.(error); ok {
			*value = nil
			*err = failureError
		} else {
			panic(failure)
		}
	}
}
func resolvedGroupID(node *ExpressionNode, rollIndex int64) string {
	return "roll-" + strconv.FormatInt(rollIndex, 10) + ":group:" + node.ID
}
func executorNotation(state *rollState, node *ExpressionNode) string {
	units := syntaxUnits(state.plan.Notation)
	return syntaxString(units[node.Span.Start:node.Span.End])
}
func appendDieState(die *workingDie, state string) {
	if !slices.Contains(die.States, state) {
		die.States = append(die.States, state)
	}
}
func syncDieContribution(die *workingDie) {
	die.Contribution = 0
	if die.active && die.Included {
		die.Contribution = die.Value
	}
}
func executorCompare(point *ComparePointNode, value float64) bool {
	return CompareValues(point.Operator, value, point.Value)
}
func executorRollFace(node *ExpressionNode, spec *CompiledDiceSpec, context *ExecutionContext) float64 {
	switch node.DiceKind {
	case "standard":
		return float64(executorValue(context.Random.Integer(spec.Minimum, spec.Maximum)))
	case "percentile":
		return float64(executorValue(context.Random.Integer(1, 100)))
	default:
		if node.Variant == 2 {
			return float64(executorValue(context.Random.Integer(1, 3))) - 2
		}
		value := executorValue(context.Random.Integer(1, 6))
		if value == 1 {
			return -1
		}
		if value == 6 {
			return 1
		}
		return 0
	}
}
func createWorkingDie(node *ExpressionNode, spec *CompiledDiceSpec, state *rollState, groupID string, parent *string, generated bool) *workingDie {
	if generated {
		executorCheck(state.context.Budget.ConsumeGeneratedDice(1))
	} else {
		executorCheck(state.context.Budget.ConsumeInitialDice(1))
	}
	executorCheck(state.context.Budget.ConsumeResultItems(1))
	state.nextDieIndex++
	value := executorRollFace(node, spec, state.context)
	var die *workingDie
	if generated {
		die = &workingDie{}
	} else {
		if state.dieArenaUsed == len(state.dieArena) {
			budget := state.context.Budget
			capacity := min(max(int64(1), state.program.StaticDice-state.initialDice), 256,
				budget.limits.MaxInitialDice-budget.snapshot.InitialDice+1,
				budget.limits.MaxResultItems-budget.snapshot.ResultItems+1)
			// Chunks keep retained pointers stable and reserve only known initial
			// dice. Generated dice allocate individually instead of reserving an
			// uncertain explosion tail. Both budgets already accepted this draw.
			state.dieArena = make([]workingDie, capacity)
			state.dieArenaUsed = 0
		}
		die = &state.dieArena[state.dieArenaUsed]
		state.dieArenaUsed++
		state.initialDice++
	}
	*die = workingDie{ResolvedDie: ResolvedDie{ID: "roll-" + strconv.FormatInt(state.rollIndex, 10) + "-die-" + strconv.FormatInt(state.nextDieIndex, 10), SourceNodeID: node.ID, ParentDieID: parent, RollIndex: state.rollIndex, GroupID: groupID, Sides: spec.Sides, RawValue: value, Value: value, Contribution: value, Included: true, States: []string{}}, active: true}
	state.dice = append(state.dice, die)
	if state.context.Journal.materialize {
		recordDieEvent(state, die, "roll", DiceEvent{"value": value})
	} else {
		executorValue(state.context.Journal.Record(nil))
	}
	return die
}
func recordDieEvent(state *rollState, die *workingDie, kind string, fields DiceEvent) {
	if !state.context.Journal.materialize {
		executorValue(state.context.Journal.Record(nil))
		return
	}
	var parentID any
	if die.ParentDieID != nil {
		parentID = *die.ParentDieID
	}
	event := DiceEvent{"type": kind, "subject": "die", "dieId": die.ID, "parentDieId": parentID, "rollIndex": state.rollIndex, "sourceNodeId": die.SourceNodeID}
	for key, value := range fields {
		event[key] = value
	}
	executorValue(state.context.Journal.record(event, true))
}
func recordGroupEvent(state *rollState, group *workingGroup, kind string, fields DiceEvent) {
	if !state.context.Journal.materialize {
		executorValue(state.context.Journal.Record(nil))
		return
	}
	event := DiceEvent{"type": kind, "subject": "group", "groupId": group.ID, "rollIndex": state.rollIndex, "sourceNodeId": group.SourceNodeID}
	for key, value := range fields {
		event[key] = value
	}
	executorValue(state.context.Journal.record(event, true))
}
func applyDieBound(dice []*workingDie, bound float64, minimum bool, state *rollState) {
	for _, die := range dice {
		if !die.active || minimum && die.Value >= bound || !minimum && die.Value <= bound {
			continue
		}
		from := die.Value
		die.Value = bound
		reason := "maximum"
		if minimum {
			reason = "minimum"
		}
		appendDieState(die, reason)
		syncDieContribution(die)
		recordDieEvent(state, die, "transform", DiceEvent{"from": from, "to": die.Value, "reason": reason})
	}
}
func activeWorkingDice(dice []*workingDie) []*workingDie {
	active := []*workingDie{}
	for _, die := range dice {
		if die.active {
			active = append(active, die)
		}
	}
	return active
}
func applyDieExplode(dice *[]*workingDie, modifier *ModifierNode, node *ExpressionNode, spec *CompiledDiceSpec, state *rollState) {
	for _, root := range activeWorkingDice(*dice) {
		current := root
		compareValue := current.Value
		explosionCount := float64(0)
		chain := []*workingDie{root}
		for {
			if modifier.MaxExplosions != nil && explosionCount >= *modifier.MaxExplosions {
				break
			}
			matches := compareValue == float64(spec.Maximum)
			if modifier.Compare != nil {
				matches = executorCompare(modifier.Compare, compareValue)
			}
			if !matches {
				break
			}
			executorCheck(state.context.Budget.ConsumeModifierSteps(1))
			appendDieState(current, "exploded")
			if modifier.Penetrate {
				appendDieState(current, "penetrated")
			}
			parent := current.ID
			child := createWorkingDie(node, spec, state, current.GroupID, &parent, true)
			compareValue = child.Value
			if modifier.Penetrate {
				from := child.Value
				child.Value--
				appendDieState(child, "penetrated")
				syncDieContribution(child)
				recordDieEvent(state, child, "transform", DiceEvent{"from": from, "to": child.Value, "reason": "penetrate"})
			}
			*dice = append(*dice, child)
			chain = append(chain, child)
			reason := "explode"
			if modifier.Penetrate {
				reason = "penetrate"
			} else if modifier.Compound {
				reason = "compound"
			}
			recordDieEvent(state, current, "explode", DiceEvent{"childDieId": child.ID, "value": child.Value, "reason": reason})
			current = child
			explosionCount++
		}
		if modifier.Compound && len(chain) > 1 {
			from := root.Value
			total := float64(0)
			for _, die := range chain {
				total += die.Value
			}
			root.Value = total
			appendDieState(root, "compound")
			syncDieContribution(root)
			recordDieEvent(state, root, "transform", DiceEvent{"from": from, "to": root.Value, "reason": "compound"})
			for _, child := range chain[1:] {
				child.active = false
				child.Included = false
				syncDieContribution(child)
				recordDieEvent(state, child, "exclude", DiceEvent{"reason": "compound-absorbed"})
			}
		}
	}
}
func applyDieReroll(dice []*workingDie, modifier *ModifierNode, node *ExpressionNode, spec *CompiledDiceSpec, state *rollState) {
	for _, die := range dice {
		if !die.active {
			continue
		}
		for {
			matches := die.Value == float64(spec.Minimum)
			if modifier.Compare != nil {
				matches = executorCompare(modifier.Compare, die.Value)
			}
			if !matches {
				break
			}
			executorCheck(state.context.Budget.ConsumeModifierSteps(1))
			from := die.Value
			die.Value = executorRollFace(node, spec, state.context)
			appendDieState(die, "rerolled")
			syncDieContribution(die)
			reason := "reroll"
			if modifier.Once {
				reason = "reroll-once"
			}
			recordDieEvent(state, die, "reroll", DiceEvent{"from": from, "to": die.Value, "reason": reason})
			if modifier.Once {
				break
			}
		}
	}
}
func applyDieUnique(dice []*workingDie, modifier *ModifierNode, node *ExpressionNode, spec *CompiledDiceSpec, state *rollState) {
	seen := map[float64]bool{}
	for _, die := range activeWorkingDice(dice) {
		for {
			if !seen[die.Value] || modifier.Compare != nil && !executorCompare(modifier.Compare, die.Value) {
				break
			}
			executorCheck(state.context.Budget.ConsumeModifierSteps(1))
			from := die.Value
			die.Value = executorRollFace(node, spec, state.context)
			appendDieState(die, "unique-rerolled")
			syncDieContribution(die)
			reason := "unique"
			if modifier.Once {
				reason = "unique-once"
			}
			recordDieEvent(state, die, "reroll", DiceEvent{"from": from, "to": die.Value, "reason": reason})
			if modifier.Once {
				break
			}
		}
		seen[die.Value] = true
	}
}
func executorIndexesToExclude(values []float64, kind, selection string, quantity float64) []int {
	ranked := make([]int, len(values))
	for i := range ranked {
		ranked[i] = i
	}
	slices.SortStableFunc(ranked, func(left, right int) int {
		if values[left] < values[right] {
			return -1
		}
		if values[left] > values[right] {
			return 1
		}
		return left - right
	})
	selected := int64(min(float64(len(ranked)), quantity))
	boundary := selected
	if selection != "lowest" {
		boundary = int64(len(ranked)) - selected
	}
	if (selection == "lowest") == (kind == "drop") {
		return ranked[:boundary]
	}
	return ranked[boundary:]
}
func applyDieSelection(dice []*workingDie, modifier *ModifierNode, state *rollState) {
	active := activeWorkingDice(dice)
	values := make([]float64, len(active))
	for i, die := range active {
		values[i] = die.Value
	}
	for _, index := range executorIndexesToExclude(values, modifier.Kind, modifier.Selection, modifier.Quantity) {
		die := active[index]
		if !die.Included {
			continue
		}
		die.Included = false
		appendDieState(die, "dropped")
		syncDieContribution(die)
		recordDieEvent(state, die, "exclude", DiceEvent{"reason": modifier.Kind})
	}
}
func applyDieTarget(dice []*workingDie, modifier *ModifierNode, state *rollState) {
	for _, die := range dice {
		if !die.active {
			continue
		}
		outcome := "neutral"
		die.Contribution = 0
		if executorCompare(modifier.Success, die.Value) {
			outcome = "success"
			if die.Included {
				die.Contribution = 1
			}
		} else if modifier.Failure != nil && executorCompare(modifier.Failure, die.Value) {
			outcome = "failure"
			if die.Included {
				die.Contribution = -1
			}
		}
		appendDieState(die, "target-"+outcome)
		recordDieEvent(state, die, "classify", DiceEvent{"outcome": outcome})
	}
}
func applyDieCritical(dice []*workingDie, modifier *ModifierNode, spec *CompiledDiceSpec, state *rollState) {
	defaultValue := float64(spec.Minimum)
	if modifier.Kind == "critical-success" {
		defaultValue = float64(spec.Maximum)
	}
	for _, die := range dice {
		matches := die.Value == defaultValue
		if modifier.Compare != nil {
			matches = executorCompare(modifier.Compare, die.Value)
		}
		if die.active && matches {
			appendDieState(die, modifier.Kind)
			recordDieEvent(state, die, "classify", DiceEvent{"outcome": modifier.Kind})
		}
	}
}
func applyWorkingDiceModifiers(dice *[]*workingDie, modifiers []*ModifierNode, node *ExpressionNode, spec *CompiledDiceSpec, state *rollState) []*workingDie {
	var displayOrder []*workingDie
	for _, modifier := range modifiers {
		switch modifier.Kind {
		case "min", "max":
			applyDieBound(*dice, modifier.Value, modifier.Kind == "min", state)
		case "explode":
			applyDieExplode(dice, modifier, node, spec, state)
		case "reroll":
			applyDieReroll(*dice, modifier, node, spec, state)
		case "unique":
			applyDieUnique(*dice, modifier, node, spec, state)
		case "keep", "drop":
			applyDieSelection(*dice, modifier, state)
		case "target":
			applyDieTarget(*dice, modifier, state)
		case "critical-success", "critical-failure":
			applyDieCritical(*dice, modifier, spec, state)
		case "sort":
			displayOrder = append([]*workingDie{}, (*dice)...)
			slices.SortStableFunc(displayOrder, func(a, b *workingDie) int { return executorValueOrder(a.Value, b.Value, modifier.Direction) })
		}
	}
	if displayOrder == nil {
		return *dice
	}
	return displayOrder
}
func executorValueOrder(left, right float64, direction string) int {
	if direction != "ascending" {
		left, right = right, left
	}
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func addWorkingGroup(node *ExpressionNode, state *rollState, value float64, childIDs, states []string) string {
	kind := node.Kind
	if kind != "dice" && kind != "function" && kind != "group" {
		kind = "expression"
	}
	group := &workingGroup{ResolvedGroup{ID: resolvedGroupID(node, state.rollIndex), SourceNodeID: node.ID, RollIndex: state.rollIndex, Kind: kind, Notation: executorNotation(state, node), Span: node.Span, Value: value, Contribution: value, Included: true, States: append([]string{}, states...), ChildIDs: childIDs}}
	executorCheck(state.context.Budget.ConsumeResolvedGroups(1))
	executorCheck(state.context.Budget.ConsumeResultItems(1))
	state.groups = append(state.groups, group)
	state.groupByID[group.ID] = group
	return group.ID
}
func executorMissingSpec(node *ExpressionNode, input, message string) {
	err := newDiceError("UNSUPPORTED_NOTATION", message, input, map[string]any{"nodeId": node.ID})
	span := node.Span
	err.Span = &span
	panic(err)
}
func evaluateWorkingDice(node *ExpressionNode, state *rollState) rollEvaluation {
	spec := state.program.DiceSpecs[node.ID]
	if spec == nil {
		executorMissingSpec(node, state.plan.Input, "Compiled dice specification is missing")
	}
	start := int64(len(state.dice))
	groupID := resolvedGroupID(node, state.rollIndex)
	dice := []*workingDie{}
	for index := int64(0); index < spec.Quantity; index++ {
		dice = append(dice, createWorkingDie(node, spec, state, groupID, nil, false))
	}
	ordered := applyWorkingDiceModifiers(&dice, spec.Modifiers, node, spec, state)
	total := float64(0)
	for _, die := range dice {
		total += die.Contribution
	}
	value := executorValue(RoundResult(total))
	childIDs := make([]string, len(ordered))
	for i, die := range ordered {
		childIDs[i] = die.ID
	}
	groupID = addWorkingGroup(node, state, value, childIDs, nil)
	rendered := ""
	if state.renderOutput {
		values := make([]string, len(ordered))
		for i, die := range ordered {
			values[i] = executorNumberString(die.Value)
		}
		rendered = "[" + strings.Join(values, ", ") + "]"
	}
	return rollEvaluation{value: value, rendered: rendered, groupID: groupID, diceRange: EntityRange{Start: start, Count: int64(len(state.dice)) - start}}
}
func excludeWorkingGroupTree(groupID string, state *rollState, reason string) {
	group := state.groupByID[groupID]
	if group == nil || !group.Included {
		return
	}
	group.Included = false
	group.Contribution = 0
	group.States = append(group.States, "dropped")
	recordGroupEvent(state, group, "exclude", DiceEvent{"reason": reason, "value": group.Value})
	for _, childID := range group.ChildIDs {
		if _, ok := state.groupByID[childID]; ok {
			excludeWorkingGroupTree(childID, state, reason)
		}
	}
}
func excludeWorkingEvaluation(item *groupItem, state *rollState, reason string) {
	item.included = false
	excludeWorkingGroupTree(item.evaluation.groupID, state, reason)
	end := item.evaluation.diceRange.Start + item.evaluation.diceRange.Count
	for index := item.evaluation.diceRange.Start; index < end; index++ {
		die := state.dice[index]
		if !die.Included {
			continue
		}
		die.Included = false
		appendDieState(die, "dropped")
		syncDieContribution(die)
		recordDieEvent(state, die, "exclude", DiceEvent{"reason": reason})
	}
}
func applyWorkingGroupModifiers(items []*groupItem, modifiers []*ModifierNode, state *rollState) []*groupItem {
	displayOrder := items
	for _, modifier := range modifiers {
		switch modifier.Kind {
		case "keep", "drop":
			values := make([]float64, len(items))
			for i, item := range items {
				values[i] = item.value
			}
			for _, index := range executorIndexesToExclude(values, modifier.Kind, modifier.Selection, modifier.Quantity) {
				if items[index].included {
					excludeWorkingEvaluation(items[index], state, modifier.Kind)
				}
			}
		case "sort":
			displayOrder = append([]*groupItem{}, items...)
			slices.SortStableFunc(displayOrder, func(a, b *groupItem) int { return executorValueOrder(a.value, b.value, modifier.Direction) })
		default:
			err := newDiceError("UNSUPPORTED_GROUP_MODIFIER", fmt.Sprintf("Modifier %s is not supported on roll groups", modifier.Kind), state.plan.Input, map[string]any{"modifier": modifier.Kind})
			span := modifier.Span
			err.Span = &span
			panic(err)
		}
	}
	return displayOrder
}
func evaluateWorkingGroup(node *ExpressionNode, state *rollState) rollEvaluation {
	start := int64(len(state.dice))
	items := make([]*groupItem, len(node.Expressions))
	for i, expression := range node.Expressions {
		evaluation := evaluateWorkingNode(expression, state)
		items[i] = &groupItem{evaluation: evaluation, value: evaluation.value, included: true}
	}
	modifiers, ok := state.program.GroupModifiers[node.ID]
	if !ok {
		executorMissingSpec(node, state.plan.Input, "Compiled group modifier pipeline is missing")
	}
	ordered := applyWorkingGroupModifiers(items, modifiers, state)
	total := float64(0)
	originalIDs := make([]string, len(items))
	for i, item := range items {
		if item.included {
			total += item.value
		}
		originalIDs[i] = item.evaluation.groupID
	}
	value := executorValue(RoundResult(total))
	childIDs := make([]string, len(ordered))
	for i, item := range ordered {
		childIDs[i] = item.evaluation.groupID
	}
	var sortModifier *ModifierNode
	for _, modifier := range modifiers {
		if modifier.Kind == "sort" {
			sortModifier = modifier
			break
		}
	}
	states := []string{}
	if sortModifier != nil {
		states = append(states, "sorted-"+sortModifier.Direction)
	}
	groupID := addWorkingGroup(node, state, value, childIDs, states)
	if sortModifier != nil {
		recordGroupEvent(state, state.groupByID[groupID], "transform", DiceEvent{"from": originalIDs, "to": childIDs, "reason": "sort-" + sortModifier.Direction})
	}
	rendered := ""
	if state.renderOutput {
		values := make([]string, len(ordered))
		for i, item := range ordered {
			values[i] = item.evaluation.rendered
		}
		rendered = "{" + strings.Join(values, ", ") + "}"
	}
	return rollEvaluation{value: value, rendered: rendered, groupID: groupID, diceRange: EntityRange{Start: start, Count: int64(len(state.dice)) - start}}
}
func evaluateWorkingNode(node *ExpressionNode, state *rollState) rollEvaluation {
	if node.Kind == "dice" {
		return evaluateWorkingDice(node, state)
	}
	if node.Kind == "group" {
		return evaluateWorkingGroup(node, state)
	}
	result := rollEvaluation{diceRange: EntityRange{Start: int64(len(state.dice))}}
	childIDs := []string{}
	switch node.Kind {
	case "number":
		result.value = node.Value
		if state.renderOutput {
			result.rendered = node.Raw
		}
	case "unary":
		operand := evaluateWorkingNode(node.Operand, state)
		result.value = operand.value
		if node.Operator == "-" {
			result.value = -result.value
		}
		result.diceRange = operand.diceRange
		childIDs = append(childIDs, operand.groupID)
		if state.renderOutput {
			result.rendered = node.Operator + operand.rendered
		}
	case "parenthesized":
		expression := evaluateWorkingNode(node.Expression, state)
		result.value, result.diceRange = expression.value, expression.diceRange
		childIDs = append(childIDs, expression.groupID)
		if state.renderOutput {
			result.rendered = "(" + expression.rendered + ")"
		}
	case "binary":
		left := evaluateWorkingNode(node.Left, state)
		right := evaluateWorkingNode(node.Right, state)
		operator := node.Operator
		if operator == "**" {
			operator = "^"
		}
		result.value = executorValue(EvaluateBinary(operator, left.value, right.value, state.plan.Input))
		result.diceRange = EntityRange{Start: left.diceRange.Start, Count: left.diceRange.Count + right.diceRange.Count}
		childIDs = append(childIDs, left.groupID, right.groupID)
		if state.renderOutput {
			result.rendered = left.rendered + node.Operator + right.rendered
		}
	case "function":
		left := evaluateWorkingNode(node.Arguments[0], state)
		result.diceRange = left.diceRange
		childIDs = append(childIDs, left.groupID)
		if node.FunctionKind == "unary" {
			result.value = executorValue(EvaluateUnaryFunction(node.Name, left.value, state.plan.Input))
			if state.renderOutput {
				result.rendered = node.Name + "(" + left.rendered + ")"
			}
		} else {
			right := evaluateWorkingNode(node.Arguments[1], state)
			result.value = executorValue(EvaluateBinaryFunction(node.Name, left.value, right.value, state.plan.Input))
			result.diceRange.Count += right.diceRange.Count
			childIDs = append(childIDs, right.groupID)
			if state.renderOutput {
				result.rendered = node.Name + "(" + left.rendered + "," + right.rendered + ")"
			}
		}
	}
	result.groupID = addWorkingGroup(node, state, result.value, childIDs, nil)
	return result
}

func finalizeWorkingDice(state *rollState, materialize bool) []ResolvedDie {
	resolved := []ResolvedDie{}
	if materialize {
		resolved = make([]ResolvedDie, len(state.dice))
	}
	for index, die := range state.dice {
		if die.active && die.Included {
			if state.context.Journal.materialize {
				recordDieEvent(state, die, "include", DiceEvent{"contribution": die.Contribution})
			} else {
				executorValue(state.context.Journal.Record(nil))
			}
		}
		if materialize {
			copy := die.ResolvedDie
			copy.RollDieIndex = int64(index + 1)
			copy.Included = die.Included && die.active
			copy.States = append([]string{}, die.States...)
			resolved[index] = copy
		}
	}
	return resolved
}
func finalizeWorkingGroups(state *rollState, materialize bool) []ResolvedGroup {
	resolved := []ResolvedGroup{}
	if materialize {
		resolved = make([]ResolvedGroup, len(state.groups))
	}
	for index, group := range state.groups {
		if group.Included {
			recordGroupEvent(state, group, "include", DiceEvent{"value": group.Value, "contribution": group.Contribution})
		}
		if materialize {
			copy := group.ResolvedGroup
			copy.States = append([]string{}, group.States...)
			resolved[index] = copy
		}
	}
	return resolved
}
func buildWorkingPool(dice []*workingDie) *PoolSummary {
	targeted := false
	successes, failures := int64(0), int64(0)
	for _, die := range dice {
		success := slices.Contains(die.States, "target-success")
		failure := slices.Contains(die.States, "target-failure")
		if success || failure || slices.Contains(die.States, "target-neutral") {
			targeted = true
		}
		if die.active && die.Included {
			if success {
				successes++
			} else if failure {
				failures++
			}
		}
	}
	if !targeted {
		return nil
	}
	return &PoolSummary{Successes: successes, Failures: failures, NetSuccesses: successes - failures}
}
func aggregateWorkingPool(rolls []ResolvedRollSummary) *PoolSummary {
	var pool *PoolSummary
	for _, roll := range rolls {
		if roll.Pool != nil {
			if pool == nil {
				pool = &PoolSummary{}
			}
			pool.Successes += roll.Pool.Successes
			pool.Failures += roll.Pool.Failures
			pool.NetSuccesses = pool.Successes - pool.Failures
		}
	}
	return pool
}
func executorNumberString(value float64) string {
	if value == 0 {
		return "0"
	}
	if value >= -float64(maxSafeInteger) && value <= float64(maxSafeInteger) && float64(int64(value)) == value {
		return strconv.FormatInt(int64(value), 10)
	}
	return seedNumberString(value)
}
func formatExecutionOutput(outputs []string, total float64, context *ExecutionContext) string {
	if len(outputs) == 1 {
		executorCheck(context.Budget.AssertOutputLength(int64(len(syntaxUnits(outputs[0])))))
		return outputs[0]
	}
	line := "Total: " + executorNumberString(total)
	length := len(syntaxUnits(line))
	for i, output := range outputs {
		length += len(strconv.Itoa(i+1)) + 2 + len(syntaxUnits(output)) + 1
	}
	executorCheck(context.Budget.AssertOutputLength(int64(length)))
	lines := make([]string, 0, len(outputs)+1)
	for i, output := range outputs {
		lines = append(lines, strconv.Itoa(i+1)+". "+output)
	}
	return strings.Join(append(lines, line), "\n")
}
func executorCreateContext(plan *RollPlan, options ExecuteRollPlanOptions, materialize bool) *ExecutionContext {
	contextOptions := ExecutionContextOptions{ResolvedLimits: &options.Limits, PlanFingerprint: plan.PlanFingerprint, CollectEvents: &materialize}
	if options.Replay != nil {
		contextOptions.Replay = options.Replay
	} else {
		contextOptions.Seed = options.Seed
		contextOptions.RandomAlgorithm = options.RandomAlgorithm
	}
	return executorValue(CreateExecutionContext(contextOptions))
}

func executeGeneralPlan(plan *RollPlan, program *CompiledDiceProgram, options ExecuteRollPlanOptions, mode string) (*DiceRollResult, *DiceRollDetails, *DiceRollSummary) {
	full := mode == "full"
	materializeDice := mode != "summary"
	context := executorCreateContext(plan, options, full)
	executorCheck(context.Budget.ConsumeRolls(plan.RollCount))
	dice := []ResolvedDie{}
	groups := []ResolvedGroup{}
	rolls := []ResolvedRoll{}
	summaries := []ResolvedRollSummary{}
	outputs := []string{}
	for rollIndex := int64(1); rollIndex <= plan.RollCount; rollIndex++ {
		executorCheck(context.Budget.ConsumeResultItems(1))
		eventStart := context.Journal.Length()
		diceStart, groupStart := int64(len(dice)), int64(len(groups))
		state := &rollState{context: context, plan: plan, program: program, rollIndex: rollIndex, dice: []*workingDie{}, groups: []*workingGroup{}, groupByID: map[string]*workingGroup{}, renderOutput: full}
		evaluation := evaluateWorkingNode(program.AST, state)
		total := executorValue(RoundResult(evaluation.value))
		resolvedDice := finalizeWorkingDice(state, materializeDice)
		resolvedGroups := finalizeWorkingGroups(state, full)
		pool := buildWorkingPool(state.dice)
		if materializeDice {
			if len(dice) == 0 {
				dice = resolvedDice
			} else {
				dice = append(dice, resolvedDice...)
			}
		}
		summaries = append(summaries, ResolvedRollSummary{Index: rollIndex, Total: total, Pool: pool})
		if full {
			if len(groups) == 0 {
				groups = resolvedGroups
			} else {
				groups = append(groups, resolvedGroups...)
			}
			rollOutput := plan.Notation + ": " + evaluation.rendered + " = " + executorNumberString(total)
			executorCheck(context.Budget.AssertOutputLength(int64(len(syntaxUnits(rollOutput)))))
			outputs = append(outputs, rollOutput)
			rolls = append(rolls, ResolvedRoll{Index: rollIndex, Total: total, Pool: pool, DiceRange: EntityRange{Start: diceStart, Count: int64(len(resolvedDice))}, GroupRange: EntityRange{Start: groupStart, Count: int64(len(resolvedGroups))}, EventRange: EntityRange{Start: eventStart, Count: context.Journal.Length() - eventStart}})
		}
	}
	total := float64(0)
	for _, roll := range summaries {
		total += roll.Total
	}
	total = executorValue(RoundResult(total))
	pool := aggregateWorkingPool(summaries)
	stats := context.Budget.Stats()
	if mode == "details" {
		return nil, &DiceRollDetails{Type: "dice-roll-details", SchemaVersion: 3, Input: plan.Input, Notation: plan.Notation, NormalizedNotation: plan.NormalizedNotation, Comment: plan.Comment, Total: total, Replay: context.Replay, Stats: stats, Pool: pool, Rolls: summaries, Dice: dice}, nil
	}
	if mode == "summary" {
		return nil, nil, &DiceRollSummary{Type: "dice-roll-summary", SchemaVersion: 3, Input: plan.Input, Notation: plan.Notation, NormalizedNotation: plan.NormalizedNotation, Comment: plan.Comment, Total: total, Replay: context.Replay, Stats: stats, Pool: pool, Rolls: summaries}
	}
	return &DiceRollResult{Type: "dice-roll", SchemaVersion: 3, Input: plan.Input, Notation: plan.Notation, NormalizedNotation: plan.NormalizedNotation, Comment: plan.Comment, Total: total, Replay: context.Replay, Stats: stats, Pool: pool, Output: formatExecutionOutput(outputs, total, context), Rolls: rolls, Groups: groups, Dice: dice, Events: context.Journal.ToArray()}, nil, nil
}

func ExecuteRollPlan(plan *RollPlan, options ExecuteRollPlanOptions) (result *DiceRollResult, err error) {
	defer recoverExecutor(&result, &err)
	plan = executorValue(canonicalRollPlan(plan))
	program := executorValue(GetPlanProgram(plan))
	result, _, _ = executeGeneralPlan(plan, program, options, "full")
	return result, nil
}
func ExecuteRollPlanDetails(plan *RollPlan, options ExecuteRollPlanOptions) (result *DiceRollDetails, err error) {
	defer recoverExecutor(&result, &err)
	plan = executorValue(canonicalRollPlan(plan))
	program := executorValue(GetPlanProgram(plan))
	_, result, _ = executeGeneralPlan(plan, program, options, "details")
	return result, nil
}
func ExecuteRollPlanSummary(plan *RollPlan, options ExecuteRollPlanOptions) (result *DiceRollSummary, err error) {
	defer recoverExecutor(&result, &err)
	plan = executorValue(canonicalRollPlan(plan))
	program := executorValue(GetPlanProgram(plan))
	if program.SupportsFastSummary {
		return executeFastSummaryPlan(plan, program, options), nil
	}
	_, _, result = executeGeneralPlan(plan, program, options, "summary")
	return result, nil
}
