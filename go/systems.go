package dicecore

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strings"
)

// SystemEngine allows the adapters to share one engine's limits and plan cache.
type SystemEngine interface {
	Compile(string, ...CompileOptions) (*RollPlan, error)
	Roll(any, ...RollOptions) (*DiceRollResult, error)
	RollDetails(any, ...RollOptions) (*DiceRollDetails, error)
	Limits() DiceLimits
}
type SystemRollOptions struct {
	RollOptions
	Detail string
}
type MixedRollOptions = SystemRollOptions

type SystemDieResult struct {
	ID          string   `json:"id"`
	SourceDieID string   `json:"sourceDieId"`
	Sides       float64  `json:"sides"`
	Value       float64  `json:"value"`
	RawValue    float64  `json:"rawValue"`
	ProfileID   string   `json:"profileId"`
	DieKind     string   `json:"dieKind"`
	FaceKey     string   `json:"faceKey"`
	Symbols     []string `json:"symbols"`
}
type FateDieResult struct {
	SystemDieResult
	FateValue float64 `json:"fateValue"`
}
type AssimilationDieResult = SystemDieResult
type DaggerheartDieResult = SystemDieResult
type VampireV5DieResult = SystemDieResult

type FateRollInput struct {
	Dice *int64 `json:"dice,omitempty"`
}
type DaggerheartRollInput struct {
	Modifier   *int64 `json:"modifier,omitempty"`
	Difficulty *int64 `json:"difficulty,omitempty"`
}
type AssimilationRollInput struct {
	D6   int64  `json:"d6,omitempty"`
	D10  int64  `json:"d10,omitempty"`
	D12  int64  `json:"d12,omitempty"`
	Keep *int64 `json:"keep,omitempty"`
}
type VampireV5RollInput struct {
	Pool       int64  `json:"pool"`
	Hunger     int64  `json:"hunger"`
	Difficulty *int64 `json:"difficulty,omitempty"`
}

type systemResultHeader struct {
	Type          string `json:"type"`
	SchemaVersion int64  `json:"schemaVersion"`
	System        string `json:"system"`
	RulesVersion  int64  `json:"rulesVersion"`
}

func systemHeader(kind string) systemResultHeader {
	return systemResultHeader{kind + "-roll", 1, kind, 1}
}

type FateRollResult struct {
	systemResultHeader
	DiceCount int64           `json:"diceCount"`
	Total     float64         `json:"total"`
	Dice      []FateDieResult `json:"dice"`
	BaseRoll  any             `json:"baseRoll"`
}
type AssimilationRollResult struct {
	systemResultHeader
	D6        int64                   `json:"d6"`
	D10       int64                   `json:"d10"`
	D12       int64                   `json:"d12"`
	TotalDice int64                   `json:"totalDice"`
	Keep      int64                   `json:"keep"`
	Dice      []AssimilationDieResult `json:"dice"`
	BaseRoll  any                     `json:"baseRoll"`
}
type AssimilationSelectionResult struct {
	Type          string                  `json:"type"`
	SchemaVersion int64                   `json:"schemaVersion"`
	System        string                  `json:"system"`
	SelectedIDs   []string                `json:"selectedIds"`
	Dice          []AssimilationDieResult `json:"dice"`
	Success       int64                   `json:"success"`
	Adaptation    int64                   `json:"adaptation"`
	Pressure      int64                   `json:"pressure"`
}
type DaggerheartRollResult struct {
	systemResultHeader
	Modifier     int64                  `json:"modifier"`
	Difficulty   *int64                 `json:"difficulty"`
	DualityTotal float64                `json:"dualityTotal"`
	Total        float64                `json:"total"`
	Duality      string                 `json:"duality"`
	Succeeds     *bool                  `json:"succeeds"`
	Outcome      string                 `json:"outcome"`
	HopeDie      DaggerheartDieResult   `json:"hopeDie"`
	FearDie      DaggerheartDieResult   `json:"fearDie"`
	Dice         []DaggerheartDieResult `json:"dice"`
	BaseRoll     any                    `json:"baseRoll"`
}
type VampireV5RollResult struct {
	systemResultHeader
	Pool          int64                `json:"pool"`
	Hunger        int64                `json:"hunger"`
	Difficulty    *int64               `json:"difficulty"`
	NormalDice    int64                `json:"normalDice"`
	HungerDice    int64                `json:"hungerDice"`
	Successes     int64                `json:"successes"`
	CriticalPairs int64                `json:"criticalPairs"`
	Outcome       string               `json:"outcome"`
	Dice          []VampireV5DieResult `json:"dice"`
	BaseRoll      any                  `json:"baseRoll"`
}

