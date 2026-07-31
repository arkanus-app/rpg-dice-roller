# API do `@erpg/dicecore` V3

A V3 publica DTOs `readonly` e JSON-safe. AST, IR, classes do parser e estado interno do RNG não fazem parte do contrato.

## Fachada pública

```ts
createDiceEngine(options?): DiceEngine
compileRpgDice(input, options?): RollPlan
rollRpgDice(inputOrPlan, options?): DiceRollResult
rollRpgDiceSummary(inputOrPlan, options?): DiceRollSummary
rollMixedDice(notation, options?): MixedRollResult
rollFateDice(input?, options?): FateRollResult
rollVampireV5(input, options?): VampireV5RollResult
rollAssimilation(input, options?): AssimilationRollResult
evaluateAssimilationSelection(roll, selectedIds): AssimilationSelectionResult
inspectRpgDiceNotation(input, options?): DiceNotationInspection
verifyRpgDiceNotation(input, options?): boolean
normalizeRpgDiceNotation(input): string
isDiceRollError(error): error is DiceRollError
isDiceRollErrorData(value): value is DiceErrorData
```

`DiceRollError.fromJSON(data)` restaura erros validados recebidos de workers, outros realms ou transporte JSON.

## Notação mista

`rollMixedDice()` separa rolagens de nível superior por `;`. Cada segmento
genérico continua usando a gramática V3 completa; chamadas de sistema usam:

```text
v5(pool=7,hunger=3,difficulty=4)
fate(dice=4)
assim(d6=2,d10=1,d12=1,keep=1)
```

As formas posicionais equivalentes são `v5(7,3,4)`, `fate(4)` e
`assim(2,1,1,1)`. Exemplo completo:

```ts
const result = rollMixedDice(
  '2d20+5; v5(7,3,4); fate(4); assim(2,1,1,1)',
  { seed: 'misto-42' },
)
```

```ts
interface MixedRollResult {
  readonly type: 'mixed-roll'
  readonly schemaVersion: 1
  readonly input: string
  readonly notation: string
  readonly rolls: readonly MixedRollItem[]
  readonly dice: readonly MixedRollDieResult[]
  readonly output: string
  readonly replay: MixedRollReplayDescriptor
  readonly stats: ExecutionStats
}
```

`rolls` preserva o resultado completo e discriminado de cada segmento.
`dice` achata todos os dados em ordem, prefixa IDs para evitar colisões e
inclui `physicalValue`, que representa a última face realmente rolada antes
de transforms como `min`, `max` e compound. Dados de sistema mantêm
`profileId`, `faceKey` e `symbols`.

Não existe `total` no lote porque totais genéricos, sucessos de Vampiro,
resultado Fate e símbolos de Assimilação não devem ser somados. O replay é
restaurado com:

```ts
rollMixedDice(result.input, { replay: result.replay })
```

Os limites são avaliados sobre o lote agregado. A seed informada gera streams
independentes por segmento; sem seed, cada segmento usa entropia criptográfica
e todos os descritores necessários permanecem em `result.replay`.

## Dados de sistema

As rolagens de sistema são aditivas: não alteram a gramática, `ResolvedDie` ou
o schema do resultado genérico. Todas contêm `baseRoll: DiceRollResult` e uma
projeção semântica em `dice`.

```ts
interface SystemDieResult<
  ProfileId extends string = string,
  DieKind extends string = string,
  FaceKey extends string = string,
  SymbolId extends string = string,
> {
  readonly id: string
  readonly sourceDieId: string
  readonly sides: number
  readonly value: number
  readonly rawValue: number
  readonly profileId: ProfileId
  readonly dieKind: DieKind
  readonly faceKey: FaceKey
  readonly symbols: readonly SymbolId[]
}
```

`sourceDieId` referencia `baseRoll.dice[].id`. O `id` semântico é
`${profileId}:${sourceDieId}` e deve ser usado por seleção e renderização.
Assets não fazem parte deste pacote.

### Fate/Fudge

```ts
interface FateRollInput {
  readonly dice?: number // padrão 4; inteiro >= 1
}

interface FateRollResult {
  readonly type: 'fate-roll'
  readonly schemaVersion: 1
  readonly system: 'fate'
  readonly rulesVersion: 1
  readonly diceCount: number
  readonly total: number
  readonly dice: readonly FateDieResult[]
  readonly baseRoll: DiceRollResult
}
```

