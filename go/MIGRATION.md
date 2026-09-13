# Native Go migration

## Target and baseline

The target is the same dice language, domain rules, deterministic seeds, and
results as `@erpg/dicecore`, exposed through an idiomatic Go library for the
future server. The migration starts from TypeScript version **3.7.1**, source
commit **1940044**, on branch **Go-Version**. Git does not permit spaces in branch
names.

The TypeScript suite was rerun on 2026-09-13: **548 passing tests, with 100%
statement, branch, function, and line coverage**. Its build, typechecks, and lint
also passed. These tests are a reference for behavior; their coverage does not
transfer automatically to a port in another language.

## Stage 1: syntax and foundations

| Area | Current state |
| --- | --- |
| Module | Independent Go module, standard library only |
| Errors | Structured codes, input, source spans, details, JSON validation |
| Limits and budget | Presets, override caps, work counters, failure without consuming budget |
| Syntax | Scanner, parser, expression and modifier AST, node IDs and UTF-16 spans |
| Normalization | RPG notation aliases, comments, grouped/multiple roll input, computed counts |
| Randomness | MT19937, Xoshiro128**, bounded integer sampling, draw budgeting |
| Seeds | String/number canonicalization, UTF-16 hashing, automatic seed material |
| Replay foundations | Schema validation, seed restoration, deterministic generator restoration |
| Math | Decimal12 rounding, arithmetic and functions; exact transcendental parity incomplete |
| Reference tests | Versioned TypeScript JSON oracle plus native Go tests and parser fuzz target |
| Automation | Go format/vet/tests/race and TypeScript fixture reproduction workflow |

Replay support here means descriptors and RNG restoration. A caller currently
supplies the plan fingerprint. Compiling a formula and replaying its **complete
roll result** are not implemented yet. Likewise, parsing a modifier records its
syntax; it does not execute or semantically validate every modifier combination.

## Validation boundaries

The initial Go suite passed with **98.5% statement coverage**, and `go vet` and
`gofmt` checks passed. This percentage covers only the Go code implemented so far;
it does not measure how much of the TypeScript engine has been migrated. The
regular suite explicitly skips the known cases described below. The strict math
check was also executed and reproduced all eight pending failures.

The oracle contains **539 cases in 11 JSON files**:

| Reference | Cases | Current Go use |
| --- | ---: | --- |
| Normalization | 72 | Compare normalized text and parsed input |
| Parser | 148 | Compare complete AST or structured error |
| Math | 135 | Compare outcomes, including decimal and non-finite boundaries |
| Pending transcendental math | 8 | Explicit skips; strict opt-in reproduces failures |
| RNG | 52 | Compare native-representable cases, draw counts and rejection behavior |
| Seeds | 33 | Compare native-representable cases and seed material |
| Replay descriptors | 24 | Validate descriptors and restored seeds |
| Limits | 19 | Compare native-representable limit operations |
| Budget | 12 | Compare each operation and subsequent state |
| Historical compatibility corpus | 31 | Reserved for compiler/executor stages |
| Full-roll replay | 5 | Reserved for compiler/executor and mixed-system stages |

Cases with malformed JavaScript numeric/structural inputs that cannot be passed
to a typed Go API are explicitly skipped, rather than silently coerced. These
exclusions differ from the eight known math failures. In particular, a native
`int64` counter cannot receive a fractional number, and a `[]uint32` seed cannot
contain a negative or fractional word. Future JSON-facing adapters will need
their own boundary validation.

The parser fuzz target completed **1,224,975 executions in 30 seconds** without a
failure on the development machine. This explores malformed input; it is not a
proof of exhaustive grammar coverage or of readiness for arbitrary request sizes.

The local toolchain has CGO disabled and no C compiler, so local race-detector
validation was unavailable. The workflow is configured to perform that check on
Ubuntu; it has not been run remotely during this initial local migration.

## Known differences to resolve

1. **Canonical transcendental math.** Go's `sin`, `cos`, and `tan` approximations
   can cross a decimal12 rounding boundary relative to the TypeScript reference,
   even for ordinary inputs. For example, `sin(1.4293)` currently normalizes to
   `0.990006085646` in Go versus `0.990006085645` in the reference. The eight
   failing oracle cases remain unchanged in `math-transcendental-pending.json`.
   Run the strict check documented in README.md to enforce them. Passing the
   regular suite does not establish unrestricted math or full replay parity.
2. **String boundaries.** Normal Go strings use UTF-8. Syntax spans count UTF-16
   units, but invalid UTF-8 or isolated JavaScript surrogates cannot round-trip
   through an ordinary Go string. For an invalid astral notation character,
   diagnostic text may contain U+FFFD where TypeScript has an isolated surrogate.
   Seeds provide `UTF16Seed` to preserve original code units for hashing and
   replay; their display string still uses replacement characters.
3. **Server entry point.** Low-level scanner/parser/normalization APIs mirror the
   TypeScript internals and are not independently bounded by default. Check raw
   input before normalization and use validated limits with `ParseNotation`.
   AST node totals are checked after construction, as in TypeScript. Some scanner
   and normalization paths can be quadratic, so request and input caps remain
   relevant. Only deliberate parser `DiceRollError` panics are converted to errors;
   unexpected panics remain visible as bugs.

No Go performance improvement is claimed yet. Compare performance only after
the same roll operations and result modes exist in both implementations.

## Next implementation stages

1. **Compiler and numeric contract:** semantic validation, constant evaluation,
   modifier ordering, impossible reroll/unique detection, execution plans and
   fingerprints. Resolve canonical transcendental behavior without rewriting
   oracle expectations or loosening equality checks.
2. **Generic executor:** dice/group execution, modifiers, random/budget ordering,
   detailed and summary results, event journal, output formatting and limits.
   Activate the historical compatibility and generic full-replay vectors.
3. **Public engine:** ergonomic parse/compile/roll APIs, per-engine configuration,
   plan cache ownership, replay operations and deterministic concurrency tests.
4. **RPG systems:** Assimilation, Daggerheart, Fate, Vampire V5, and mixed notation.
   Match their domain rules and activate all full-roll reference vectors.
5. **Release gate:** expand the original test cases across the implemented Go
   surfaces, close the eight math gaps, add end-to-end differential tests and
   benchmarks for equal workloads, validate races in CI, then version the Go API.

Until these stages pass, this module is a migration work area rather than a
replacement for the production TypeScript library.
