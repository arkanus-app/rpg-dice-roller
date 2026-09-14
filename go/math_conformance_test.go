package dicecore

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"reflect"
	"strconv"
	"testing"
)

type mathConformanceCase struct {
	Function   string          `json:"function"`
	Args       []string        `json:"args"`
	ResultBits string          `json:"resultBits"`
	Error      json.RawMessage `json:"error"`
}

func TestMathConformance(t *testing.T) {
	path := os.Getenv("DICECORE_MATH_CONFORMANCE_FIXTURE")
	if path == "" {
		path = "testdata/math-conformance.json"
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		SchemaVersion int                   `json:"schemaVersion"`
		Cases         []mathConformanceCase `json:"cases"`
	}
	if err = json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	if corpus.SchemaVersion != 1 || len(corpus.Cases) == 0 {
		t.Fatal("invalid conformance corpus")
	}
	failures := 0
	byFunction := map[string]int{}
	failedCases := []mathConformanceCase{}
	for index, entry := range corpus.Cases {
		args := make([]float64, len(entry.Args))
		for i, encoded := range entry.Args {
			word, err := strconv.ParseUint(encoded, 16, 64)
			if err != nil {
				t.Fatal(err)
			}
			args[i] = math.Float64frombits(word)
		}
		var value float64
		var executionError error
		if len(args) == 1 {
			value, executionError = EvaluateUnaryFunction(entry.Function, args[0], "math-conformance")
		} else {
			value, executionError = EvaluateBinaryFunction(entry.Function, args[0], args[1], "math-conformance")
		}
		matches := false
		if len(entry.Error) > 0 {
			var diceErr *DiceRollError
			if errors.As(executionError, &diceErr) {
				encoded, err := json.Marshal(diceErr)
				if err != nil {
					t.Fatal(err)
				}
				var got, want any
				if err = json.Unmarshal(encoded, &got); err != nil {
					t.Fatal(err)
				}
				if err = json.Unmarshal(entry.Error, &want); err != nil {
					t.Fatal(err)
				}
				matches = reflect.DeepEqual(got, want)
			}
		} else if executionError == nil {
			want, err := strconv.ParseUint(entry.ResultBits, 16, 64)
			if err != nil {
				t.Fatal(err)
			}
			matches = math.Float64bits(value) == want
		}
		if !matches {
			failures++
			byFunction[entry.Function]++
			failedCases = append(failedCases, entry)
			if failures <= 30 {
				t.Logf("case %d %s args=%v decimal=%v: got %.17g bits=%016x err=%v; want bits=%s error=%s", index, entry.Function, entry.Args, args, value, math.Float64bits(value), executionError, entry.ResultBits, entry.Error)
			}
		}
	}
	if output := os.Getenv("DICECORE_MATH_FAILURE_OUTPUT"); output != "" {
		encoded, err := json.MarshalIndent(struct {
			SchemaVersion int                   `json:"schemaVersion"`
			Cases         []mathConformanceCase `json:"cases"`
		}{1, failedCases}, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(output, encoded, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if failures > 0 {
		t.Fatalf("%d/%d exact math cases differ from Node/V8: %v", failures, len(corpus.Cases), byFunction)
	}
	t.Logf("%d exact math cases matched Node/V8", len(corpus.Cases))
}
