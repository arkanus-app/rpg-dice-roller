# Rodada 4: resultado completo + JSON

Comparação local da API full seguida por JSON.stringify em Node/Bun e encoding/json.Marshal em Go. Go atual teve a maior mediana de vazão em **0/3 cargas com GC padrão** e **1/3 com GC configurado**, comparado aos dois runtimes JavaScript. Essas contagens descrevem esta amostra; não são um teste de significância ou uma garantia de capacidade HTTP.

## Ambiente e origem

AMD Ryzen 5 5500 · Windows 11 Pro · 12 CPUs lógicas. Node v24.18.0, Bun 1.4.0, go version go1.26.2 windows/amd64. Baseline declarado: commit `8432345e43aae0aec2f4d505964ab19ec3a43668` (`8432345`), executável preservado antes das alterações. Atual: árvore sobre `8432345e43aae0aec2f4d505964ab19ec3a43668`, 13 entradas modificadas; o manifesto registra os bytes efetivamente compilados e executados.

O executável baseline é fornecido pelo chamador; o script registra seu SHA-256 e build info, mas não recompila nem prova por si só sua origem. Os arquivos dos workers Go e JavaScript foram comparados ao commit baseline e permaneceram iguais (desconsiderando apenas CRLF/LF). O dist TypeScript existente é usado sem rebuild e possui hashes próprios no manifesto. Baseline SHA-256: `ac158c77c539bdec46f5776738532bf77804cfdaf12a52480ee1ef0d99af7df5`. Atual SHA-256: `b65c967f70cdb7995ba4dc8449e34ae73597bed5d3cec096d987fa5f7bab2142`. Fontes estáveis: `04058439f51f2495537844cc7318c3222144c41639819a8ec55b7d1cf67c6a04`.

## Método

Três cargas full, seis workers de aplicação e uma engine por worker. MT19937, limites padrão, freezeResults='never', cache aquecido, seeds únicas no lote (prefixo `dicecore-backend/v3.7.1/` + índice), repetidas entre configurações para permitir a comparação exata. Todos os processos Go usam GOMAXPROCS=12. Controles: GOGC=100 e GOMEMLIMIT removido do ambiente. Configurados: GOGC=500 e GOMEMLIMIT=96MiB, parâmetros reutilizados da rodada 2, sem nova seleção. GOMEMLIMIT é um limite flexível da memória gerenciada pelo runtime, não um teto rígido de RSS. A biblioteca não altera o GC global.

Cada processo aquece 1000 chamadas por worker por carga e mede 3 lotes de 5000 chamadas. São duas rodadas com novos processos e ordem invertida, totalizando seis lotes por configuração/carga. Primeira ordem: node → bun → go-baseline-default → go-final-default → go-baseline-tuned → go-final-tuned. Segunda ordem: go-final-tuned → go-baseline-tuned → go-final-default → go-baseline-default → bun → node. As cargas seguem a mesma ordem em cada processo: 1d20+5 → 100d6 → 20d6!2ro=1kh10. Não há processos de medição simultâneos dentro deste script. Compilação única, imports, startup, criação de options e aquecimento ficam fora do cronômetro dos lotes.

O tempo de lote inclui despacho, rolagem, construção do resultado, serialização e espera pelos seis workers. Não inclui HTTP, rede ou conversão adicional da string JavaScript para Buffer UTF-8. Preflight: igualdade integral do JSON decodificado nas seeds de índices 0, 1, 5, 127, 511, 4999 em todas as seis configurações, sem tolerância numérica. Todos os lotes devem concordar em contagem, totais, totais ponderados e chamadas aleatórias; o comprimento codificado é validado entre lotes da mesma configuração. O corpus é ASCII, confirmado no preflight; len(bytes) e string.length medem os comprimentos correspondentes nesse corpus. Ordem das chaves e diferenças textuais de codificação não são forçadas a coincidir.

## Vazão e dispersão

Cada célula: **operações/s / mediana do lote em ms [Q1–Q3]**. Quartis calculados sobre seis lotes; não são p95 nem percentis da latência de chamadas individuais.

