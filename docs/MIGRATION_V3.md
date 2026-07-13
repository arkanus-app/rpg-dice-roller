# Migração do @erpg/dicecore V2 para V3

A V3 preserva a fachada funcional de normalização, inspeção, validação e rolagem, mas substitui o parser, o runtime e o DTO público. A migração deve remover acessos ao snapshot e tratar os novos tipos explícitos em vez de reconstruir o resultado legado.

## Requisitos e importação

- atualize o runtime para Node.js 22 ou superior;
- consuma somente o entrypoint `@erpg/dicecore` por ESM ou CommonJS;
- remova imports profundos de classes, parser, modificadores, `lib/` ou `types/`;
- compile TypeScript consumidor com um modo moderno, como `NodeNext`, ou use o bundle CommonJS publicado.

```ts
// V2
import {
  parseRpgDiceInput,
  rollRpgDice,
} from '@erpg/dicecore';

// V3
import {
  compileRpgDice,
  inspectRpgDiceNotation,
  rollRpgDice,
} from '@erpg/dicecore';
```

## Mudanças de API

### Funções removidas

| V2 | Substituição V3 |
| --- | --- |
| `parseRpgDiceInput(input)` | `compileRpgDice(input)` ou `inspectRpgDiceNotation(input)` |
| `extractRpgDiceGroups(input)` | `plan.groups`, `inspection.groups` ou `result.groups` |
| `countRpgDiceInNotation(input)` | `plan.cost.staticDice` / `plan.cost.totalStaticDice` |
| `cleanRpgDiceNotation` | `normalizeRpgDiceNotation` |
| `extractRpgDiceComment` | `plan.comment`, `inspection.comment` ou `result.comment` |
| `RpgDiceRollError` | `DiceRollError` e `isDiceRollError` |

`parseRpgDiceInput` retornava somente metadados superficiais. `compileRpgDice` agora valida a sintaxe completa e produz um plano reutilizável. Para formulários e editores, prefira `inspectRpgDiceNotation`, que transforma uma notação inválida em dados de inspeção em vez de lançar.

```ts
const inspection = inspectRpgDiceNotation(userInput);

if (!inspection.isValid) {
  showError(inspection.error.code);
  return;
}

const result = rollRpgDice(inspection.plan);
```

### Opções e limites

```ts
// V2
rollRpgDice(input, {
  maxDice: 9_999,
  maxRolls: 20,
  seed: 'combate-7',
});

// V3
rollRpgDice(input, {
  seed: 'combate-7',
  limits: {
    maxRolls: 20,
    maxInitialDice: 9_999,
    maxGeneratedDice: 20_000,
    maxRandomCalls: 100_000,
    maxEvents: 100_000,
  },
});
```

O antigo `maxRolls` vira `limits.maxRolls`. O antigo `maxDice` não tem equivalência única:

- use `maxInitialDice` para limitar os dados declarados na fórmula, já multiplicados por `N#`;
- defina `maxGeneratedDice` para explosões;
- defina `maxRandomCalls` para rolls, rerolls e tentativas de unique;
- defina `maxEvents` para limitar o journal produzido.

Não copie `maxDice` cegamente para todos esses campos. Escolha tetos compatíveis com a carga que o frontend ou backend pode processar. Há ainda `maxInputLength`, `maxAstDepth` e `maxAstNodes` para proteger compilação e parsing.

Para políticas centralizadas, crie um engine. Limites por chamada podem somente reduzir os tetos da instância:

```ts
const dice = createDiceEngine({
  limits: {
    maxRolls: 20,
    maxInitialDice: 2_000,
    maxGeneratedDice: 5_000,
    maxRandomCalls: 20_000,
    maxEvents: 20_000,
  },
});

const result = dice.roll(input, {
  limits: { maxInitialDice: 100 },
});
```

## Migração do resultado

### Raiz e multi-roll

| V2 | V3 |
| --- | --- |
| `type: 'rpg-dice-roll'` | `type: 'dice-roll'` e `schemaVersion: 3` |
| `isMultiRoll`, `rollCount` no resultado | `rolls.length`; no plano, `isMultiRoll` e `rollCount` |
| `rolls[].roll` snapshot | removido; use o próprio `rolls[]` e os arrays tipados |
| `pool.hasTarget` | `pool !== null` |
| `pool` sempre presente | `pool: PoolSummary | null` |
| arrays mutáveis | arrays e DTOs `readonly` |

`N#formula` continua executando entradas independentes e o `total` raiz continua sendo a soma. `dice`, `groups` e `events` existem apenas nos arrays raiz; cada `ResolvedRoll` aponta para intervalos contíguos por `diceRange`, `groupRange` e `eventRange`, além de possuir seu próprio `pool`.