const (
	FateDFProfile             = "fate-df"
	AssimilationD6Profile     = "assimilation-d6"
	AssimilationD10Profile    = "assimilation-d10"
	AssimilationD12Profile    = "assimilation-d12"
	DaggerheartHopeD12Profile = "daggerheart-hope-d12"
	DaggerheartFearD12Profile = "daggerheart-fear-d12"
	VampireV5NormalD10Profile = "vampire-v5-normal-d10"
	VampireV5HungerD10Profile = "vampire-v5-hunger-d10"
)

func systemOptions(options []SystemRollOptions) SystemRollOptions {
	if len(options) > 0 {
		return options[0]
	}
	return SystemRollOptions{}
}
func invalidSystemInput(system, field, reason string) error {
	return newDiceError("INVALID_SYSTEM_INPUT", fmt.Sprintf("Invalid %s roll input: %s %s", system, field, reason), system, map[string]any{"system": system, "field": field, "reason": reason})
}
func readSystemInput(input any, system string) (map[string]any, error) {
	if source, ok := input.(map[string]any); ok && source != nil {
		return source, nil
	}
	value := reflect.ValueOf(input)
	if !value.IsValid() {
		return nil, invalidSystemInput(system, "input", "must be a non-null object")
	}
	if value.Kind() == reflect.Pointer && !value.IsNil() {
		value = value.Elem()
	}
	if value.Kind() != reflect.Struct && value.Kind() != reflect.Map {
		return nil, invalidSystemInput(system, "input", "must be a non-null object")
	}
	data, err := json.Marshal(input)
	if err != nil {
		return nil, invalidSystemInput(system, "input", "could not be read")
	}
	var result map[string]any
	if err = json.Unmarshal(data, &result); err != nil || result == nil {
		return nil, invalidSystemInput(system, "input", "must be a non-null object")
	}
	return result, nil
}
func readSystemInteger(input map[string]any, system, field string, minimum, maximum int64, required bool) (*int64, error) {
	value, present := input[field]
	if !present {
		if required {
			return nil, invalidSystemInput(system, field, "is required")
		}
		return nil, nil
	}
	number, ok := seedNumber(value)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number || number < float64(minimum) || number > float64(maximum) {
		return nil, invalidSystemInput(system, field, fmt.Sprintf("must be a safe integer from %d to %d", minimum, maximum))
	}
	result := int64(number)
	return &result, nil
}
func systemDefault(value *int64, fallback int64) int64 {
	if value == nil {
		return fallback
	}
	return *value
}
func executeSystemRoll(engine SystemEngine, notation string, options SystemRollOptions) ([]ResolvedDie, any, error) {
	if options.Detail == "compact" {
		result, err := engine.RollDetails(notation, options.RollOptions)
		if err != nil {
			return nil, nil, err
		}
		summary := &DiceRollSummary{Type: "dice-roll-summary", SchemaVersion: result.SchemaVersion, Input: result.Input, Notation: result.Notation, NormalizedNotation: result.NormalizedNotation, Comment: result.Comment, Total: result.Total, Replay: result.Replay, Stats: result.Stats, Rolls: append([]ResolvedRollSummary{}, result.Rolls...), Pool: result.Pool}
		return result.Dice, summary, nil
	}
	result, err := engine.Roll(notation, options.RollOptions)
	if err != nil {
		return nil, nil, err
	}
	return result.Dice, result, nil
}
func projectSystemDie(die ResolvedDie, profile, kind, face string, symbols []string) (SystemDieResult, error) {
	sides, ok := seedNumber(die.Sides)
	if !ok {
		return SystemDieResult{}, fmt.Errorf("System dice must use numeric sides")
	}
	return SystemDieResult{profile + ":" + die.ID, die.ID, sides, die.Value, die.RawValue, profile, kind, face, append([]string{}, symbols...)}, nil
}