| Carga | Node | Bun | Go anterior padrão | Go atual padrão | Go anterior configurado | Go atual configurado |
|---|---:|---:|---:|---:|---:|---:|
| 1d20+5 · full | 137.331,51 / 36,41 [35,46–37,47] | 120.187,54 / 41,6 [40,12–44,9] | 112.788,27 / 44,33 [43,91–45,1] | 114.854,87 / 43,53 [42,78–45,1] | 194.225,67 / 25,74 [21,33–31,47] | 239.728,82 / 20,86 [20,39–21,46] |
| 100d6 · full | 22.516,32 / 222,06 [220,39–300,44] | 26.874,08 / 186,05 [183,36–189,13] | 7.059,42 / 708,27 [683,01–722,57] | 7.250,26 / 689,63 [666,01–698,19] | 15.137,69 / 330,3 [325,02–331,77] | 15.465,9 / 323,29 [321,04–327,27] |
| 20d6!2ro=1kh10 · full | 54.259,65 / 92,15 [89,14–98,05] | 47.485,27 / 105,3 [103,69–105,73] | 11.615,41 / 430,46 [424,43–440,8] | 12.722,71 / 393 [390,14–398,33] | 43.081,16 / 116,06 [112,76–117,4] | 43.004,45 / 116,27 [110,18–118,57] |

## Comparação das medianas

Valores maiores que 1 indicam vantagem do numerador; ganhos próximos do ruído exigem confirmação adicional antes de conclusões fortes.

| Carga | Go atual/anterior padrão | Go atual/anterior configurado | Go atual configurado/Node | Go atual configurado/Bun |
|---|---:|---:|---:|---:|
| 1d20+5 · full | 1,02× | 1,23× | 1,75× | 1,99× |
| 100d6 · full | 1,03× | 1,02× | 0,69× | 0,58× |
| 20d6!2ro=1kh10 · full | 1,1× | 1× | 0,79× | 0,91× |

## Memória observada

Cada célula: **mediana / maior snapshot RSS em MiB**. Snapshots após os lotes, com workers e últimos resultados vivos, incluindo runtime e harness. Não representam pico, limite ou custo isolado da expressão: o processo percorre cargas sucessivas e pode reter memória anterior.

| Carga | Node | Bun | Go anterior padrão | Go atual padrão | Go anterior configurado | Go atual configurado |
|---|---:|---:|---:|---:|---:|---:|
| 1d20+5 · full | 244,83 / 246,71 | 165,6 / 167,28 | 16,18 / 16,76 | 16,06 / 19,47 | 41,07 / 78,15 | 32,04 / 33,71 |
| 100d6 · full | 295,24 / 312,25 | 272,24 / 287,44 | 16,41 / 17,15 | 34,56 / 56,57 | 33,2 / 34,03 | 32,46 / 57,21 |
| 20d6!2ro=1kh10 · full | 404,05 / 411,01 | 260,92 / 265,28 | 17,13 / 17,41 | 35,49 / 53,95 | 43,96 / 62,23 | 37,66 / 76,6 |

## Comprimento médio emitido

Bytes por resultado neste corpus ASCII; diferença de tamanho não implica diferença dos valores JSON.

| Carga | Node | Bun | Go anterior padrão | Go atual padrão | Go anterior configurado | Go atual configurado |
|---|---:|---:|---:|---:|---:|---:|
| 1d20+5 · full | 2.381,22 | 2.381,22 | 2.381,22 | 2.381,22 | 2.381,22 | 2.381,22 |
| 100d6 · full | 53.055 | 53.055 | 53.055 | 53.055 | 53.055 | 53.055 |
| 20d6!2ro=1kh10 · full | 15.336,98 | 15.336,98 | 15.336,98 | 15.336,98 | 15.336,98 | 15.336,98 |

## Reprodução e evidência

```powershell
node scripts/compare-json-round4.mjs --go 'C:\Users\quira\.codex\visualizations\2026\07\21\019f8591-c4eb-7913-9683-054308852112\go-runtime-full\go\bin\go.exe' --baseline 'D:\Projetos\ERPG\rpg-dice-roller\.artifacts\optimization-round4\baseline.exe' --bun 'bun'
```

Requer o executável de testes salvo do baseline, Go, Node, Bun e dist já construído. Teto total de 300 segundos, incluindo preparação, compilação e preflight; duração observada: 37,56 segundos. O script persiste medições parciais em caso de falha. Os resultados e relatórios das rodadas anteriores permanecem preservados. Este ensaio usa lotes e aquecimento diferentes da rodada 2; a comparação causal é atual/anterior medidos nesta mesma rodada. CPU, JIT, GC, escalonamento e outras tarefas da máquina podem afetar medições locais.

[Dados brutos e manifestos](benchmarks/optimization-round4/json-round4.json) · [Preflight integral gzip](benchmarks/optimization-round4/json-round4-preflight.json.gz) · [Orquestrador](../scripts/compare-json-round4.mjs) · [Rodada anterior](JSON_ROUND3_BENCHMARK.md).
