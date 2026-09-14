package dicecore

import (
	"math"
	"slices"
)

func consumeSummaryEvent(context *ExecutionContext, count int64) {
	executorCheck(context.Budget.ConsumeEvents(count))
	executorCheck(context.Budget.ConsumeResultItems(count))
}
func finishSummaryGroup(context *ExecutionContext) {
	executorCheck(context.Budget.ConsumeResolvedGroups(1))
	executorCheck(context.Budget.ConsumeResultItems(1))
	consumeSummaryEvent(context, 1)
}
func evaluateModifiedSummary(node *ExpressionNode, spec *CompiledDiceSpec, modifier *ModifierNode, context *ExecutionContext) (float64, *PoolSummary) {
	values := []float64{}
	for index := int64(0); index < spec.Quantity; index++ {
		executorCheck(context.Budget.ConsumeInitialDice(1))
		executorCheck(context.Budget.ConsumeResultItems(1))
		values = append(values, executorRollFace(node, spec, context))
		consumeSummaryEvent(context, 1)
	}
	total := float64(0)
	included := len(values)
	var pool *PoolSummary
	if modifier.Kind == "keep" || modifier.Kind == "drop" {
		selected := int(min(modifier.Quantity, float64(len(values))))
		if modifier.Kind == "keep" {
			included = selected
		} else {
			included = len(values) - selected
		}
		sum := float64(0)
		for _, value := range values {
			sum += value
		}
		if selected == len(values) {
			if modifier.Kind == "keep" {
				total = sum
			}
		} else if selected == 1 {
			extreme := values[0]
			for _, value := range values {
				if modifier.Selection == "highest" {
					extreme = math.Max(extreme, value)
				} else {
					extreme = math.Min(extreme, value)
				}
			}
			if modifier.Kind == "keep" {
				total = extreme
			} else {
				total = sum - extreme
			}
		} else {
			slices.Sort(values)
			start := 0
			if modifier.Selection != "lowest" {
				start = len(values) - selected
			}
			selectedTotal := float64(0)
			for index := start; index < start+selected; index++ {
				selectedTotal += values[index]
			}
			if modifier.Kind == "keep" {
				total = selectedTotal
			} else {
				total = sum - selectedTotal
			}
		}
		for index := included; index < len(values); index++ {
			consumeSummaryEvent(context, 1)
		}
	} else {
		successes, failures := int64(0), int64(0)
		for _, value := range values {
			if modifier.Kind == "target" {
				if executorCompare(modifier.Success, value) {
					successes++
				} else if modifier.Failure != nil && executorCompare(modifier.Failure, value) {
					failures++
				}
				consumeSummaryEvent(context, 1)
			} else {
				transformed := math.Min(value, modifier.Value)
				if modifier.Kind == "min" {
					transformed = math.Max(value, modifier.Value)
				}
				if transformed != value {
					consumeSummaryEvent(context, 1)
				}
				total += transformed
			}
		}
		if modifier.Kind == "target" {
			total = float64(successes - failures)
			pool = &PoolSummary{Successes: successes, Failures: failures, NetSuccesses: successes - failures}
		}
	}
	executorCheck(context.Budget.ConsumeResolvedGroups(1))
	executorCheck(context.Budget.ConsumeResultItems(1))
	for index := 0; index < included; index++ {
		consumeSummaryEvent(context, 1)
	}
	consumeSummaryEvent(context, 1)
	return executorValue(RoundResult(total)), pool
}
func evaluateFastSummaryNode(node *ExpressionNode, program *CompiledDiceProgram, context *ExecutionContext, input string) float64 {
	var value float64
	switch node.Kind {
	case "number":
		value = node.Value
	case "unary":
		value = evaluateFastSummaryNode(node.Operand, program, context, input)
		if node.Operator == "-" {
			value = -value
		}
	case "binary":
		operator := node.Operator
		if operator == "**" {
			operator = "^"
		}
		left := evaluateFastSummaryNode(node.Left, program, context, input)
		right := evaluateFastSummaryNode(node.Right, program, context, input)
		value = executorValue(EvaluateBinary(operator, left, right, input))
	case "parenthesized":
		value = evaluateFastSummaryNode(node.Expression, program, context, input)
	case "function":
		left := evaluateFastSummaryNode(node.Arguments[0], program, context, input)
		if node.FunctionKind == "unary" {
			value = executorValue(EvaluateUnaryFunction(node.Name, left, input))
		} else {
			right := evaluateFastSummaryNode(node.Arguments[1], program, context, input)
			value = executorValue(EvaluateBinaryFunction(node.Name, left, right, input))
		}
	case "dice":
		spec := program.DiceSpecs[node.ID]
		if spec == nil {
			executorMissingSpec(node, input, "Compiled dice specification is missing")
		}
		total := float64(0)
		for index := int64(0); index < spec.Quantity; index++ {
			executorCheck(context.Budget.ConsumeInitialDice(1))
			executorCheck(context.Budget.ConsumeResultItems(1))
			total += executorRollFace(node, spec, context)
			consumeSummaryEvent(context, 2)
		}
		value = executorValue(RoundResult(total))
	case "group":
		total := float64(0)
		for _, expression := range node.Expressions {
			total += evaluateFastSummaryNode(expression, program, context, input)
		}
		value = executorValue(RoundResult(total))
	}
	finishSummaryGroup(context)
	return value
}
func executeFastSummaryPlan(plan *RollPlan, program *CompiledDiceProgram, options ExecuteRollPlanOptions) *DiceRollSummary {
	context := executorCreateContext(plan, options, false)
	executorCheck(context.Budget.ConsumeRolls(plan.RollCount))
	rolls := []ResolvedRollSummary{}
	var spec *CompiledDiceSpec
	var modifier *ModifierNode
	if program.AST.Kind == "dice" {
		spec = program.DiceSpecs[program.AST.ID]
		if spec != nil && len(spec.Modifiers) > 0 {
			modifier = spec.Modifiers[0]
		}
	}
	for rollIndex := int64(1); rollIndex <= plan.RollCount; rollIndex++ {
		executorCheck(context.Budget.ConsumeResultItems(1))
		var total float64
		var pool *PoolSummary
		if modifier != nil {
			total, pool = evaluateModifiedSummary(program.AST, spec, modifier, context)
		} else {
			total = executorValue(RoundResult(evaluateFastSummaryNode(program.AST, program, context, plan.Input)))
		}
		rolls = append(rolls, ResolvedRollSummary{Index: rollIndex, Total: total, Pool: pool})
	}
	total := float64(0)
	for _, roll := range rolls {
		total += roll.Total
	}
	return &DiceRollSummary{Type: "dice-roll-summary", SchemaVersion: 3, Input: plan.Input, Notation: plan.Notation, NormalizedNotation: plan.NormalizedNotation, Comment: plan.Comment, Total: executorValue(RoundResult(total)), Replay: context.Replay, Stats: context.Budget.Stats(), Rolls: rolls, Pool: aggregateWorkingPool(rolls)}
}
