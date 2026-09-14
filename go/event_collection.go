package dicecore

// ResolvedEvents is the fully materialized event collection of a full roll.
// Its encoder appends to one buffer; the result envelope keeps encoding/json's
// ordinary struct encoder and its handling of other public fields.
type ResolvedEvents []ResolvedEvent

func (events ResolvedEvents) MarshalJSON() ([]byte, error) {
	if events == nil {
		return []byte("null"), nil
	}
	output := make([]byte, 0, len(events)*192+2)
	output = append(output, '[')
	for index := range events {
		if index > 0 {
			output = append(output, ',')
		}
		var err error
		output, err = events[index].appendJSON(output)
		if err != nil {
			return nil, err
		}
	}
	return append(output, ']'), nil
}
