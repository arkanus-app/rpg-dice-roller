# Rodada 4: API de rolagem com seis workers

Comparação local das chamadas full, details e summary da biblioteca, sem serialização dos resultados no trecho cronometrado. Go atual teve a maior vazão calculada pela mediana dos lotes em **5/9 cargas com GC padrão** e **9/9 com GC configurado**, comparado aos dois runtimes JavaScript. Essas contagens descrevem esta amostra; não representam um teste de significância ou garantia de capacidade HTTP. [A medição incluindo JSON](JSON_ROUND4_BENCHMARK.md) constitui um experimento separado.

## Ambiente e origem

AMD Ryzen 5 5500 · Windows 11 Pro · 12 CPUs lógicas. Node v24.18.0, Bun 1.4.0, go version go1.26.2 windows/amd64. Baseline declarado: commit `8432345e43aae0aec2f4d505964ab19ec3a43668` (`8432345`), executável preservado antes das alterações. Atual: árvore sobre `8432345e43aae0aec2f4d505964ab19ec3a43668`, 12 entradas modificadas; o manifesto registra os bytes efetivamente compilados e executados.

O executável baseline é fornecido pelo chamador; seu SHA-256 e build info são registrados, mas o script não recompila nem prova por si só sua origem. Os workers Go e JavaScript e os leitores de RSS foram comparados ao commit baseline e permaneceram iguais (desconsiderando CRLF/LF e espaços nas extremidades dos arquivos). O dist TypeScript existente é usado sem rebuild e possui hashes próprios no manifesto. Baseline SHA-256: `ac158c77c539bdec46f5776738532bf77804cfdaf12a52480ee1ef0d99af7df5`. Atual SHA-256: `b65c967f70cdb7995ba4dc8449e34ae73597bed5d3cec096d987fa5f7bab2142`. Fontes estáveis: `1f8ae906a5434cccf230d95e30a7d22e9da333c220305b8ecc6463a6cbc51220`.

## Método e equivalência

Nove cargas: três expressões nos modos full, details e summary. Seis workers de aplicação, uma engine por worker, MT19937, limites padrão, freezeResults='never' e cache aquecido. A seed é o prefixo `dicecore-backend/v3.7.1/` + índice: são 5000 seeds distintas por lote, repetidas entre lotes e configurações para comparabilidade. Workers Node/Bun são isolates; Go usa goroutines. Não há afinidade ou quota de CPU forçada.

Todos os processos Go usam GOMAXPROCS=12. Controles: GOGC=100 e GOMEMLIMIT removido do ambiente. Configurados: GOGC=500 e GOMEMLIMIT=96MiB, parâmetros reutilizados da rodada 2, sem nova seleção. GOMEMLIMIT é um limite flexível da memória gerenciada pelo runtime, não um teto rígido de RSS. A biblioteca não altera o GC global.

Cada processo aquece 1000 chamadas por worker por carga e mede 3 lotes de 5000 chamadas. Duas rodadas com novos processos e ordem invertida produzem seis lotes por configuração/carga. Primeira ordem: node → bun → go-baseline-default → go-final-default → go-baseline-tuned → go-final-tuned. Segunda ordem: go-final-tuned → go-baseline-tuned → go-final-default → go-baseline-default → bun → node. As cargas seguem a mesma ordem: 1d20+5 · full → 1d20+5 · details → 1d20+5 · summary → 100d6 · full → 100d6 · details → 100d6 · summary → 20d6!2ro=1kh10 · full → 20d6!2ro=1kh10 · details → 20d6!2ro=1kh10 · summary. Os processos de medição são seriais dentro deste script. Compilação única, imports, startup, criação de options e aquecimento ficam fora dos timers.

O timer do lote inclui despacho, rolagem, construção do resultado no modo escolhido e espera pelos seis workers. Somente contadores agregados retornam ao coordenador. Não inclui JSON dos resultados, HTTP, sockets ou transferência de cada resultado completo entre processos. O preflight fora do timer compara os valores completos decodificados nas seeds de índices 0, 1, 5, 127, 511, 4999: 54 resultados em cada uma das 6 configurações. A projeção, o input e todos os campos devem coincidir entre runtimes sem tolerância numérica. Todos os lotes medidos devem concordar em contagem, soma dos totais, soma ponderada pelos índices e chamadas aleatórias. Esses contadores não são um hash criptográfico dos resultados e não substituem os testes de conformidade.

## Vazão e dispersão

