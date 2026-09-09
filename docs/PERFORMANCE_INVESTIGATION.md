# Investigação de desempenho — 2026-09-09

Este documento registra o diagnóstico anterior às alterações. A implementação e as medições finais estão em [Melhorias de desempenho aplicadas](PERFORMANCE_IMPROVEMENTS.md). O diagnóstico identificou oportunidades no caminho de strings em cache e na execução resumida com modificadores, além dos ganhos já disponíveis por configuração.

## Ambiente e método

- Revisão analisada: `ac3febe`, pacote `@erpg/dicecore` 3.7.1.
- Windows, Node 24.18.0, Intel Core i5-11400H @ 2.70 GHz.
- Build ESM minificado local, com TypeScript e lint aprovados.
- Benchmark existente: cinco amostras e comparações intercaladas próprias.
- Investigação complementar: sete amostras por caso, aquecimento de 20%, ordem dos casos alternada e GC explícito antes das amostras. Tempos incluem execução e alocação dos resultados, mas não serialização JSON.
- As duas suítes de benchmark foram executadas sequencialmente, sem testes/build concorrentes. São medições desta máquina, não uma promessa de desempenho em browsers ou servidores.
- A comparação absoluta com o baseline Linux/Node 22 não foi aplicada neste ambiente. Não houve profiling de CPU nem medição de alocação por função; os candidatos internos abaixo vêm da leitura do código e das diferenças entre cenários, não de percentuais atribuídos a funções.

## Resultados medidos

Medianas da investigação complementar; menor tempo é melhor.

| Cenário | Tempo por rolagem |
| --- | ---: |
| `1d20`, summary, MT19937, plano, seed fixa | 4,69 µs |
| `1d20`, summary, MT19937, string em cache, seed fixa | 6,44 µs |
| `1d20`, summary, MT19937, plano, seeds diferentes | 23,26 µs |
| `1d20`, summary, Xoshiro, plano, seeds diferentes | 4,28 µs |
| `1d20`, summary, MT19937, plano, seed automática | 27,63 µs |
| `1d20`, summary, Xoshiro, plano, seed automática | 7,62 µs |
| `1d20`, summary, MT19937, plano, replay | 6,97 µs |

Nesse cenário pequeno, o plano custa aproximadamente 27% menos tempo que a string em cache. Xoshiro custa aproximadamente 5,4 vezes menos tempo com seeds diferentes e 3,6 vezes menos com seed automática. São alternativas já existentes; trocar o algoritmo muda a sequência para uma mesma seed. Descritores de replay continuam determinando explicitamente seu algoritmo.

| Fórmula / 10 mil dados, MT19937 e seed fixa | Completo | Details | Summary |
| --- | ---: | ---: | ---: |
| `10000d20` | 6,42 ms | 2,89 ms | 0,82 ms |
| `10000d20kh1` | 10,66 ms | 6,36 ms | 5,75 ms |
| `10000d20kh5000` | 9,75 ms | 6,12 ms | 5,72 ms |
| `10000d20>=10` | 8,94 ms | 3,76 ms | 3,31 ms |

O resumo simples levou cerca de 7,9 vezes menos tempo que o completo. Com `kh1`, a diferença caiu para 1,9 vez. A diferença entre fórmulas também inclui o trabalho semântico dos modificadores; não representa uma estimativa de ganho garantido de uma futura implementação.

O script verificou igualdade de total, stats, pool e replay entre os três modos para cada fórmula grande. Isso valida esses cenários e essa seed, sem substituir os testes de compatibilidade.

## Prioridades propostas

### 1. Evitar resolução repetida de limites no caminho de string

Em `src/v3/engine.ts`, `roll`/`rollSummary` resolvem os limites e `resolvePlan` chama `compile(input, { limits })`. `compile` resolve novamente os limites, cria/congela um objeto e monta a chave textual antes do hit no cache. O plano pertencente ao mesmo engine evita esse percurso.

Proposta: extrair um método interno de compilação que receba limites já resolvidos e pré-calcular a parte da chave correspondente aos limites padrão. Manter toda a validação na entrada pública e para overrides externos. É uma primeira mudança pequena e mensurável. Os 27% observados com planos incluem outros custos evitados, portanto não devem ser prometidos como ganho da mudança isolada.