func RollFateDice(input any, options ...SystemRollOptions) (*FateRollResult, error) {
	return RollFateDiceWithEngine(DefaultDiceEngine(), input, options...)
}
func RollFateDiceWithEngine(engine SystemEngine, input any, options ...SystemRollOptions) (*FateRollResult, error) {
	if input == nil {
		input = FateRollInput{}
	}
	source, err := readSystemInput(input, "fate")
	if err != nil {
		return nil, err
	}
	count, err := readSystemInteger(source, "fate", "dice", 1, maxSafeInteger, false)
	if err != nil {
		return nil, err
	}
	diceCount := systemDefault(count, 4)
	dice, base, err := executeSystemRoll(engine, fmt.Sprintf("%dd6", diceCount), systemOptions(options))
	if err != nil {
		return nil, err
	}
	result := &FateRollResult{systemResultHeader: systemHeader("fate"), DiceCount: diceCount, Dice: []FateDieResult{}, BaseRoll: base}
	for _, die := range dice {
		face, value, symbols := "", float64(0), []string{}
		switch die.RawValue {
		case 1, 2:
			face, value, symbols = "minus", -1, []string{"minus"}
		case 3, 4:
			face = "blank"
		case 5, 6:
			face, value, symbols = "plus", 1, []string{"plus"}
		default:
			return nil, fmt.Errorf("Unsupported Fate face: %s", systemNumber(die.RawValue))
		}
		projected, err := projectSystemDie(die, FateDFProfile, "fate", face, symbols)
		if err != nil {
			return nil, err
		}
		result.Dice = append(result.Dice, FateDieResult{projected, value})
		result.Total += value
	}
	return result, nil
}

var assimilationFaces = []struct {
	face    string
	symbols []string
}{
	{"blank", nil}, {"blank", nil}, {"pressure", []string{"pressure"}}, {"pressure", []string{"pressure"}},
	{"adaptation-pressure", []string{"adaptation", "pressure"}}, {"success", []string{"success"}},
	{"double-success", []string{"success", "success"}}, {"success-adaptation", []string{"success", "adaptation"}},
	{"success-adaptation-pressure", []string{"success", "adaptation", "pressure"}}, {"double-success-pressure", []string{"success", "success", "pressure"}},
	{"success-double-adaptation-pressure", []string{"success", "adaptation", "adaptation", "pressure"}}, {"double-pressure", []string{"pressure", "pressure"}},
}