Cada célula: **operações/s / mediana do lote em ms [Q1–Q3]**. Vazão calculada como chamadas divididas pela mediana do tempo de lote; quartis entre seis lotes, não p95 de chamadas individuais.

| Carga | Node | Bun | Go anterior padrão | Go atual padrão | Go anterior configurado | Go atual configurado |
|---|---:|---:|---:|---:|---:|---:|
| 1d20+5 · full | 166.524,57 / 30,03 [27,93–30,21] | 136.880,55 / 36,53 [35,62–41,86] | 232.777,38 / 21,48 [20,21–21,7] | 243.359,92 / 20,55 [20,06–20,69] | 519.839,68 / 9,62 [9,54–9,66] | 509.899,7 / 9,81 [8,47–10,56] |
| 1d20+5 · details | 192.813,83 / 25,93 [25,52–27,3] | 142.839,19 / 35 [32,87–35,91] | 321.209,8 / 15,57 [15,08–16,73] | 328.599,31 / 15,22 [15,02–15,75] | 633.842,1 / 7,89 [7,8–8,05] | 606.906,6 / 8,24 [7,76–8,68] |
| 1d20+5 · summary | 199.979,2 / 25 [24,12–26,09] | 151.278,61 / 33,05 [32,3–33,58] | 489.109,97 / 10,22 [9,79–10,54] | 465.672,92 / 10,74 [10,36–10,92] | 938.191,92 / 5,33 [4,82–5,94] | 971.052,91 / 5,15 [4,67–5,88] |
| 100d6 · full | 56.297,75 / 88,81 [87,65–90,7] | 41.758,8 / 119,74 [111,15–127,33] | 31.044,04 / 161,06 [159,64–162,95] | 31.939,09 / 156,55 [152,27–164,39] | 70.076,79 / 71,35 [67,93–73,93] | 72.652,56 / 68,82 [67,23–71,81] |
| 100d6 · details | 78.708,74 / 63,53 [62,32–78,74] | 77.698,93 / 64,35 [63,42–66,64] | 56.810,66 / 88,01 [86,87–90,7] | 58.893,16 / 84,9 [83,34–85,16] | 130.178,16 / 38,41 [35,33–39,46] | 130.483,4 / 38,32 [35,73–40,84] |
| 100d6 · summary | 179.134,1 / 27,91 [27,02–29,41] | 155.596,98 / 32,13 [29,76–33,99] | 350.731,98 / 14,26 [14,03–14,78] | 339.017,53 / 14,75 [14,11–19,5] | 575.188,66 / 8,69 [8,46–8,93] | 604.858,22 / 8,27 [7,56–8,97] |
| 20d6!2ro=1kh10 · full | 93.585,64 / 53,43 [52,42–54,84] | 76.753,81 / 65,14 [63,03–68,56] | 49.039,49 / 101,96 [100,88–102,69] | 52.410,1 / 95,4 [92,97–97,12] | 123.581,29 / 40,46 [32,87–51,81] | 141.169,76 / 35,42 [30,42–45,48] |
| 20d6!2ro=1kh10 · details | 143.241,44 / 34,91 [34,04–38,72] | 85.809,29 / 58,27 [53,21–59,56] | 98.299,52 / 50,86 [50,39–51,64] | 100.874,89 / 49,57 [44,56–59,44] | 263.417,15 / 18,98 [18,67–19,56] | 300.712,99 / 16,63 [15,75–16,91] |
| 20d6!2ro=1kh10 · summary | 154.313,37 / 32,4 [32,04–34,09] | 115.982,51 / 43,11 [40,75–45,34] | 353.098,62 / 14,16 [13,88–20,91] | 344.158,26 / 14,53 [13,81–14,58] | 631.695,98 / 7,92 [7,44–7,94] | 627.218,79 / 7,97 [7,5–8,4] |

## Comparação das medianas

Valores maiores que 1 favorecem o numerador. Diferenças próximas do ruído não sustentam conclusões fortes sem confirmação.

| Carga | Go atual/anterior padrão | Go atual/anterior configurado | Go atual configurado/Node | Go atual configurado/Bun |
|---|---:|---:|---:|---:|
| 1d20+5 · full | 1,05× | 0,98× | 3,06× | 3,73× |
| 1d20+5 · details | 1,02× | 0,96× | 3,15× | 4,25× |
| 1d20+5 · summary | 0,95× | 1,04× | 4,86× | 6,42× |
| 100d6 · full | 1,03× | 1,04× | 1,29× | 1,74× |
| 100d6 · details | 1,04× | 1× | 1,66× | 1,68× |
| 100d6 · summary | 0,97× | 1,05× | 3,38× | 3,89× |
| 20d6!2ro=1kh10 · full | 1,07× | 1,14× | 1,51× | 1,84× |
| 20d6!2ro=1kh10 · details | 1,03× | 1,14× | 2,1× | 3,5× |
| 20d6!2ro=1kh10 · summary | 0,97× | 0,99× | 4,06× | 5,41× |