O perfil é `fate-df`. Cada dado semântico tem `sides: 6`, a face física em
`rawValue`/`value` e `fateValue: -1 | 0 | 1`. Faces 1–2 são `minus`, 3–4
`blank` e 5–6 `plus`; `total` soma `fateValue`. O `baseRoll` usa `Nd6` para
preservar a face física no replay, pois a notação genérica `dF` expõe somente
o valor Fate já convertido.

### Vampiro V5

```ts
interface VampireV5RollInput {
  readonly pool: number       // inteiro >= 1
  readonly hunger: number     // inteiro de 0 a 5
  readonly difficulty?: number
}

interface VampireV5RollResult {
  readonly type: 'vampire-v5-roll'
  readonly schemaVersion: 1
  readonly system: 'vampire-v5'
  readonly rulesVersion: 1
  readonly pool: number
  readonly hunger: number
  readonly difficulty: number | null
  readonly normalDice: number
  readonly hungerDice: number
  readonly successes: number
  readonly criticalPairs: number
  readonly outcome:
    | 'pending'
    | 'success'
    | 'critical-success'
    | 'messy-critical'
    | 'failure'
    | 'bestial-failure'
  readonly dice: readonly VampireV5DieResult[]
  readonly baseRoll: DiceRollResult
}
```

`hungerDice` é `min(pool, hunger)` e o restante é normal. Os perfis são:

- `vampire-v5-normal-d10`: 1–5 `blank`, 6–9 `success`, 10 `critical`;
- `vampire-v5-hunger-d10`: 1 `bestial-failure`, 2–5 `blank`, 6–9
  `success`, 10 `messy-critical`.

Cada 6–10 vale um sucesso e cada par de 10 acrescenta dois. Um crítico
vitorioso com ao menos um 10 de Fome é `messy-critical`; uma falha com ao
menos um 1 de Fome é `bestial-failure`. Sem dificuldade, `outcome` é
`pending`.

### Assimilação

```ts
interface AssimilationRollInput {
  readonly d6?: number
  readonly d10?: number
  readonly d12?: number
  readonly keep?: number // padrão 1; no máximo o total do pool
}

interface AssimilationRollResult {
  readonly type: 'assimilation-roll'
  readonly schemaVersion: 1
  readonly system: 'assimilation'
  readonly rulesVersion: 1
  readonly d6: number
  readonly d10: number
  readonly d12: number
  readonly totalDice: number
  readonly keep: number
  readonly dice: readonly AssimilationDieResult[]
  readonly baseRoll: DiceRollResult
}
```

Os perfis são `assimilation-d6`, `assimilation-d10` e `assimilation-d12`.
As faces usam esta tabela:

| Face | Símbolos |
| --- | --- |
| 1–2 | nenhum |
| 3–4 | `pressure` |
| 5 | `adaptation`, `pressure` |
| 6 | `success` |
| 7 | `success`, `success` |
| 8 | `success`, `adaptation` |
| 9 | `success`, `adaptation`, `pressure` |
| 10 | `success`, `success`, `pressure` |
| 11 | `success`, `adaptation`, `adaptation`, `pressure` |
| 12 | `pressure`, `pressure` |

d6 usa as faces 1–6, d10 usa 1–10 e d12 usa 1–12. A rolagem não escolhe
resultado automaticamente. A seleção explícita preserva a ordem recebida:

```ts
const roll = rollAssimilation({ d6: 1, d10: 1, d12: 1, keep: 2 })
const result = evaluateAssimilationSelection(
  roll,
  [roll.dice[2].id, roll.dice[0].id],
)

result.success
result.adaptation
result.pressure
```

IDs duplicados, desconhecidos ou uma seleção maior que `keep` geram
`INVALID_SYSTEM_INPUT`.

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

O journal segue a ordem em que o executor materializa os fatos. Em uma explosão, o evento `roll` do filho (identificado por `parentDieId`) é registrado antes do `explode` que contém `childDieId`; em penetrate, o `transform` do filho também antecede esse vínculo. Adaptadores cronológicos devem indexar o journal completo e montar dependências por IDs, não reproduzir o array cegamente evento por evento.

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
