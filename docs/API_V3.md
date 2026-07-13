# API do `@erpg/dicecore` V3

A V3 publica DTOs `readonly` e JSON-safe. AST, IR, classes do parser e estado interno do RNG não fazem parte do contrato.

## Fachada pública

```ts
createDiceEngine(options?): DiceEngine
compileRpgDice(input, options?): RollPlan
rollRpgDice(inputOrPlan, options?): DiceRollResult
rollRpgDiceSummary(inputOrPlan, options?): DiceRollSummary
inspectRpgDiceNotation(input, options?): DiceNotationInspection
verifyRpgDiceNotation(input, options?): boolean
normalizeRpgDiceNotation(input): string
isDiceRollError(error): error is DiceRollError
isDiceRollErrorData(value): value is DiceErrorData
```

`DiceRollError.fromJSON(data)` restaura erros validados recebidos de workers, outros realms ou transporte JSON.

## Engine, cache e opções

```ts
interface DiceCacheOptions {
  readonly maxInputEntries?: number       // 500
  readonly maxProgramEntries?: number     // 200
  readonly maxProgramNodes?: number       // 100_000
}

interface DiceEngineOptions {
  readonly limits?: Partial<DiceLimits>
  readonly freezeResults?: 'development' | 'always' | 'never'
  readonly cache?: false | DiceCacheOptions
  readonly randomAlgorithm?: 'mt19937' | 'xoshiro128ss'
}

interface DiceEngine {
  readonly limits: DiceLimits
  clearCache(): void
  getCacheStats(): DiceCacheStats
  compile(input: string, options?): RollPlan
  inspect(input: string, options?): DiceNotationInspection
  normalize(input: string): string
  roll(inputOrPlan: string | RollPlan, options?): DiceRollResult
  rollSummary(inputOrPlan: string | RollPlan, options?): DiceRollSummary
  verify(input: string, options?): boolean
}
```

O cache de entrada preserva envelopes, comentários e multi-roll. O cache de programa reutiliza a IR normalizada. Ambos são LRUs limitados; o segundo também é limitado pelo peso em nós. `clearCache()` remove entradas e zera estatísticas.

`freezeResults` usa `never` por padrão. `development` congela somente quando o ambiente declara explicitamente `NODE_ENV=development`. Planos públicos são sempre imutáveis.

MT19937 é o algoritmo padrão. `xoshiro128ss` é opt-in por engine ou rolagem. Um replay sempre define o algoritmo e não aceita override.

## Limites

```ts
const DEFAULT_DICE_LIMITS = {
  maxInputLength: 4_096,
  maxAstDepth: 64,
  maxAstNodes: 10_000,
  maxRolls: 100,
  maxInitialDice: 10_000,
  maxGeneratedDice: 20_000,
  maxRandomCalls: 100_000,
  maxEvents: 100_000,
  maxSides: 4_294_967_296,
  maxSeedLength: 1_024,
  maxModifierSteps: 100_000,
  maxResolvedGroups: 100_000,
  maxResultItems: 250_000,
  maxOutputLength: 1_000_000,
} as const
```

Todos são inteiros positivos. Os limites do engine são tetos imutáveis; uma chamada pode apenas reduzi-los. Profundidade e nós são cobrados durante o parsing. Dados, grupos, eventos e itens do resultado são cobrados antes da inserção. Loops dinâmicos de modificadores consomem `maxModifierSteps`.

`1d1!`, `1d1r`, condições comprovadamente infinitas e unique impossível são rejeitados com erros estruturados. Dados aceitam no máximo `2^32` lados. Em grupos `{...}`, apenas `keep`, `drop` e `sort` são válidos.

## Plano compilado

```ts
interface RollPlan {
  readonly type: 'roll-plan'
  readonly schemaVersion: 3
  readonly compilerVersion: 1
  readonly planFingerprint: string // 32 hex
  readonly input: string
  readonly comment: string
  readonly notation: string
  readonly normalizedNotation: string
  readonly isMultiRoll: boolean
  readonly rollCount: number
  readonly groups: readonly RollPlanGroup[]
  readonly cost: DiceInspectionCost
}
```

Planos conhecidos executam diretamente pela IR guardada em `WeakMap`. Um plano desserializado fornece apenas `input` e `planFingerprint`: o engine recompila a entrada e compara o fingerprint, ignorando arrays externos. O replay também é vinculado a esse fingerprint.

