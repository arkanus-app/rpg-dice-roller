# @erpg/dicecore 3.0.0

Núcleo de dados do ERPG para compilar, inspecionar e resolver notações de dados. A V3 é escrita em TypeScript estrito, não mantém estado global de RNG e entrega resultados `readonly`, JSON-safe e próprios para frontend, backend, automações e visualização 3D.

> A versão `3.0.0` está implementada neste repositório, mas este documento não indica que a publicação no npm ou a criação da tag já tenham ocorrido.

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
  inspectRpgDiceNotation,
  isDiceRollError,
  isDiceRollErrorData,
  normalizeRpgDiceNotation,
  rollRpgDice,
  rollRpgDiceSummary,
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
- `N#formula` executa rolagens independentes;
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
