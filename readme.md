# @erpg/dicecore 3.4.0

Núcleo de dados do ERPG para compilar, inspecionar e resolver notações de dados. A V3 é escrita em TypeScript estrito, não mantém estado global de RNG e entrega resultados `readonly`, JSON-safe e próprios para frontend, backend, automações e visualização 3D.

> A versão `3.4.0` está implementada neste repositório, mas este documento não indica que a publicação no npm ou a criação da tag já tenham ocorrido.

## Requisitos e formatos

- Node.js 22 ou mais recente;
- browsers com ES2022 e `globalThis.crypto.getRandomValues`;
- ESM, CommonJS e declarações TypeScript;
- zero dependências de runtime no pacote publicado.

```bash
npm install @erpg/dicecore
```

```ts
import { rollRpgDice } from '@erpg/dicecore';

const result = rollRpgDice('2d6+3', { seed: 'encontro-42' });
console.log(result.total, result.replay);
```

```js
const { rollRpgDice } = require('@erpg/dicecore');

const result = rollRpgDice('1d20+5', { seed: 'ataque-1' });
```

Imports profundos, global UMD e as classes internas da V2 não fazem parte da API pública.

## API pública

```ts
import {
  compileRpgDice,
  createDiceEngine,
  evaluateAssimilationSelection,
  inspectRpgDiceNotation,
  isDiceRollError,
  isDiceRollErrorData,
  normalizeRpgDiceNotation,
  rollAssimilation,
  rollDaggerheart,
  rollFateDice,
  rollMixedDice,
  rollRpgDice,
  rollRpgDiceSummary,
  rollVampireV5,
  verifyRpgDiceNotation,
} from '@erpg/dicecore';

const plan = compileRpgDice('2#4d6kh3 [atributos]');
const result = rollRpgDice(plan, { seed: 'personagem-42' });

const inspection = inspectRpgDiceNotation('5d10>=8f=1');
if (inspection.isValid && inspection.plan) {
  console.log(inspection.cost, rollRpgDice(inspection.plan).pool);
}

console.log(verifyRpgDiceNotation('d20+5')); // true
console.log(normalizeRpgDiceNotation('d + 2f')); // d20+2dF

try {
  rollRpgDice('10001d6');
} catch (error: unknown) {
  if (isDiceRollError(error)) {
    console.error(error.code, error.span, error.details);
  }
}
```

As funções públicas são:

- `compileRpgDice(input, options?)`: normaliza, valida e compila uma vez para um `RollPlan` imutável;
- `createDiceEngine(options?)`: cria limites, cache de planos e política de congelamento isolados;
- `inspectRpgDiceNotation(input, options?)`: valida sem rolar e retorna plano, grupos e estimativa de custo;
- `rollRpgDice(inputOrPlan, options?)`: resolve a fórmula e sempre inclui um descritor de replay;
- `rollRpgDiceSummary(inputOrPlan, options?)`: resolve total, rolls, pool, replay e stats sem materializar dados, grupos, eventos ou output;
- `rollVampireV5(input, options?)`: rola e avalia um pool de Vampiro V5 com dados normais e de Fome;
- `rollAssimilation(input, options?)`: rola os dados especiais de Assimilação sem escolher faces automaticamente;
- `evaluateAssimilationSelection(roll, selectedIds)`: seleciona até `keep` IDs únicos e agrega seus símbolos;
- `rollFateDice(input?, options?)`: rola quatro dados Fate por padrão, preserva as faces físicas e soma `-1`, `0` e `+1`;
- `rollDaggerheart(input?, options?)`: rola os dois d12 de Duality Dice, aplica modificador e resolve Esperança/Medo, sucesso, falha ou crítico;
- `rollMixedDice(notation, options?)`: executa fórmulas genéricas e sistemas diferentes em um único lote 2D/3D;
- `verifyRpgDiceNotation(input, options?)`: atalho booleano de validação;
- `normalizeRpgDiceNotation(input)`: aplica os atalhos de escrita do ERPG;
- `isDiceRollError(error)`: type guard para os erros estruturados da V3.
- `isDiceRollErrorData(value)`: valida erros transportados por JSON; restaure-os com `DiceRollError.fromJSON()`.

Um engine é indicado quando a aplicação precisa definir tetos próprios ou reutilizar planos com frequência:

```ts
const dice = createDiceEngine({
  limits: {
    maxRolls: 20,
    maxInitialDice: 500,
    maxGeneratedDice: 1_000,
  },
  cache: {
    maxInputEntries: 300,
    maxProgramEntries: 100,
    maxProgramNodes: 50_000,
  },
  randomAlgorithm: 'mt19937',
  freezeResults: 'development',
});

const plan = dice.compile('3#2d20kh1+5');
const result = dice.roll(plan, {
  seed: 'combate-17',
  limits: { maxRolls: 3 },
});
```

