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
	events      []DiceEvent
}

func NewExecutionJournal(budget EventBudget, materialize ...bool) *ExecutionJournal {
	collect := true
	if len(materialize) > 0 {
		collect = materialize[0]
	}
	return &ExecutionJournal{budget: budget, materialize: collect, events: []DiceEvent{}}
}
func (j *ExecutionJournal) Length() int64 { return j.eventCount }
func (j *ExecutionJournal) Record(input DiceEvent) (DiceEvent, error) {
	if j.budget != nil {
		if err := j.budget.ConsumeEvents(1); err != nil {
			return nil, err
		}
		if err := j.budget.ConsumeResultItems(1); err != nil {
			return nil, err
		}
	}
	j.eventCount++
	if !j.materialize {
		return nil, nil
	}
	event := DiceEvent{"sequence": j.eventCount}
	for key, value := range input {
		event[key] = value
	}
	j.events = append(j.events, event)
	return event, nil
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
	return append([]DiceEvent{}, j.events[start:last]...)
}
func (j *ExecutionJournal) ToArray() []DiceEvent {
	if !j.materialize {
		return []DiceEvent{}
	}
	return append([]DiceEvent{}, j.events...)
}
