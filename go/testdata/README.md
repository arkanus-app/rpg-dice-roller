# TypeScript oracle fixtures

These files record the behavior of `@erpg/dicecore` 3.7.1 at source commit
`1940044`. They are generated independently of the Go implementation, from the
TypeScript implementation and the existing compatibility corpus. There are no
timestamps or automatically generated seeds.

From the repository root, with its existing development dependencies installed:

```sh
npm run build
node scripts/generate-go-fixtures.mjs
node scripts/generate-go-fixtures.mjs --check
```

`--check` recomputes the oracle and compares the committed bytes without rewriting
them. The generator imports public functions from `dist`, and uses the existing
`tsx/esm/api` development dependency for internal TypeScript functions. Build
first so public outputs and source belong to the same revision. Review provenance
and semantic changes deliberately before updating these references.

Every JSON file has `schemaVersion`, `provenance`, and `cases`. Ordinary cases have
`name`, their operation inputs, and `outcome`: either `{ "value": ... }` or
`{ "error": ... }`. Dice errors use the original `toJSON()` representation,
including code, message, input, half-open UTF-16 source span, and details. Native
errors retain their name and message.

JSON cannot represent non-finite numbers or preserve negative zero. Numeric input
positions encode those values as the strings `NaN`, `Infinity`, `-Infinity`, and
`-0`. In seed cases, `seedType` distinguishes encoded numbers from literal string
seeds. String seeds also include `seedUTF16` so runtimes with UTF-8 strings can
reconstruct Unicode and unpaired UTF-16 surrogates without losing the original
JavaScript input semantics. Success outputs follow ordinary JavaScript JSON wire
semantics: negative zero becomes zero, as in the existing replay checks.

| File | Reference surface |
| --- | --- |
| `normalization.json` | Public normalized string in `outcome`; parsed input, comments, count, and notation in `parsedOutcome` |
| `parser.json` | AST including IDs, spans, modifiers, and parser errors; optional `limits` uses `maxDepth` and `maxNodes` |
| `math.json` | `operation`, `args`, and `input`; decimal12 normalization, operators, functions, comparisons, final rounding |
| `math-transcendental-pending.json` | Eight TypeScript oracle cases documenting known pending exact conformance for sine, cosine, and tangent; explicitly skipped by initial Go conformance tests |
| `rng.json` | Algorithm, numeric/word-array seed, operation and count; `value` contains `values` plus consumed `randomCalls` |
| `seeds.json` | Seed type/value and optional `maxSeedLength`; canonical seed, material, origin, and four words |
| `replay.json` | Descriptor validation in `outcome`, restored seed in `seedOutcome`, and `isReplayDescriptor` |
| `limits.json` | `create`, `preset`, or `resolve`, with overrides and optional engine overrides |
| `budget.json` | Per-operation outcomes, then final `snapshot` and `stats`; rejected consumption does not alter counters |
| `compatibility-corpus.json` | Existing frozen V2/V3 corpus copied without recalculating its expected values |
| `full-roll-replay.json` | Complete current TypeScript generic/mixed roll outputs from existing cross-runtime replay vectors |

The budget fixture intentionally has outcomes per operation rather than per case
so that errors and subsequent state can both be checked. RNG fixtures cross the
MT19937 624-word twist boundary and include ranges that require rejected samples;
`randomCalls` detects differences hidden by checking returned values alone.

The historical compatibility and full-roll replay files prepare later migration
stages. Their presence does not mean that Go already supports the compiler,
executor, modifiers, or RPG system adapters. Cross-runtime fixtures supplement
the original TypeScript test suite; they do not establish exhaustive Go coverage.

The pending transcendental cases include ordinary decimal inputs, not only large
magnitudes. Standard-library function approximations can land on different sides
of a decimal12 rounding boundary. These references deliberately retain the
TypeScript result and must not be rewritten to match the current Go result. Exact
transcendental behavior remains required before claiming unrestricted arithmetic
or replay compatibility.