Limites informados em uma chamada podem apenas reduzir os tetos do engine. O plano original reutiliza a representação compilada; cópias via JSON ou spread são validadas e recompiladas pelo engine de destino antes da execução.

## Notação mista para 2D e 3D

Use `;` para separar rolagens independentes que devem acontecer e aparecer
juntas. O `+` continua sendo aritmética dentro de uma fórmula:

```ts
const mixed = rollMixedDice(
  '2d20+5; '
    + 'v5(pool=7,hunger=3,difficulty=4); '
    + 'fate(4); '
    + 'assim(d6=2,d10=1,d12=1,keep=1); '
    + 'daggerheart(modifier=2,difficulty=15)',
  { seed: 'sessao-42' },
);

console.log(mixed.rolls);  // resultados completos de cada sistema
console.log(mixed.dice);   // lista plana para UI 2D/3D
console.log(mixed.output); // resumo legível do lote
```

Chamadas aceitas:

| Sistema | Posicional | Nomeada |
| --- | --- | --- |
| Vampiro V5 | `v5(7,3,4)` | `v5(pool=7,hunger=3,difficulty=4)` |
| Fate | `fate(4)` ou `fate()` | `fate(dice=4)` |
| Assimilação | `AS(2,1,1,1)` ou `assim(2,1,1,1)` | `AS(d6=2,d10=1,d12=1,keep=1)` |
| Daggerheart | `dh()` ou `dagger(2,15)` | `daggerheart(modifier=2,difficulty=15)` |

Também são reconhecidos `AS`, `vampiro`, `vampire`, `fatedice`, `assimilacao` e
`assimilation`. Cada trecho genérico aceita a notação V3 completa, inclusive
modificadores, pools, funções e multi-roll.

O lote não possui um `total` geral: sucessos de Vampiro, valor Fate, símbolos
de Assimilação e totais numéricos não são grandezas equivalentes. Cada valor
permanece em `mixed.rolls`; `mixed.dice` contém IDs únicos, `physicalValue` e
os perfis necessários para desenhar todos os dados juntos. O replay do lote
restaura todos os sub-resultados:

```ts
const replayed = rollMixedDice(mixed.input, { replay: mixed.replay });
```

## Sistemas com faces simbólicas

As APIs de sistema usam o mesmo RNG, limites e replay da V3, mas projetam cada
`ResolvedDie` num `SystemDieResult`. O core entrega apenas IDs semânticos; SVGs,
texturas e materiais continuam sob responsabilidade do visualizador 3D.

```ts
const fate = rollFateDice(undefined, { seed: 'fate-42' });

console.log(fate.total);
console.log(fate.dice.map(({ rawValue, faceKey, fateValue }) => ({
  rawValue,
  faceKey,
  fateValue,
})));
```

Fate usa o perfil `fate-df`. O core rola d6 físicos para manter `rawValue` e
`value` entre 1 e 6: faces 1–2 são `minus`, 3–4 são `blank` e 5–6 são `plus`.
`fateValue` contém `-1`, `0` ou `1`; `total` soma esses valores. A rolagem
genérica `dF` continua disponível, mas sua face física já é convertida para
`-1`, `0` ou `1`, por isso a API semântica usa `d6` no `baseRoll`.

```ts
const vampire = rollVampireV5(
  { pool: 7, hunger: 3, difficulty: 4 },
  { seed: 'sessao-12' },
);

console.log(vampire.successes, vampire.outcome);
console.log(vampire.dice.map(({ id, sourceDieId, profileId, faceKey }) => ({
  id,
  sourceDieId,
  profileId,
  faceKey,
})));
```

Vampiro V5 usa os perfis `vampire-v5-normal-d10` e
`vampire-v5-hunger-d10`. Dados 6–9 valem um sucesso; cada 10 também vale um,
e cada par de 10 acrescenta dois sucessos. Sem `difficulty`, o desfecho é
`pending`. Com dificuldade, o resultado distingue sucesso, sucesso crítico,
crítico bagunçado, falha e falha bestial.

```ts
const assimilation = rollAssimilation(
  { d6: 2, d10: 1, d12: 1, keep: 2 },
  { seed: 'teste-isolado' },
);

// A rolagem nunca escolhe dados automaticamente.
const chosen = evaluateAssimilationSelection(
  assimilation,
  [assimilation.dice[3].id, assimilation.dice[1].id],
);

console.log(chosen.success, chosen.adaptation, chosen.pressure);
```