func toAssimilationDie(die ResolvedDie) (AssimilationDieResult, error) {
	if die.RawValue < 1 || die.RawValue > 12 || math.Trunc(die.RawValue) != die.RawValue {
		return SystemDieResult{}, fmt.Errorf("Unsupported Assimilation face: %s", systemNumber(die.RawValue))
	}
	face := assimilationFaces[int(die.RawValue)-1]
	sides, ok := seedNumber(die.Sides)
	if !ok {
		if die.Sides == "F" {
			return SystemDieResult{}, fmt.Errorf("Assimilation does not support Fudge dice")
		}
		return SystemDieResult{}, fmt.Errorf("Unsupported Assimilation die: d%v", die.Sides)
	}
	if sides != 6 && sides != 10 && sides != 12 {
		return SystemDieResult{}, fmt.Errorf("Unsupported Assimilation die: d%s", systemNumber(sides))
	}
	kind := "d" + systemNumber(sides)
	return projectSystemDie(die, "assimilation-"+kind, kind, face.face, face.symbols)
}
func RollAssimilation(input any, options ...SystemRollOptions) (*AssimilationRollResult, error) {
	return RollAssimilationWithEngine(DefaultDiceEngine(), input, options...)
}
func RollAssimilationWithEngine(engine SystemEngine, input any, options ...SystemRollOptions) (*AssimilationRollResult, error) {
	source, err := readSystemInput(input, "assimilation")
	if err != nil {
		return nil, err
	}
	counts := [3]int64{}
	for index, field := range []string{"d6", "d10", "d12"} {
		value, err := readSystemInteger(source, "assimilation", field, 0, maxSafeInteger, false)
		if err != nil {
			return nil, err
		}
		counts[index] = systemDefault(value, 0)
	}
	total := float64(counts[0]) + float64(counts[1]) + float64(counts[2])
	if total < 1 || total > float64(maxSafeInteger) {
		return nil, invalidSystemInput("assimilation", "dice", "must contain at least one die and have a safe total")
	}
	keepValue, err := readSystemInteger(source, "assimilation", "keep", 1, maxSafeInteger, false)
	if err != nil {
		return nil, err
	}
	keep := systemDefault(keepValue, 1)
	if float64(keep) > total {
		return nil, invalidSystemInput("assimilation", "keep", "cannot exceed the dice pool")
	}
	terms := []string{}
	for index, sides := range []int64{6, 10, 12} {
		if counts[index] > 0 {
			terms = append(terms, fmt.Sprintf("%dd%d", counts[index], sides))
		}
	}
	dice, base, err := executeSystemRoll(engine, strings.Join(terms, "+"), systemOptions(options))
	if err != nil {
		return nil, err
	}
	result := &AssimilationRollResult{systemResultHeader: systemHeader("assimilation"), D6: counts[0], D10: counts[1], D12: counts[2], TotalDice: int64(total), Keep: keep, Dice: []AssimilationDieResult{}, BaseRoll: base}
	for _, die := range dice {
		projected, err := toAssimilationDie(die)
		if err != nil {
			return nil, err
		}
		result.Dice = append(result.Dice, projected)
	}
	return result, nil
}
func EvaluateAssimilationSelection(roll *AssimilationRollResult, selectedIDs any) (*AssimilationSelectionResult, error) {
	ids, ok := selectedIDs.([]string)
	if !ok {
		raw, valid := selectedIDs.([]any)
		if !valid {
			return nil, invalidSystemInput("assimilation", "selectedIds", "must be an array")
		}
		ids = make([]string, len(raw))
		for i, v := range raw {
			ids[i], _ = v.(string)
		}
	}
	if int64(len(ids)) > roll.Keep {
		return nil, invalidSystemInput("assimilation", "selectedIds", "cannot exceed keep")
	}
	byID := map[string]AssimilationDieResult{}
	for _, die := range roll.Dice {
		byID[die.ID] = die
	}
	seen := map[string]bool{}
	result := &AssimilationSelectionResult{Type: "assimilation-selection", SchemaVersion: 1, System: "assimilation", SelectedIDs: append([]string{}, ids...), Dice: []AssimilationDieResult{}}
	for _, id := range ids {
		if id == "" {
			return nil, invalidSystemInput("assimilation", "selectedIds", "must contain non-empty strings")
		}
		if seen[id] {
			return nil, invalidSystemInput("assimilation", "selectedIds", "must contain unique IDs")
		}
		die, found := byID[id]
		if !found {
			return nil, invalidSystemInput("assimilation", "selectedIds", "contains an unknown ID")
		}
		seen[id] = true
		result.Dice = append(result.Dice, die)
		for _, symbol := range die.Symbols {
			switch symbol {
			case "success":
				result.Success++
			case "adaptation":
				result.Adaptation++
			case "pressure":
				result.Pressure++
			}
		}
	}
	return result, nil
}