### Snapshot e objetos internos

Remova qualquer leitura de:

```ts
result.rolls[0].roll.rolls;
result.rolls[0].roll;
```

O snapshot V2 carregava objetos do parser em `unknown[]`, não era um contrato serializável confiável e foi removido. Escolha a projeção V3 conforme a necessidade:

- `result.groups`: subexpressões resolvidas, notação, valor, span e relações pai/filho;
- `result.dice`: estado final e contribuição de cada dado;
- `result.events`: sequência causal para animação e auditoria;
- `result.rolls`: separação entre entradas de multi-roll;
- `result.output`: texto pronto apenas para exibição simples.

### Dados

| Campo V2 | Campo/estratégia V3 |
| --- | --- |
| `initialValue` | `rawValue` |
| `value` | `value` |
| `calculationValue` | `contribution` |
| `useInTotal` | `included` e `contribution` |
| `groupIndex`, `groupPath`, `groupRollIndex` | `groupId`, `sourceNodeId` e `rollIndex` |
| `modifiers`, `modifierFlags` | `states` e `events` |
| `wasDropped` | `!included` ou estado `dropped` |
| `wasExploded` | estado `exploded` e evento `explode` |
| `wasRerolled` | estados `rerolled`/`unique-rerolled` e evento `reroll` |
| `wasCriticalSuccess` | estado `critical-success` |
| `wasCriticalFailure` | estado `critical-failure` |
| `wasTargetSuccess` | estado `target-success` |
| `wasTargetFailure` | estado `target-failure` |
| `wasTargetNeutral` | estado `target-neutral` |

Não troque `calculationValue` apenas por `value`: targets, dados descartados e compound podem ter uma contribuição diferente do valor final. Para somatórios e regras, use `contribution`.

`parentDieId` é `null` nos dados iniciais e aponta para o dado causador nos filhos de explosões. `rollDieIndex` é local à entrada de multi-roll; `id` é o identificador do dado no resultado inteiro.

### Grupos

`ResolvedGroup` substitui a extração por regex e a navegação pelo snapshot:

```ts
interface ResolvedGroup {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly rollIndex: number;
  readonly kind: 'dice' | 'expression' | 'function' | 'group';
  readonly notation: string;
  readonly span: { readonly start: number; readonly end: number };
  readonly value: number;
  readonly childIds: readonly string[];
}
```

Use `sourceNodeId` para correlacionar a mesma subexpressão nas várias entradas de `N#formula`. Use `id` quando precisar de uma resolução específica. Não dependa da posição no array como identidade.

### Eventos

Eventos V2 eram inferidos do estado final. Na V3 o journal é escrito durante a execução e preserva a ordem real:

- `roll`: valor sorteado;
- `reroll`: transição `from` → `to`, com motivo;
- `explode`: relação entre `dieId` e `childDieId`;
- `include`: contribuição final de um dado incluído;
- `exclude`: remoção por keep/drop;
- `classify`: sucesso, falha ou neutro.

Migre `drop`, `critical-success` e `critical-failure` de tipos de evento V2 para `exclude` e `classify`/`states` conforme o caso. Use o discriminante `event.type` para estreitar a union:

```ts
for (const event of result.events) {
  switch (event.type) {
    case 'roll':
      animateFace(event.dieId, event.value);
      break;
    case 'reroll':
      animateFace(event.dieId, event.to);
      break;
    case 'explode':
      linkExplosion(event.dieId, event.childDieId);
      break;
    case 'include':
    case 'exclude':
    case 'classify':
      updatePresentation(event);
      break;
  }
}
```

### Pools

```ts
// V2
if (result.pool.hasTarget) {
  renderSuccesses(result.pool.netSuccesses);
}

// V3
if (result.pool !== null) {
  renderSuccesses(result.pool.netSuccesses);
}
```

Dados target excluídos não contam. Em multi-roll, o pool raiz soma `successes` e `failures` dos rolls e recalcula `netSuccesses`.

## Frontend: fluxo avançado e grupos

O fluxo avançado do ERPG não deve mais avaliar novamente trechos da fórmula com `mathjs`. A fonte de verdade passa a ser o mesmo plano executado pelo core.

```ts
// V2: remover
const parserGroups = result.rolls[0].roll.rolls;
const resolved = rebuildDynamicGroups(parserGroups);
const value = math.evaluate(groupExpression, scope);

// V3
const groupsBySource = new Map<string, ResolvedGroup[]>();

for (const group of result.groups) {
  const entries = groupsBySource.get(group.sourceNodeId) ?? [];
  entries.push(group);
  groupsBySource.set(group.sourceNodeId, entries);
}

const advancedGroups = result.groups.map((group) => ({
  id: group.id,
  sourceId: group.sourceNodeId,
  rollIndex: group.rollIndex,
  notation: group.notation,
  value: group.value,
  childIds: group.childIds,
}));
```

