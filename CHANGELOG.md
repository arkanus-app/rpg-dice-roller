# Changelog

## Nao publicado

### Adicionado

- `rollDaggerheart()` para a rolagem de acao com os dois d12 de Duality Dice,
  incluindo modificador, Dificuldade opcional, replay e resultado de
  Esperanca/Medo ou sucesso critico.
- Notacao mista `daggerheart()`, `dagger()` e `dh()`, com argumentos
  posicionais ou nomeados (`modifier`, `difficulty`, `mod`, `dc`).
- Perfis semanticos `daggerheart-hope-d12` e `daggerheart-fear-d12` para a
  apresentacao 2D/3D sem recalcular a rolagem.

As mudanças relevantes do `@erpg/dicecore` são registradas neste arquivo.

## 3.4.0 — 2026-07-31

### Adicionado

- `rollMixedDice()` e a notação de lote `;` para combinar fórmulas genéricas,
  Vampiro V5, Fate e Assimilação em uma única chamada.
- Formas posicionais e nomeadas como `v5(7,3,4)`, `fate(4)` e
  `assim(d6=2,d10=1,d12=1,keep=1)`.
- `MixedRollResult` com resultados discriminados, dados achatados com IDs
  únicos e `physicalValue` próprio para apresentação 2D/3D.
- replay versionado do lote com streams independentes por sub-rolagem.

### Segurança e compatibilidade

- `rollRpgDice()` e toda a gramática genérica permanecem inalterados;
- limites de rolls, dados, RNG, eventos, resultados e output são aplicados ao
  lote agregado, impedindo contornar os tetos com múltiplos segmentos.
- o lote não fabrica um total entre sistemas semanticamente incompatíveis.

## 3.3.0 — 2026-07-31

### Adicionado

- `rollFateDice` com quatro dados por padrão, perfil `fate-df`, total semântico
  e faces físicas d6 preservadas de forma determinística no replay.
- Tipos `FateRollResult` e `FateDieResult`, incluindo `fateValue: -1 | 0 | 1`
  para separar pontuação Fate da face física 1–6.

## 3.2.0 — 2026-07-31

### Adicionado

- `rollVampireV5` com pools normais/de Fome, sucessos, pares de críticos,
  dificuldade, crítico bagunçado e falha bestial sobre o replay V3.
- `rollAssimilation` para pools mistos de d6, d10 e d12 com os mapas oficiais
  de símbolos, sem seleção automática.
- `evaluateAssimilationSelection` para selecionar IDs únicos até `keep`,
  preservar a ordem escolhida e agregar sucesso, adaptação e pressão.
- `SystemDieResult` e perfis semânticos estáveis para integração com
  renderizadores 3D sem embutir assets no core.
- Código estruturado `INVALID_SYSTEM_INPUT` para entradas e seleções de
  sistema inválidas.

## 3.1.0 — 2026-07-19

### Adicionado

- O contador de `N#formula` passa a aceitar expressões matemáticas determinísticas, com agrupamento por `()`, `{}` ou `[]`.

### Corrigido

- A verificação do pacote reconhece `rollup.config.mjs` como configuração autorizada sem liberar outros arquivos JavaScript fora do build.

## 3.0.0 — não publicado

A versão está implementada no repositório, mas esta entrada não declara publicação no npm nem criação de tag.

### Adicionado

- `createDiceEngine`, `compileRpgDice`, `inspectRpgDiceNotation`, `rollRpgDice`, `verifyRpgDiceNotation` e `normalizeRpgDiceNotation` como fachada pública V3.
- `RollPlan` imutável, reutilizável no engine de origem e restaurável de JSON com validação no destino.
- Scanner e parser próprios em TypeScript, com AST discriminada, IDs determinísticos e `SourceSpan`.
- Executor isolado por rolagem, sem singleton global de RNG.
- MT19937 implementado no pacote e seed automática de 128 bits via `crypto.getRandomValues`.
- `ReplayDescriptor` versionado; `roll(..., { replay })` restaura streams originados por seed fornecida ou crypto.
- Limites separados para entrada, AST, rolls, dados iniciais, dados gerados, chamadas aleatórias e eventos.
- Journal causal com eventos `roll`, `reroll`, `explode`, `include`, `exclude` e `classify`.
- DTO V3 `readonly` e JSON-safe com `rolls`, `groups`, `dice`, `events`, `pool` e `replay`.
- Erros estruturados `DiceRollError`, union de códigos, `SourceSpan`, `details`, `toJSON()` e type guard.
- API de inspeção sem rolagem, com custo estático e pior caso.
- Resultados congeláveis por `freezeResults: 'development' | 'always' | 'never'`.
- Builds ESM e CommonJS, declarações TypeScript e suporte mínimo a Node.js 22.

### Alterado

- O entrypoint passa a exportar somente a API V3; a implementação V2 permanece apenas como corpus de compatibilidade no desenvolvimento.
- Todo código autoral ativo, testes e scripts de build foram migrados para TypeScript.
- Jest/Babel foram substituídos por Vitest e configuração ESLint flat type-aware.
- Os limites `maxDice`/`maxRolls` da V2 foram substituídos por `options.limits`.
- `pool` agora é `null` quando não existe target.
- `N#formula` continua somando os totais das rolagens independentes, agora com projeções tipadas por roll.
- O build gera apenas `dist/`; bundles e declarações gerados não são versionados.
- O tarball publicado é preparado para conter `dist`, README, licença e metadados, sem dependências de runtime.

### Removido

- `parseRpgDiceInput`, `extractRpgDiceGroups` e `countRpgDiceInNotation` da API pública.
- Snapshot legado `rolls[].roll` e seus arrays `unknown[]`.
- Classes internas, objetos do parser e coleções mutáveis no contrato público.
- Peggy, parser JavaScript gerado, Babel e Jest da toolchain V3.
- Estado global de RNG e fallback para `Math.random` no runtime V3.
- Bundles UMD/browser globals e imports profundos como contrato suportado.

### Incompatibilidades

- Requer Node.js 22 ou superior.
- `RpgDiceRollResult` foi substituído por `DiceRollResult` com `type: 'dice-roll'` e `schemaVersion: 3`.
- `RpgDiceRollError` foi substituído por `DiceRollError`.
- Detalhes legados de dados (`initialValue`, `calculationValue`, `useInTotal` e booleans `was*`) passam a `rawValue`, `contribution`, `included`, `states` e eventos.
- `pool.hasTarget` foi removido; a presença de target é representada por `pool !== null`.
- Planos clonados ou desserializados são validados e recompilados pelo engine de destino antes da execução.

Consulte [docs/MIGRATION_V3.md](docs/MIGRATION_V3.md) para o roteiro de atualização e [docs/API_V3.md](docs/API_V3.md) para o contrato completo.
