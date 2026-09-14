package dicecore

type EventBudget interface {
	ConsumeEvents(count int64) error
	ConsumeResultItems(count int64) error
}

// ExecutionJournal counts all logical events, even when materialization is off.
type ExecutionJournal struct {
	budget      EventBudget
	materialize bool
	eventCount  int64
	events      []ResolvedEvent
}

func NewExecutionJournal(budget EventBudget, materialize ...bool) *ExecutionJournal {
	collect := true
	if len(materialize) > 0 {
		collect = materialize[0]
	}
	return &ExecutionJournal{budget: budget, materialize: collect, events: []ResolvedEvent{}}
}
func (j *ExecutionJournal) Length() int64 { return j.eventCount }
func (j *ExecutionJournal) Record(input DiceEvent) (DiceEvent, error) {
	if err := j.consumeEvent(); err != nil {
		return nil, err
	}
	if !j.materialize {
		return nil, nil
	}
	event := DiceEvent{"sequence": j.eventCount}
	for key, value := range input {
		event[key] = value
	}
	j.events = append(j.events, ResolvedEvent{legacy: event})
	return event, nil
}

// The executor stores concrete, fully resolved values. The map-based public
// journal remains available without adding maps to the normal execution path.
func (j *ExecutionJournal) recordResolved(event ResolvedEvent) error {
	if err := j.consumeEvent(); err != nil {
		return err
	}
	if j.materialize {
		event.Sequence = j.eventCount
		j.events = append(j.events, event)
	}
	return nil
}

func (j *ExecutionJournal) consumeEvent() error {
	if j.budget != nil {
		if err := j.budget.ConsumeEvents(1); err != nil {
			return err
		}
		if err := j.budget.ConsumeResultItems(1); err != nil {
			return err
		}
	}
	j.eventCount++
	return nil
}
func (j *ExecutionJournal) Slice(start int64, end ...int64) []DiceEvent {
	if !j.materialize {
		return []DiceEvent{}
	}
	length := int64(len(j.events))
	last := length
	if len(end) > 0 {
		last = end[0]
	}
	if start < 0 {
		start = max(0, length+start)
	} else {
		start = min(start, length)
	}
	if last < 0 {
		last = max(0, length+last)
	} else {
		last = min(last, length)
	}
	last = max(start, last)
	result := make([]DiceEvent, last-start)
	for index := range result {
		result[index] = j.events[int(start)+index].asDiceEvent()
	}
	return result
}
func (j *ExecutionJournal) ToArray() []DiceEvent {
	return j.Slice(0)
}

// takeResolvedEvents transfers the finished execution's slice to its result.
// The private execution context is no longer used once the result is returned.
func (j *ExecutionJournal) takeResolvedEvents() []ResolvedEvent { return j.events }
