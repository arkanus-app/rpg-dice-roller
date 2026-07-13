# Changelog

As mudanças relevantes do `@erpg/dicecore` são registradas neste arquivo.

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
