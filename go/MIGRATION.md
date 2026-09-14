# Migração nativa para Go

## Referência e escopo

O porte implementa a biblioteca de rolagem `@erpg/dicecore` **3.7.1**, tomando
como referência o código TypeScript do commit **1940044**. Está na branch
**Go-Version**; Git não aceita espaços no nome de uma branch.

A migração inclui linguagem de dados, compilação e inspeção sem rolar, execução
de modificadores, resultados completos/detalhados/resumidos, limites, caches,
sementes, replay e sistemas de RPG. O runtime é Go nativo, sem dependências
externas. A migração do servidor Fortuna HTTP e sua integração com o frontend
ficam fora deste módulo.

## Correspondência da API

| TypeScript | Go |
| --- | --- |
| `createDiceEngine` | `CreateDiceEngine` |
| `compileRpgDice` | `CompileRPGDice` |
| `inspectRpgDiceNotation` | `InspectRPGDiceNotation` |
| `normalizeRpgDiceNotation` | `NormalizeRPGDiceNotation` |
| `verifyRpgDiceNotation` | `VerifyRPGDiceNotation` |
| `rollRpgDice` | `RollRPGDice` |
| `rollRpgDiceDetails` | `RollRPGDiceDetails` |
| `rollRpgDiceSummary` | `RollRPGDiceSummary` |
| `createSystemRoller` | `CreateSystemRoller` |
| `rollAssimilation`, `evaluateAssimilationSelection` | `RollAssimilation`, `EvaluateAssimilationSelection` |
| `rollDaggerheart`, `rollFateDice`, `rollVampireV5` | `RollDaggerheart`, `RollFateDice`, `RollVampireV5` |
| `rollMixedDice` | `RollMixedDice` |
| `DiceRollError`, `isDiceRollError`, `isDiceRollErrorData` | `DiceRollError`, `IsDiceRollError`, `IsDiceRollErrorData` |
| `DiceRollError.fromJSON` | `DiceRollErrorFromJSON` |
| `DICE_LIMIT_PRESETS` | `DefaultDiceLimits`, `TrustedServerDiceLimits`, `UntrustedServerDiceLimits` |

A engine oferece `Compile`, `Inspect`, `Normalize`, `Verify`, `Roll`,
`RollDetails`, `RollSummary`, `Limits`, `GetCacheStats` e `ClearCache`.

## Contratos portados

| Área | Implementação e validação |
| --- | --- |
| Sintaxe | Scanner, AST, normalização, aliases, comentários, contagem de rolagens e spans UTF-16 |
| Compilador | Semântica, constantes, ordem dos modificadores, detecção de operações impossíveis, planos e fingerprints |
| Execução | Dados/grupos, explosão, reroll, unique, keep/drop, ordenação, sucesso/falha, estatísticas e eventos |
| Resultados | Projeções full/details/summary, IDs, estados, relações, texto, limites e materialização |
| Engine | Opções, limites por chamada, caches LRU limitados, planos externos validados e isolamento de dados |
| Aleatoriedade | MT19937 e Xoshiro128**, amostragem limitada, rejeições e contagem de draws |
| Replay | Descritores completos, seeds derivadas, schema/algoritmo/fingerprint e reprodução de resultados |
| Sistemas | Assimilação, seleção, Daggerheart, Fate, Vampiro V5 e rolagens mistas; full e compact |
| Unicode | Classificação Unicode 17 e NFD para aliases dos sistemas, geradas pela referência TypeScript |
| Matemática | Decimal12, kernels trigonométricos, exp/log e potenciação refinada nas fronteiras de inteiros |

Os oito casos trigonométricos que falhavam no primeiro estágio estão na suíte
obrigatória. Não há tolerância numérica para aceitar resultados diferentes:
os testes matemáticos comparam os bits IEEE 754 do resultado normalizado.

## Evidências e reprodução

A suíte Go passou com **4.585 de 4.585 statements cobertos (100%)**, com o perfil de todos os
pacotes. A cobertura mede a execução do código; as comparações com TypeScript
verificam seu comportamento de forma independente. Nenhum arquivo de produção é
removido da medição. Go não oferece nativamente as quatro métricas de cobertura
de TypeScript, cuja referência tem **548 testes e 100% de statements, branches,
funções e linhas**.