## Resultado completo e ranges

```ts
interface EntityRange {
  readonly start: number
  readonly count: number
}

interface ResolvedRoll {
  readonly index: number
  readonly total: number
  readonly pool: PoolSummary | null
  readonly diceRange: EntityRange
  readonly groupRange: EntityRange
  readonly eventRange: EntityRange
}

interface DiceRollResult {
  readonly type: 'dice-roll'
  readonly schemaVersion: 3
  readonly input: string
  readonly notation: string
  readonly normalizedNotation: string
  readonly comment: string
  readonly total: number
  readonly output: string
  readonly replay: ReplayDescriptor
  readonly stats: ExecutionStats
  readonly rolls: readonly ResolvedRoll[]
  readonly groups: readonly ResolvedGroup[]
  readonly dice: readonly ResolvedDie[]
  readonly events: readonly DiceEvent[]
  readonly pool: PoolSummary | null
}
```

`dice`, `groups` e `events` existem somente na raiz. Cada roll referencia um intervalo contíguo:

```ts
const roll = result.rolls[0]
const dice = result.dice.slice(
  roll.diceRange.start,
  roll.diceRange.start + roll.diceRange.count,
)
```

Em `N#formula`, o total raiz permanece a soma dos rolls independentes. `pool` é `null` sem target. `output` é conveniência de apresentação e respeita `maxOutputLength`; persistência deve usar os campos estruturados.

`ResolvedDie` separa `rawValue`, `value`, `contribution`, `included`, `states`, `sides`, `id` e `parentDieId`. `ResolvedGroup` expõe `value`, `contribution`, `included`, estados, filhos e source span. Eventos discriminam `subject: 'die' | 'group'` e registram rolls, rerolls, explosões, transformações, inclusão, exclusão e classificação em sequência causal global.

## Summary e estatísticas

```ts
interface ExecutionStats {
  readonly rolls: number
  readonly initialDice: number
  readonly generatedDice: number
  readonly randomCalls: number
  readonly modifierSteps: number
  readonly events: number
  readonly resolvedGroups: number
  readonly resultItems: number
}

interface DiceRollSummary {
  readonly type: 'dice-roll-summary'
  readonly schemaVersion: 3
  readonly input: string
  readonly notation: string
  readonly normalizedNotation: string
  readonly comment: string
  readonly total: number
  readonly replay: ReplayDescriptor
  readonly stats: ExecutionStats
  readonly rolls: readonly ResolvedRollSummary[]
  readonly pool: PoolSummary | null
}
```

Summary não materializa DTOs de dados, grupos, eventos ou output. Com o mesmo replay, full e summary têm totais, pools e estatísticas lógicas idênticas.

## Replay determinístico

```ts
interface ReplayDescriptor {
  readonly schemaVersion: 2
  readonly algorithm: 'mt19937' | 'xoshiro128ss'
  readonly algorithmVersion: 1
  readonly executionVersion: 1
  readonly mathProfile: 'decimal12-v1'
  readonly origin: 'provided-number' | 'provided-string' | 'crypto'
  readonly seedMaterial: string    // 32 hex, nunca a seed textual
  readonly planFingerprint: string // 32 hex
}
```

Seeds numéricas e textuais usam namespaces distintos. Sem seed, o core exige 128 bits de `globalThis.crypto.getRandomValues`; nunca usa `Math.random`. `seed` e `replay` são mutuamente exclusivos. Outra fórmula produz `REPLAY_PLAN_MISMATCH`.

O perfil `decimal12-v1` normaliza operações intermediárias e `-0`; o total final mantém arredondamento compatível em duas casas. Repetir fórmula e descriptor na mesma versão produz o DTO completo byte-idêntico em runtimes suportados.

## Erros e transporte

`DiceRollError` contém `code`, `span`, `input`, `details` JSON-safe e `toJSON()`. Use códigos em vez de comparar mensagens.

```ts
try {
  return rollRpgDice(input, options)
} catch (error: unknown) {
  if (!isDiceRollError(error)) throw error
  return error.toJSON()
}

const received: unknown = JSON.parse(payload)
if (isDiceRollErrorData(received)) {
  throw DiceRollError.fromJSON(received)
}
```

Os códigos cobrem parsing, todos os limites, RNG indisponível, seed/replay malformados, mismatch de plano, modificador não terminante, unique impossível, modificador de grupo não suportado e resultado matemático não finito.
