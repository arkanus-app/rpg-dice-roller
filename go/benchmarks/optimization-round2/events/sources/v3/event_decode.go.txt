package dicecore

import "encoding/json"

// UnmarshalJSON restores the public flat event schema into its native typed
// representation, including payloads used by injected engines and saved rolls.
func (event *ResolvedEvent) UnmarshalJSON(data []byte) error {
	var wire struct {
		Sequence     int64           `json:"sequence"`
		RollIndex    int64           `json:"rollIndex"`
		Type         string          `json:"type"`
		Subject      string          `json:"subject"`
		SourceNodeID string          `json:"sourceNodeId"`
		DieID        string          `json:"dieId"`
		ParentDieID  *string         `json:"parentDieId"`
		GroupID      string          `json:"groupId"`
		Value        float64         `json:"value"`
		Contribution float64         `json:"contribution"`
		ChildDieID   string          `json:"childDieId"`
		Reason       string          `json:"reason"`
		Outcome      string          `json:"outcome"`
		From         json.RawMessage `json:"from"`
		To           json.RawMessage `json:"to"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return err
	}
	resolved := ResolvedEvent{Sequence: wire.Sequence, RollIndex: wire.RollIndex, Type: wire.Type, Subject: wire.Subject, SourceNodeID: wire.SourceNodeID, DieID: wire.DieID, Value: wire.Value, Contribution: wire.Contribution}
	if wire.ParentDieID != nil {
		resolved.ParentDieID, resolved.HasParent = *wire.ParentDieID, true
	}
	if wire.Subject == "group" || wire.Type == "reroll" || wire.Type == "transform" || wire.Type == "explode" || wire.Type == "exclude" || wire.Type == "classify" {
		details := &ResolvedEventDetails{GroupID: wire.GroupID, ChildDieID: wire.ChildDieID, Reason: wire.Reason, Outcome: wire.Outcome}
		if len(wire.From) > 0 {
			var target any = &details.From
			if wire.Subject == "group" {
				target = &details.FromIDs
			}
			if err := json.Unmarshal(wire.From, target); err != nil {
				return err
			}
		}
		if len(wire.To) > 0 {
			var target any = &details.To
			if wire.Subject == "group" {
				target = &details.ToIDs
			}
			if err := json.Unmarshal(wire.To, target); err != nil {
				return err
			}
		}
		resolved.Details = details
	}
	*event = resolved
	return nil
}