## Memória residente observada

Cada célula: **mediana / maior snapshot RSS em MiB**. Snapshots após os lotes, com workers e últimos resultados vivos, incluindo runtime e harness. Não representam pico, limite ou custo isolado da expressão: o processo percorre cargas sucessivas e pode reter memória anterior. As leituras acontecem fora do timer; não há conversão de RSS para alocações por chamada.

| Carga | Node | Bun | Go anterior padrão | Go atual padrão | Go anterior configurado | Go atual configurado |
|---|---:|---:|---:|---:|---:|---:|
| 1d20+5 · full | 244,97 / 246,04 | 165,37 / 167,02 | 15,7 / 16,6 | 15,96 / 16,38 | 35,76 / 42,76 | 37,48 / 43,99 |
| 1d20+5 · details | 248,71 / 271,22 | 172,54 / 175,99 | 17,03 / 17,25 | 16,28 / 16,88 | 34,18 / 36,29 | 39,61 / 79,67 |
| 1d20+5 · summary | 288,18 / 293,04 | 194,22 / 195,91 | 17,66 / 20,54 | 16,9 / 18,19 | 32,99 / 34,07 | 56,72 / 80,47 |
| 100d6 · full | 342,98 / 359,98 | 259,33 / 276,11 | 16,31 / 16,38 | 17,63 / 53 | 34,72 / 55,17 | 37,16 / 57,12 |
| 100d6 · details | 422,21 / 467,15 | 276,41 / 277,71 | 16,37 / 16,62 | 34,94 / 53,64 | 33,28 / 52,39 | 34,78 / 36,84 |
| 100d6 · summary | 521,8 / 539,32 | 284,85 / 296,89 | 16,91 / 17,38 | 35,58 / 54,77 | 33,46 / 34,55 | 33,16 / 34,7 |
| 20d6!2ro=1kh10 · full | 480,75 / 499,1 | 287 / 288,99 | 17,02 / 17,21 | 35,33 / 53,9 | 33,3 / 40,95 | 61,81 / 98,91 |
| 20d6!2ro=1kh10 · details | 496,81 / 552,59 | 292,35 / 294,86 | 17,32 / 17,83 | 35,65 / 54,03 | 33,41 / 36,05 | 52,85 / 77,19 |
| 20d6!2ro=1kh10 · summary | 524,91 / 594,5 | 291,21 / 292,98 | 18,05 / 18,61 | 36,09 / 56,06 | 34,01 / 35,6 | 49,94 / 67,28 |

## Reprodução e evidência

```powershell
node scripts/compare-backend-round4.mjs --go 'C:\Users\quira\.codex\visualizations\2026\07\21\019f8591-c4eb-7913-9683-054308852112\go-runtime-full\go\bin\go.exe' --baseline 'D:\Projetos\ERPG\rpg-dice-roller\.artifacts\optimization-round4\baseline.exe' --bun 'bun'
```

Requer o executável de testes salvo do baseline, Go, Node, Bun e dist já construído. Teto total de 300 segundos, incluindo preparação, compilação e preflight; duração observada: 23,41 segundos. Medições parciais são persistidas em caso de falha. Os relatórios e dados anteriores permanecem preservados. Este ensaio usa lotes e aquecimento diferentes dos ensaios backend da rodada 2; a comparação atual/anterior aqui foi medida na mesma rodada. Máquina de trabalho compartilhada: CPU, JIT, GC, escalonamento e outras tarefas podem afetar os tempos locais. Nenhum resultado deve ser interpretado como capacidade de um servidor HTTP ou garantia de ganho linear com mais workers.

[Dados brutos e manifestos](benchmarks/optimization-round4/backend-round4.json) · [Preflight integral gzip](benchmarks/optimization-round4/backend-round4-preflight.json.gz) · [Orquestrador](../scripts/compare-backend-round4.mjs) · [JSON da mesma rodada](JSON_ROUND4_BENCHMARK.md) · [Backend histórico](BACKEND_ROUND2_BENCHMARK.md).