### 2. Ampliar o resumo rápido para modificadores comuns

Em `src/v3/executor.ts:1112`, `supportsFastSummary` rejeita qualquer modificador. A execução resumida então cria `WorkingDie`, IDs, estados e estruturas de grupo. Os objetos de entrada dos eventos também são construídos antes de `ExecutionJournal.record` decidir não materializá-los.

Proposta: começar com target (`>=10`), min/max e casos simples de keep/drop, usando valores numéricos e contadores em vez de objetos completos. Preservar ordem dos modificadores, consumo do RNG, arredondamentos, stats e erros de limite. Ganho potencial relevante em pools grandes, mas precisa de protótipo e comparação diferencial. A elegibilidade do caminho rápido também pode ser calculada uma vez por programa compilado.

### 3. Reduzir validações repetidas de replay

O percurso público passa por `replayForPlan`, pela validação no construtor de `ExecutionContext` e novamente por `createReplaySeed`: três validações do descritor. Cada validação verifica chaves com `Object.keys().sort().join()`.

Proposta: validar e copiar o descritor externo uma vez, passando uma representação interna confiável aos demais passos. Não confiar por identidade em objetos externos mutáveis; manter o comportamento dos acessos hostis e a vinculação ao fingerprint. O replay medido custa 6,97 µs contra 4,69 µs com seed fixa, mas os percursos também diferem na reconstrução do material da seed; não atribuir toda a diferença às validações.

### 4. Especializar seleção quando poucos dados são mantidos

`indexesToExclude`, em `src/v3/executor.ts:440`, ordena todos os valores e cria arrays/Set mesmo para `kh1`. Considerar uma seleção linear para um extremo ou seleção parcial para k pequeno, principalmente dentro do resumo rápido.

Preservar desempate por índice e ordem dos eventos é obrigatório. No modo completo, ordenar os excluídos para manter eventos pode reduzir o benefício; o resumo é o melhor primeiro alvo. O tempo de `kh1` próximo ao de `kh5000` motiva a investigação, sem provar sozinho que a ordenação domina o custo.

## Tamanho do pacote: falha atual

O benchmark existente terminou com exit code 1 por dois limites de gzip. Os demais gates passaram.

| Grafo ESM | Medido | Limite | Excesso |
| --- | ---: | ---: | ---: |
| Entrada principal | 29.908 bytes | 28.672 bytes | 4,3% |
| Core | 22.996 bytes | 21.504 bytes | 6,9% |

A métrica concatena o grafo de imports estáticos e aplica gzip; não equivale exatamente ao download real nem ao resultado de tree-shaking de uma aplicação. Investigar composição dos chunks e dependências antes de elevar os limites.

O JSON de `10000d20` completo teve 5.377.277 bytes, contra 610 bytes no summary. Essa diferença é de payload serializado, não uma medição de pico de memória. O `heapDeltaBytes` da suíte atual também não mede pico nem alocação total, pois o GC pode ocorrer durante a amostra.

## Reprodução e verificações

```powershell
npm run build
New-Item -ItemType Directory -Force .artifacts/performance | Out-Null
node --expose-gc --import tsx scripts/benchmark.ts --json > .artifacts/performance/baseline.json
node --expose-gc --import tsx scripts/investigate-performance.ts > .artifacts/performance/investigation.json
npx vitest run --config vitest.v3.config.ts
npx eslint scripts/investigate-performance.ts --max-warnings=0
```

Os arquivos JSON locais contêm as medições brutas; o script complementar preserva as sete durações individuais por cenário. O benchmark principal produz JSON mesmo ao falhar nos gates de tamanho. `.artifacts` é ignorado pelo Git.

Verificações na investigação original: build completo aprovado; lint do script aprovado; 27 arquivos / 376 testes V3 aprovados. Naquela etapa ainda não haviam sido aplicadas otimizações nem executados os testes de browser ou toda a suíte legada. Consulte o relatório de implementação para a validação posterior.