Quando aliases avançados apontarem para um trecho estático, associe-os aos `RollPlanGroup.sourceNodeId` na compilação e leia o `ResolvedGroup` correspondente depois da execução. Isso elimina regex de cardinalidade, `unknown[]` e divergência entre o valor mostrado e o total do core.

## Frontend: dice3dview

O adaptador 3D deve receber resultados resolvidos, sem decidir regra ou recalcular modificadores. Passe o journal inteiro para uma API que pré-compile as dependências; não chame o renderer uma vez por evento:

```ts
const supportedSides = new Set([2, 4, 6, 8, 10, 12, 20, 100]);
const visualDice = result.dice.filter(
  (die) => typeof die.sides === 'number' && supportedSides.has(die.sides),
);
const visualIds = new Set(visualDice.map((die) => die.id));

await dice3dview.displayTimeline({
  id: crypto.randomUUID(),
  dice: visualDice.map((die) => ({ id: die.id, sides: die.sides })),
  events: result.events.filter(
    (event) => event.subject === 'die' && visualIds.has(event.dieId),
  ),
});
```

O executor registra o `roll` de um filho explosivo antes do evento `explode`; por isso a timeline precisa indexar `childDieId`/`parentDieId` antes de animar. Depois da animação, estilize dados mantidos/descartados usando `included`, contabilize `contribution` e conecte explosões usando `parentDieId`. O contrato `DiceSides` é `number | 'F'`; o adaptador deve filtrar ou mapear tipos que o renderer não suporta.

## Seed e replay

Seeds de texto e número não colidem na V3. MT19937 permanece o padrão e `xoshiro128ss` é opt-in. O descriptor registra material fixo de 128 bits, algoritmo, versões, perfil matemático e fingerprint do plano, sem expor a seed textual:

```ts
const first = rollRpgDice('2d20kh1', { seed: 'combate-7' });
const replayed = rollRpgDice('2d20kh1', { replay: first.replay });

console.log(first.dice.map((die) => die.value));
console.log(replayed.dice.map((die) => die.value));
```

Isso também reproduz uma rolagem cuja seed foi criada automaticamente por crypto. Persista `ReplayDescriptor` e `ExecutionStats` com o feed. `seed` e `replay` são mutuamente exclusivos. Descriptor malformado produz `INVALID_REPLAY`; algoritmo/versão desconhecidos produzem `UNSUPPORTED_REPLAY_VERSION`; fórmula diferente produz `REPLAY_PLAN_MISMATCH`.

A compatibilidade está vinculada a `algorithmVersion`, `executionVersion`, `mathProfile` e `planFingerprint`, não apenas à versão npm. Não altere manualmente o descritor.

## Erros estruturados

```ts
try {
  return rollRpgDice(input, options);
} catch (error: unknown) {
  if (!isDiceRollError(error)) throw error;

  return {
    status: 400,
    error: error.toJSON(),
  };
}
```

Migre decisões baseadas em texto para `error.code`. O novo erro inclui `span`, `input` e `details` JSON-safe. Códigos de limite são mais específicos, por exemplo `TOO_MANY_INITIAL_DICE`, `GENERATED_DICE_LIMIT_EXCEEDED`, `RANDOM_BUDGET_EXCEEDED` e `EVENT_LIMIT_EXCEEDED`.

`UNSUPPORTED_NOTATION` indica sintaxe reconhecida que não pode ser executada naquela posição, como certos modificadores de execução em grupos. `NON_FINITE_RESULT` cobre operações matemáticas cujo resultado não é finito.

## Checklist de migração

- [ ] Node.js atualizado para 22+;
- [ ] imports limitados ao entrypoint;
- [ ] `maxDice` e `maxRolls` convertidos para `limits`;
- [ ] acesso a `roll.rolls` e ao snapshot removido;
- [ ] fluxo avançado consumindo `result.groups`, sem reavaliação por `mathjs`;
- [ ] adaptador 3D consumindo `events`, `included`, `contribution` e `parentDieId`;
- [ ] `pool.hasTarget` substituído por teste de `null`;
- [ ] erros tratados por `isDiceRollError` e `code`;
- [ ] replay persistindo fórmula e `ReplayDescriptor`;
- [ ] `ExecutionStats` persistido para auditoria;
- [ ] fluxos que usam apenas total/pool migrados para `rollRpgDiceSummary()`;
- [ ] rolls consumindo `diceRange`, `groupRange` e `eventRange` nos arrays raiz;
- [ ] consumidores testados com resultados multi-roll, targets, rerolls, explosões e dados excluídos.