Assimilação usa `assimilation-d6`, `assimilation-d10` e `assimilation-d12`.
Cada dado semântico inclui `id`, `sourceDieId`, `sides`, `value`, `rawValue`,
`profileId`, `dieKind`, `faceKey` e `symbols`. `sourceDieId` referencia
diretamente um item de `baseRoll.dice`; `id` é a chave estável que deve ser
usada na seleção e no visualizador.

O `@erpg/dice3dview` reconhece os perfis de Vampiro V5 e Assimilação a partir
da versão 2.3.0 e o perfil Fate a partir da 2.4.0, sem depender do core em
runtime:

```ts
import { createSystemDisplayRequest } from '@erpg/dice3dview';

await viewer.display(createSystemDisplayRequest({
  id: 'resultado-42',
  dice: assimilation.dice,
  keptIds: chosen.selectedIds,
}));
```

Lotes mistos usam `@erpg/dice3dview` 2.5.0 ou posterior:

```ts
import { createMixedDisplayRequest } from '@erpg/dice3dview';

await viewer.display(createMixedDisplayRequest({
  id: 'misto-42',
  seed: 'misto-42',
  dice: mixed.dice,
}));
```

### Daggerheart

```ts
const daggerheart = rollDaggerheart(
  { modifier: 2, difficulty: 15 },
  { seed: 'duality-42' },
);

console.log(daggerheart.hopeDie.rawValue, daggerheart.fearDie.rawValue);
console.log(daggerheart.total, daggerheart.outcome);
```

`rollDaggerheart()` sempre produz um d12 de Esperança com perfil
`daggerheart-hope-d12` e um d12 de Medo com perfil `daggerheart-fear-d12`.
O total é a soma das duas faces e do modificador. Se os valores forem iguais,
o resultado é `critical-success`; caso contrário, a face maior define se a
ação foi feita com Esperança ou Medo. Sem `difficulty`, o resultado fica
pendente para Dificuldades secretas.

### Apresentação 3D de Daggerheart

O `@erpg/dice3dview` com estes perfis reconhece os dois resultados como d12
`default-v2`. A aplicação pode passar `themeColor` por dado para usar a cor da
skin em Esperança e a inversa RGB em Medo, sem alterar os valores autoritativos.

## Limites de segurança

As opções usam `limits`, tanto no engine quanto por chamada:

```ts
const result = rollRpgDice('3#2d6!', {
  seed: 'teste-de-carga',
  limits: {
    maxInputLength: 4_096,
    maxAstDepth: 64,
    maxAstNodes: 10_000,
    maxRolls: 3,
    maxInitialDice: 100,
    maxGeneratedDice: 500,
    maxRandomCalls: 2_000,
    maxEvents: 2_000,
    maxSides: 4_294_967_296,
    maxSeedLength: 1_024,
    maxModifierSteps: 10_000,
    maxResolvedGroups: 10_000,
    maxResultItems: 25_000,
    maxOutputLength: 100_000,
  },
});
```

Os padrões completos estão em `DEFAULT_DICE_LIMITS`. A inspeção calcula custo estático e pior caso; parser e executor também aplicam orçamentos duros durante a construção e a execução.

## Resultado V3

```ts
interface DiceRollResult {
  readonly type: 'dice-roll';
  readonly schemaVersion: 3;
  readonly input: string;
  readonly notation: string;
  readonly normalizedNotation: string;
  readonly comment: string;
  readonly total: number;
  readonly output: string;
  readonly replay: ReplayDescriptor;
  readonly stats: ExecutionStats;
  readonly rolls: readonly ResolvedRoll[];
  readonly groups: readonly ResolvedGroup[];
  readonly dice: readonly ResolvedDie[];
  readonly events: readonly DiceEvent[];
  readonly pool: PoolSummary | null;
}
```

- `rolls` separa cada execução de `N#formula` por ranges contíguos (`diceRange`, `groupRange`, `eventRange`); o `total` raiz é a soma de seus totais;
- `groups` resolve dados, expressões, funções e grupos com IDs e `SourceSpan` estáveis;
- `dice` separa face inicial (`rawValue`), valor final (`value`), contribuição e inclusão;
- `events` registra rolls, rerolls, explosões, transformações, inclusão, exclusão e classificação de dados e grupos na ordem do executor. Consumidores visuais devem reconstruir dependências por ID: o `roll` de um filho explosivo é registrado antes do evento `explode` que o liga ao pai;
- `pool` é `null` sem target e agrega sucessos/falhas quando a notação usa um target.

Veja o contrato completo em [docs/API_V3.md](docs/API_V3.md) e a atualização de consumidores em [docs/MIGRATION_V3.md](docs/MIGRATION_V3.md).