func RollDaggerheart(input any, options ...SystemRollOptions) (*DaggerheartRollResult, error) {
	return RollDaggerheartWithEngine(DefaultDiceEngine(), input, options...)
}
func RollDaggerheartWithEngine(engine SystemEngine, input any, options ...SystemRollOptions) (*DaggerheartRollResult, error) {
	if input == nil {
		input = DaggerheartRollInput{}
	}
	source, err := readSystemInput(input, "daggerheart")
	if err != nil {
		return nil, err
	}
	modifierValue, err := readSystemInteger(source, "daggerheart", "modifier", -maxSafeInteger+24, maxSafeInteger-24, false)
	if err != nil {
		return nil, err
	}
	modifier := systemDefault(modifierValue, 0)
	difficulty, err := readSystemInteger(source, "daggerheart", "difficulty", 0, maxSafeInteger, false)
	if err != nil {
		return nil, err
	}
	dice, base, err := executeSystemRoll(engine, "1d12+1d12", systemOptions(options))
	if err != nil {
		return nil, err
	}
	if len(dice) < 2 {
		return nil, fmt.Errorf("Daggerheart Duality Dice must resolve exactly two d12s.")
	}
	hope, err := projectSystemDie(dice[0], DaggerheartHopeD12Profile, "hope", "hope", []string{"hope"})
	if err != nil {
		return nil, err
	}
	fear, err := projectSystemDie(dice[1], DaggerheartFearD12Profile, "fear", "fear", []string{"fear"})
	if err != nil {
		return nil, err
	}
	result := &DaggerheartRollResult{systemResultHeader: systemHeader("daggerheart"), Modifier: modifier, Difficulty: difficulty, DualityTotal: hope.RawValue + fear.RawValue, HopeDie: hope, FearDie: fear, Dice: []DaggerheartDieResult{hope, fear}, BaseRoll: base}
	result.Total = result.DualityTotal + float64(modifier)
	if hope.RawValue == fear.RawValue {
		yes := true
		result.Duality, result.Succeeds, result.Outcome = "critical", &yes, "critical-success"
		return result, nil
	}
	result.Duality = "fear"
	if hope.RawValue > fear.RawValue {
		result.Duality = "hope"
	}
	if difficulty == nil {
		result.Outcome = "pending-with-" + result.Duality
		return result, nil
	}
	succeeds := result.Total >= float64(*difficulty)
	result.Succeeds = &succeeds
	result.Outcome = "failure-with-" + result.Duality
	if succeeds {
		result.Outcome = "success-with-" + result.Duality
	}
	return result, nil
}

