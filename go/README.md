# Dicecore for Go — migration in progress

This directory is the native Go implementation of `@erpg/dicecore`, developed
alongside the TypeScript library for a future Go server. It is an independent Go
module with no external runtime dependencies:

```text
github.com/arkanus-app/rpg-dice-roller/go
```

**The first migration milestone contains syntax and runtime foundations. There
is no complete `Roll` engine yet.** The compiler, execution of modifiers, result
materialization, and RPG system adapters are the next stages. See
[MIGRATION.md](MIGRATION.md) for the implementation and validation status.

Implemented surfaces include:

- Tokenization, expression AST, notation normalization, comments and roll counts.
- Structured errors, limit presets, and per-execution resource counters.
- Seed canonicalization, MT19937, Xoshiro128**, and replay descriptor validation
  and RNG restoration.
- Decimal12 normalization and math primitives. Exact `sin`/`cos`/`tan` parity is
  still pending; the outstanding reference cases are tracked explicitly.

The public API follows Go conventions (`value, error`, native integer types,
per-execution state). API stability is not promised during migration. The future
server will import this module directly; frontend integration is outside its
scope.

## Parse a formula

From a Go program using this module:

```go
package main

import (
    "fmt"

    dicecore "github.com/arkanus-app/rpg-dice-roller/go"
)

func main() {
    input := "4d6kh3 + 2"
    limits := dicecore.UntrustedServerDiceLimits()
    budget := dicecore.NewExecutionBudget(limits)
    if err := budget.AssertInputLength(input); err != nil {
        panic(err)
    }
    normalized := dicecore.ParseNormalizedInput(input)
    tree, err := dicecore.ParseNotation(normalized.NormalizedNotation, limits)
    if err != nil {
        panic(err)
    }
    fmt.Println(tree.Kind) // binary; parsing does not execute the dice
}
```

The raw-input check precedes normalization because normalization itself is a
low-level, unbounded operation. `ParseNotation` then applies input, AST depth and
node limits to the formula. Use `CreateDiceLimits` for custom overrides, or call
`Validate` on manually constructed limits. A future HTTP adapter must also bound
request bytes before decoding input.

Random generators and execution budgets belong to one execution. Independent
executions can run concurrently with separate instances. String and numeric
seeds have distinct identities, matching the TypeScript implementation.

## Develop and verify

Go 1.26 or newer is required; this milestone was tested with Go 1.26.2. From this
directory:

```sh
go test ./...
go vet ./...
go test -coverprofile=coverage.out ./...
go tool cover -func=coverage.out
```

The GitHub Actions workflow also runs `go test -race ./...` on Linux. The race
detector requires a compatible platform and C toolchain.

To regenerate or verify the TypeScript oracle, run from the **repository root**
with the existing npm development dependencies installed:

```sh
npm run build
node scripts/generate-go-fixtures.mjs --check
# Deliberate reference updates only:
node scripts/generate-go-fixtures.mjs
```

See [testdata/README.md](testdata/README.md) for fixture provenance, special
numbers, UTF-16 handling, and future execution vectors. Stored fixtures include
later migration stages and are not all passing Go conformance tests yet.

To reproduce the known transcendental conformance failures rather than skip them:

```sh
DICECORE_STRICT_MATH=1 go test -run TestTypeScriptMathPendingConformance -v
```

On PowerShell, set `$env:DICECORE_STRICT_MATH = '1'`, run the same `go test`
command without the prefix, and remove the variable afterwards. This check is
expected to fail at this milestone and is a gate for the later full-parity stage.

The repository's [license](../licence.txt) applies to this implementation.