## Seed e replay

Toda rolagem retorna:

```ts
interface ReplayDescriptor {
  readonly schemaVersion: 2;
  readonly algorithm: 'mt19937' | 'xoshiro128ss';
  readonly algorithmVersion: 1;
  readonly executionVersion: 1;
  readonly mathProfile: 'decimal12-v1';
  readonly origin: 'provided-number' | 'provided-string' | 'crypto';
  readonly seedMaterial: string;    // 32 hex, sem a seed textual
  readonly planFingerprint: string; // 32 hex
}
```

Com `seed: string | number`, a mesma fórmula, seed de entrada e versão do core produzem a mesma sequência. Sem seed, o core gera 128 bits com `crypto.getRandomValues`; não há fallback para `Math.random`. O descritor retornado pode reproduzir exatamente qualquer uma das duas origens:

```ts
const first = rollRpgDice('2d20kh1');
const repeated = rollRpgDice('2d20kh1', { replay: first.replay });
```

`seed` e `replay` são mutuamente exclusivos. O replay já é vinculado ao fingerprint da fórmula; outra fórmula falha com `REPLAY_PLAN_MISMATCH`. MT19937 permanece o padrão e `xoshiro128ss` é opt-in.

## Notação ERPG

A normalização preserva atalhos comuns:

- `d` → `d20`, `2d` → `2d20`;
- `f` → `4dF`, `2f` → `2dF`, `df` → `dF`;
- `ei6` → `!>=6`;
- `km` → `kl`, e `k`, `kh` ou `kl` sem quantidade recebem `1`;
- combinações simples como `+-`, `-+`, `++` e `--` são limpas;
- `N#formula` executa rolagens independentes; `N` também pode ser uma expressão matemática determinística, como `(3-1)#1d20` (com `()`, `{}` ou `[]` para agrupamento);
- comentários podem usar `[texto]`, `//`, `#` ou `/* ... */` conforme o contexto.

A sintaxe inclui dados padrão, percentuais e Fudge; aritmética e funções; grupos; keep/drop; reroll/unique; explode/compound/penetrate; min/max; critical; sort; e targets de sucesso/falha.

```ts
rollRpgDice('4d6kh3');
rollRpgDice('1d%+2dF');
rollRpgDice('5d10>=8f=1');
rollRpgDice('{1d8,1d10}kh1');
rollRpgDice('ceil(1d6/2)+pow(2,3)');
```

## Integração com dice3dview

O `dicecore` decide o resultado; o `dice3dview` apenas o apresenta. A API de timeline recebe definições visuais e o journal resolvido sem interpretar a notação novamente:

```ts
const result = rollRpgDice('2d6!kh2', { seed: 'cena-9' });
const supportedSides = new Set([2, 4, 6, 8, 10, 12, 20, 100]);
const visualDice = result.dice.filter(
  (die) => typeof die.sides === 'number' && supportedSides.has(die.sides),
);
const visualIds = new Set(visualDice.map((die) => die.id));

await dice3dview.displayTimeline({
  id: 'cena-9',
  seed: 'cena-9',
  dice: visualDice.map((die) => ({ id: die.id, sides: die.sides })),
  events: result.events.filter(
    (event) => event.subject === 'die' && visualIds.has(event.dieId),
  ),
});

const scoring = result.dice.map((die) => ({
  id: die.id,
  parentDieId: die.parentDieId,
  value: die.value,
  included: die.included,
  contribution: die.contribution,
}));
```

O viewer pré-compila o journal inteiro porque o `roll` de um filho aparece antes do `explode` correspondente. Dados excluídos ainda podem ser animados, mas `included` e `contribution` governam a pontuação. `parentDieId` liga uma explosão ao dado que a originou. `transform` representa valor semântico: compound pode ultrapassar o número de faces e penetrate pode chegar a zero, portanto esses valores nunca devem ser usados como face física.

## Desenvolvimento da V3

O parser e o MT19937 da V3 são implementações TypeScript do próprio pacote. Vitest, o perfil TypeScript estrito e as verificações do tarball fazem parte da toolchain. `dist/` é sempre gerado e não é versionado.

O núcleo V2 não é exportado pelo pacote V3. Ele permanece no repositório apenas como corpus de compatibilidade durante o desenvolvimento e pode ser removido quando a migração for encerrada.

## Atribuição e licença

Este pacote é um derivado mantido pelo ERPG a partir do projeto open source `@dice-roller/rpg-dice-roller`, de GreenImp. A V3 substitui o parser e o runtime publicados por implementações próprias em TypeScript, mantendo o crédito e o aviso original em `licence.txt`.

Licença MIT.
