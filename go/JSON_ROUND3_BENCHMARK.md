# Rodada 3: resultado completo + JSON

Comparação local da API full seguida por JSON.stringify em Node/Bun e encoding/json.Marshal em Go. Go atual teve a maior mediana de vazão em **0/3 cargas com GC padrão** e **1/3 com GC configurado**, comparado aos dois runtimes JavaScript. Essas contagens descrevem esta amostra; não são um teste de significância ou uma garantia de capacidade HTTP.

## Ambiente e origem

AMD Ryzen 5 5500 · Windows 11 Pro · 12 CPUs lógicas. Node v24.18.0, Bun 1.4.0, go version go1.26.2 windows/amd64. Baseline declarado: commit `ca34ff9c251c8e8075a723d3fd6c2618bd60bc5c` (`ca34ff9`), executável preservado antes das alterações. Atual: árvore sobre `ca34ff9c251c8e8075a723d3fd6c2618bd60bc5c`, 13 entradas modificadas; o manifesto registra os bytes efetivamente compilados e executados.

O executável baseline é fornecido pelo chamador; o script registra seu SHA-256 e build info, mas não recompila nem prova por si só sua origem. Os arquivos dos workers Go e JavaScript foram comparados ao commit baseline e permaneceram iguais (desconsiderando apenas CRLF/LF). O dist TypeScript existente é usado sem rebuild e possui hashes próprios no manifesto. Baseline SHA-256: `e6fe7c1f75bc271d1ee6056792f5d81a08e4e8de696259d97800893f334c45ac`. Atual SHA-256: `ac158c77c539bdec46f5776738532bf77804cfdaf12a52480ee1ef0d99af7df5`. Fontes estáveis: `dc6415b0ab8d643d5ffb27ee7d3e1482bc280f8a8b22e6b69e7bef4521bd329a`.

## Método

Três cargas full, seis workers de aplicação e uma engine por worker. MT19937, limites padrão, freezeResults='never', cache aquecido, seeds únicas no lote (prefixo `dicecore-backend/v3.7.1/` + índice), repetidas entre configurações para permitir a comparação exata. Todos os processos Go usam GOMAXPROCS=12. Controles: GOGC=100 e GOMEMLIMIT removido do ambiente. Configurados: GOGC=500 e GOMEMLIMIT=96MiB, parâmetros reutilizados da rodada 2, sem nova seleção. GOMEMLIMIT é um limite flexível da memória gerenciada pelo runtime, não um teto rígido de RSS. A biblioteca não altera o GC global.

Cada processo aquece 1000 chamadas por worker por carga e mede 3 lotes de 5000 chamadas. São duas rodadas com novos processos e ordem invertida, totalizando seis lotes por configuração/carga. Primeira ordem: node → bun → go-baseline-default → go-final-default → go-baseline-tuned → go-final-tuned. Segunda ordem: go-final-tuned → go-baseline-tuned → go-final-default → go-baseline-default → bun → node. As cargas seguem a mesma ordem em cada processo: 1d20+5 → 100d6 → 20d6!2ro=1kh10. Não há processos de medição simultâneos dentro deste script. Compilação única, imports, startup, criação de options e aquecimento ficam fora do cronômetro dos lotes.

O tempo de lote inclui despacho, rolagem, construção do resultado, serialização e espera pelos seis workers. Não inclui HTTP, rede ou conversão adicional da string JavaScript para Buffer UTF-8. Preflight: igualdade integral do JSON decodificado nas seeds de índices 0, 1, 5, 127, 511, 4999 em todas as seis configurações, sem tolerância numérica. Todos os lotes devem concordar em contagem, totais, totais ponderados e chamadas aleatórias; o comprimento codificado é validado entre lotes da mesma configuração. O corpus é ASCII, confirmado no preflight; len(bytes) e string.length medem os comprimentos correspondentes nesse corpus. Ordem das chaves e diferenças textuais de codificação não são forçadas a coincidir.

## Vazão e dispersão

Cada célula: **operações/s / mediana do lote em ms [Q1–Q3]**. Quartis calculados sobre seis lotes; não são p95 nem percentis da latência de chamadas individuais.