As referências versionadas verificam fundamentos, ASTs, planos, resultados e
erros completos, projeções, sistemas, cache e replay. A auditoria matemática
ampliada verificou **425.512 casos** sem diferenças; **12.680** permanecem na suíte
normal, além das referências matemáticas iniciais. Há testes de concorrência,
mutação de resultados/planos, limites e falhas, além do alvo de fuzzing do parser.
Consulte [testdata/README.md](testdata/README.md) para os geradores e comandos.

Os corpora históricos também são executados: 31 notações com duas sementes
(62 resultados) e cinco resultados JSON completos, incluindo rolagens mistas.
Compilador: 468 casos; executor: 238 casos em três projeções; sistemas: 1.014
casos; engine: 24 sequências com 91 operações e verificação de cache por chamada.

A validação local em Windows passou também com `go test -race ./... -count=1`,
usando Go 1.26.2 e GCC 16.2 (w64devkit 2.9.1 portátil, apenas para instrumentação).
O CI verifica formatação, vet, testes com detector de races, cobertura exata e
regeneração das referências. A geração do corpus matemático fica em Windows com
Node **24.18.0**, V8 **13.6.233.17-node.50**, pois `Math.pow` depende da biblioteca
matemática da plataforma. Os testes Go leem esse corpus congelado sem Node.

O [benchmark comparativo](BENCHMARK.md) apresenta Go, Node e Bun com metodologia,
dispersão, comandos e resultados brutos. A [segunda rodada de backend](BACKEND_ROUND2_BENCHMARK.md)
mede lotes de 10.000 chamadas, concorrência e memória residente; o
[teste com JSON](JSON_BENCHMARK.md) inclui a serialização. O
[registro da segunda rodada](OPTIMIZATION_ROUND2.md) documenta as mudanças,
variantes rejeitadas e evidências anteriores preservadas.

## Adaptações de linguagem

- Eventos completos são `[]ResolvedEvent`: `event.Value` substitui o acesso
  nativo anterior por mapa, e `event.Details` contém campos de modificadores e
  grupos quando aplicável. A estrutura Go mudou; as funções de rolagem e o
  contrato JSON mantêm os campos, valores, omissões e `null` da referência.
  Eventos guardam o ID do pai por valor, protegendo o histórico da mutação de
  `ResolvedDie.ParentDieID`. O journal público continua usando `DiceEvent`.
- Erros retornam como `(valor, error)`; nomes e tipos seguem as convenções Go.
  Opções omitidas usam o valor zero/nil apropriado. Contadores são inteiros
  nativos, sem a possibilidade de receber frações ou `NaN`.
- Resultados e planos públicos são valores do chamador. Cópias protegem estado
  interno e caches; `freezeResults` não torna structs Go imutáveis. Os getters
  de baixo nível `GetPlanProgram` e `GetPlanAST` emprestam o IR/AST internos para
  leitura; o chamador não pode modificar essas estruturas compartilhadas.
- Strings Go usam UTF-8; spans e hashing seguem unidades UTF-16. `UTF16Seed`
  preserva sementes JavaScript com surrogates isolados. Diagnósticos do scanner
  preservam a unidade isolada em JSON quando apontam para parte de um caractere
  astral. Entradas JavaScript malformadas impossíveis em parâmetros tipados Go
  não criam APIs artificiais para aceitar esses valores.
  Chaves de objetos JSON externos com surrogates isolados não são representáveis
  por `map[string]any` e são decodificadas com U+FFFD; os valores de string de
  erros preservam esses escapes ao fazer roundtrip JSON.
- Os entrypoints da engine verificam limites antes da compilação/execução.
  APIs de baixo nível de normalização e scanner espelham os internos TypeScript;
  um futuro adaptador HTTP deve aplicar também seus limites de request.

Equivalência 1:1 significa os contratos funcionais da versão de referência para
entradas representáveis nas duas linguagens. Os testes não constituem prova de
todos os números binários possíveis nem de todas as versões de V8/plataformas.
Mudanças no TypeScript devem passar novamente pelos geradores e testes.