func toVampireDie(die ResolvedDie, hunger bool) (VampireV5DieResult, error) {
	profile, kind, face, symbols := VampireV5NormalD10Profile, "normal", "blank", []string{}
	if hunger {
		profile, kind = VampireV5HungerD10Profile, "hunger"
	}
	switch {
	case hunger && die.RawValue == 1:
		face, symbols = "bestial-failure", []string{"bestial-failure"}
	case die.RawValue == 10:
		face, symbols = "critical", []string{"success", "critical"}
		if hunger {
			face = "messy-critical"
			symbols = append(symbols, "messy-critical")
		}
	case die.RawValue >= 6:
		face, symbols = "success", []string{"success"}
	}
	return projectSystemDie(die, profile, kind, face, symbols)
}
func RollVampireV5(input any, options ...SystemRollOptions) (*VampireV5RollResult, error) {
	return RollVampireV5WithEngine(DefaultDiceEngine(), input, options...)
}
func RollVampireV5WithEngine(engine SystemEngine, input any, options ...SystemRollOptions) (*VampireV5RollResult, error) {
	source, err := readSystemInput(input, "vampire-v5")
	if err != nil {
		return nil, err
	}
	pool, err := readSystemInteger(source, "vampire-v5", "pool", 1, maxSafeInteger, true)
	if err != nil {
		return nil, err
	}
	hunger, err := readSystemInteger(source, "vampire-v5", "hunger", 0, 5, true)
	if err != nil {
		return nil, err
	}
	difficulty, err := readSystemInteger(source, "vampire-v5", "difficulty", 0, maxSafeInteger, false)
	if err != nil {
		return nil, err
	}
	hungerCount := min(*pool, *hunger)
	normalCount := *pool - hungerCount
	terms := []string{}
	for _, count := range []int64{normalCount, hungerCount} {
		if count > 0 {
			terms = append(terms, fmt.Sprintf("%dd10", count))
		}
	}
	dice, base, err := executeSystemRoll(engine, strings.Join(terms, "+"), systemOptions(options))
	if err != nil {
		return nil, err
	}
	result := &VampireV5RollResult{systemResultHeader: systemHeader("vampire-v5"), Pool: *pool, Hunger: *hunger, Difficulty: difficulty, NormalDice: normalCount, HungerDice: hungerCount, Outcome: "pending", Dice: []VampireV5DieResult{}, BaseRoll: base}
	tens, hasHungerTen, hasHungerOne := int64(0), false, false
	for index, die := range dice {
		isHunger := int64(index) >= normalCount
		projected, err := toVampireDie(die, isHunger)
		if err != nil {
			return nil, err
		}
		result.Dice = append(result.Dice, projected)
		if die.RawValue >= 6 {
			result.Successes++
		}
		if die.RawValue == 10 {
			tens++
			hasHungerTen = hasHungerTen || isHunger
		} else if die.RawValue == 1 && isHunger {
			hasHungerOne = true
		}
	}
	result.CriticalPairs = tens / 2
	result.Successes += result.CriticalPairs * 2
	if difficulty != nil {
		if result.Successes >= *difficulty {
			result.Outcome = "success"
			if result.CriticalPairs > 0 {
				result.Outcome = "critical-success"
				if hasHungerTen {
					result.Outcome = "messy-critical"
				}
			}
		} else {
			result.Outcome = "failure"
			if hasHungerOne {
				result.Outcome = "bestial-failure"
			}
		}
	}
	return result, nil
}

func systemNumber(value float64) string {
	if value == 0 {
		return "0"
	}
	return seedNumberString(value)
}

type SystemRoller struct{ engine SystemEngine }

func CreateSystemRoller(engine SystemEngine) (*SystemRoller, error) {
	if engine == nil || (reflect.ValueOf(engine).Kind() == reflect.Pointer && reflect.ValueOf(engine).IsNil()) {
		return nil, fmt.Errorf("createSystemRoller requires a DiceEngine")
	}
	return &SystemRoller{engine}, nil
}
func (r *SystemRoller) RollFateDice(input any, options ...SystemRollOptions) (*FateRollResult, error) {
	return RollFateDiceWithEngine(r.engine, input, options...)
}
func (r *SystemRoller) RollAssimilation(input any, options ...SystemRollOptions) (*AssimilationRollResult, error) {
	return RollAssimilationWithEngine(r.engine, input, options...)
}
func (r *SystemRoller) RollDaggerheart(input any, options ...SystemRollOptions) (*DaggerheartRollResult, error) {
	return RollDaggerheartWithEngine(r.engine, input, options...)
}
func (r *SystemRoller) RollVampireV5(input any, options ...SystemRollOptions) (*VampireV5RollResult, error) {
	return RollVampireV5WithEngine(r.engine, input, options...)
}
func (r *SystemRoller) RollMixedDice(input any, options ...MixedRollOptions) (*MixedRollResult, error) {
	return RollMixedDiceWithEngine(r.engine, input, options...)
}