| Carga | Node | Bun | Go anterior padrão | Go atual padrão | Go anterior configurado | Go atual configurado |
|---|---:|---:|---:|---:|---:|---:|
| 1d20+5 · full | 96.433,97 / 51,85 [50,48–84,12] | 88.800,56 / 56,31 [54,05–63,37] | 81.844,31 / 61,09 [60,11–61,78] | 81.133,01 / 61,63 [58,01–62,75] | 163.009,02 / 30,67 [29,87–37,99] | 179.525,16 / 27,85 [26,45–29,1] |
| 100d6 · full | 13.221,15 / 378,18 [357,32–402,05] | 18.595,01 / 268,89 [256,71–272,49] | 4.701,63 / 1.063,46 [1.047,46–1.079,5] | 4.721,75 / 1.058,93 [1.011,88–1.112,04] | 9.675,87 / 516,75 [497,26–536,37] | 10.840,7 / 461,22 [445,55–473,28] |
| 20d6!2ro=1kh10 · full | 31.362,59 / 159,43 [152,58–177,8] | 32.441,14 / 154,13 [145,36–160,6] | 9.093,73 / 549,83 [544,66–553,93] | 9.222,78 / 542,14 [535,63–548,52] | 28.775,73 / 173,76 [169,13–178,2] | 30.777,53 / 162,46 [160,27–169,03] |

## Comparação das medianas

Valores maiores que 1 indicam vantagem do numerador; ganhos próximos do ruído exigem confirmação adicional antes de conclusões fortes.

| Carga | Go atual/anterior padrão | Go atual/anterior configurado | Go atual configurado/Node | Go atual configurado/Bun |
|---|---:|---:|---:|---:|
| 1d20+5 · full | 0,99× | 1,1× | 1,86× | 2,02× |
| 100d6 · full | 1× | 1,12× | 0,82× | 0,58× |
| 20d6!2ro=1kh10 · full | 1,01× | 1,07× | 0,98× | 0,95× |

## Memória observada

Cada célula: **mediana / maior snapshot RSS em MiB**. Snapshots após os lotes, com workers e últimos resultados vivos, incluindo runtime e harness. Não representam pico, limite ou custo isolado da expressão: o processo percorre cargas sucessivas e pode reter memória anterior.

| Carga | Node | Bun | Go anterior padrão | Go atual padrão | Go anterior configurado | Go atual configurado |
|---|---:|---:|---:|---:|---:|---:|
| 1d20+5 · full | 244,67 / 245,54 | 164,97 / 170,04 | 16,06 / 17,52 | 15,81 / 16,36 | 34,54 / 44,89 | 32,36 / 32,78 |
| 100d6 · full | 318,89 / 342,96 | 276,88 / 289,32 | 16,22 / 16,78 | 35,21 / 54,86 | 41,94 / 75,85 | 33,48 / 40,09 |
| 20d6!2ro=1kh10 · full | 407,57 / 416,95 | 262,91 / 265 | 17,21 / 17,55 | 35,24 / 53,72 | 38,22 / 68,44 | 34,26 / 48,96 |

## Comprimento médio emitido

Bytes por resultado neste corpus ASCII; diferença de tamanho não implica diferença dos valores JSON.

| Carga | Node | Bun | Go anterior padrão | Go atual padrão | Go anterior configurado | Go atual configurado |
|---|---:|---:|---:|---:|---:|---:|
| 1d20+5 · full | 2.381,22 | 2.381,22 | 2.381,22 | 2.381,22 | 2.381,22 | 2.381,22 |
| 100d6 · full | 53.055 | 53.055 | 53.055 | 53.055 | 53.055 | 53.055 |
| 20d6!2ro=1kh10 · full | 15.336,98 | 15.336,98 | 15.336,98 | 15.336,98 | 15.336,98 | 15.336,98 |

## Reprodução e evidência

```powershell
node scripts/compare-json-round3.mjs --go 'C:\Users\quira\.codex\visualizations\2026\07\21\019f8591-c4eb-7913-9683-054308852112\go-runtime-full\go\bin\go.exe' --baseline 'D:\Projetos\ERPG\rpg-dice-roller\.artifacts\optimization-round3\baseline.exe' --bun 'C:\Users\quira\.bun\bin\bun.exe'
```

Requer o executável de testes salvo do baseline, Go, Node, Bun e dist já construído. Teto total de 300 segundos, incluindo preparação, compilação e preflight; duração observada: 55,72 segundos. O script persiste medições parciais em caso de falha. Os resultados e relatórios das rodadas anteriores permanecem preservados. Este ensaio usa lotes e aquecimento diferentes da rodada 2; a comparação causal é atual/anterior medidos nesta mesma rodada. CPU, JIT, GC, escalonamento e outras tarefas da máquina podem afetar medições locais.

[Dados brutos e manifestos](benchmarks/optimization-round3/json-round3.json) · [Preflight integral gzip](benchmarks/optimization-round3/json-round3-preflight.json.gz) · [Orquestrador](../scripts/compare-json-round3.mjs) · [Rodada anterior](JSON_BENCHMARK.md).
