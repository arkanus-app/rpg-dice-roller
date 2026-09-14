# Rodada 6: Node versus Go · 1 worker

Mesma API full seguida de JSON.stringify no Node e dicecore.MarshalJSON no Go. Compara Node com Go anterior (f107265) e atual, em GC100 e GC500/96MiB. Todas as séries Go usam GOMAXPROCS=12; cada worker possui uma engine. Os dois regimes de GC são apresentados separadamente; a biblioteca não muda a política global.

## Comparações observadas com Node

Contagem de cargas em que a série atual teve melhor valor observado. Vazão usa a mediana dos lotes; CPU/op usa soma dos deltas / soma das chamadas; RSS usa mediana; p50/p95 são da passagem individual. Essas contagens não são testes de significância e não comprovam superioridade em toda carga ou uma capacidade HTTP.

| Série | Vazão maior | CPU/op menor | RSS menor | p50 menor | p95 menor |
|---|---:|---:|---:|---:|---:|
| Go atual · GC100 | 11/11 | 7/11 | 11/11 | 11/11 | 7/11 |
| Go atual · GC500/96MiB | 11/11 | 11/11 | 11/11 | 11/11 | 11/11 |

## Método e escopo

1 workers de aplicação, uma engine por worker, MT19937, freezeResults='never', limites padrão e cache aquecido. O harness cria explicitamente worker_threads no Node e goroutines no Go. A API Node não distribui as chamadas automaticamente: o backend precisa criar e coordenar seus workers. Os workers não recebem resultados pré-computados ou buffers JSON reutilizáveis. Cada chamada constrói um resultado completo e produz saída própria. Não há HTTP, rede, persistência ou conversão adicional da string JavaScript para bytes UTF-8. O teste inclui despacho/conclusão dos workers e digest por chamada.

Cada processo aquece 256 chamadas por worker e mede três lotes de 4096 chamadas por expressão. Duas rodadas em processos novos e ordem invertida produzem seis lotes por série/carga. Seeds são dicecore-backend/v3.7.1/ + índice, distintas dentro do lote e repetidas nas séries. Setup, options, seeds textuais e aquecimento ficam fora do timer; validação/hash da seed e inicialização do gerador fazem parte da rolagem cronometrada.

Depois dos três lotes, cada expressão recebe uma passagem separada de 2048 chamadas com timer individual, totalizando 4096 amostras por série/carga. Os timers de lote e individuais usam duas leituras de contador monotônico: QueryPerformanceCounter no Go/Windows, time.Now/time.Since no Go portátil e process.hrtime.bigint no Node. A frequência do contador Windows é resolvida antes dos workers; somente a diferença de ticks é convertida para nanossegundos, com multiplicação intermediária de 128 bits. Cada worker e o coordenador Go possuem um campo de saída QPC próprio, criado antes das medições e reutilizado, sem alocar esse campo por leitura. Fonte e frequência disponíveis ficam registradas em cada resposta bruta. Durações individuais zero ou negativas continuam sendo rejeitadas, sem arredondá-las artificialmente. O timer individual cobre rolagem e serialização; atualização do digest ocorre após o timer. Os timers, armazenamento das amostras e digest perturbam a execução/GC, embora não sejam adicionados aos tempos dos lotes anteriores. São latências de serviço em loops fechados, sem espera em fila ou transporte; não são p95 de uma API HTTP sob tráfego aberto.

CPU/op soma tempo de usuário e sistema do processo inteiro, incluindo todos os threads de execução, runtime e GC. GetProcessTimes no Windows/getrusage no Linux e process.cpuUsage no Node são lidos em torno de cada lote, ligeiramente fora do timer de parede. Custo dos leitores e resolução dos contadores introduzem ruído; GetProcessTimes pode apresentar deltas quantizados em torno de 15,6 ms no Windows, apesar de expressar valores em unidades de 100 ns. CPU/op principal agrega soma dos deltas / soma das chamadas dos seis lotes. Se alguma leitura faltar ou todos os deltas forem zero, o agregado fica indisponível. Valores zero isolados em lotes curtos não significam trabalho gratuito. Não são CPU individual nem percentis de CPU. CPU/op pode exceder o tempo de parede por operação quando threads trabalham simultaneamente.

RSS usa snapshots após os lotes, antes da passagem de latência, com workers e últimos resultados/JSON vivos. Inclui runtime/harness e memória retida de expressões anteriores; não é pico, teto ou memória isolada por expressão. GOMEMLIMIT=96MiB é flexível e não limita rigidamente o RSS. GC100 remove GOMEMLIMIT herdado.

Ordem inicial: node → go-baseline-default → go-final-default → go-baseline-tuned → go-final-tuned. Ordem final: go-final-tuned → go-baseline-tuned → go-final-default → go-baseline-default → node. Ordem das cargas: 1d20+5 → 100d6 → 20d6!2ro=1kh10 → 1000d6 → 100d6ro=1kh60 → 2#{4d6,3d8+2}kh1 → 20d6!2ro=1kh10 # ação 🎲 → 100dF.2 → 50d6min2.125max4.875kh25 → 40d10>=7f=1 → {6d6,4d8}dl1. As três cargas principais e seis regressões foram preservadas. Os dois últimos casos são holdouts novos, sem uso na seleção das otimizações. As invocações de 1 e 6 workers são arquivos separados, sem agregar suas amostras.

## Ambiente, fontes e paridade

AMD Ryzen 5 5500 · Windows 11 Pro · 12 CPUs lógicas. Node v24.18.0 · go version go1.26.2 windows/amd64. Fontes atuais sobre f1072657da80c837f8e3740c734a89d26619bf50; manifesto 31bb9365b74eac2a11fc43ce49da5793d462fd567e2c52919cf294f6ff0e2901. Baseline f1072657da80c837f8e3740c734a89d26619bf50; binário SHA-256 e773115aa2742e12cc8d0cdb060d626d8f891d444c113ef09906fe488ff1c698. Atual SHA-256 b9b740f97b8704df4eabee585fed5d3587d44fc606850f40b555f1bd1489b469. Workers Go são iguais byte a byte entre o worktree baseline e a raiz; o baseline não possui alterações rastreadas em Go. Compilação/origem declaradas, hashes de fontes, workers, binários e build info ficam no JSON bruto. Dist TypeScript existente é usado sem rebuild e possui manifesto.

Preflight: 66 resultados completos em cada uma das cinco séries. Cada Go compara bytes com encoding/json.Marshal; o orquestrador compara todos os bytes entre Go anterior/atual e JSON decodificado integral entre Node/Go. Todos os lotes e passagens individuais devem ter contagem, totais, soma ponderada e chamadas aleatórias idênticas. Comprimentos Go são idênticos; Node mede unidades UTF-16, Go bytes UTF-8, portanto o comentário Unicode pode produzir comprimentos distintos. Os digests não substituem conformidade e testes de propriedade.

## Vazão e tempo dos lotes

Cada célula: operações/s / mediana em ms [Q1–Q3].

| Carga | Node | Go anterior · GC100 | Go atual · GC100 | Go anterior · GC500/96MiB | Go atual · GC500/96MiB |
|---|---:|---:|---:|---:|---:|
| 1d20+5 | 31.904,19 / 128,38 [126,44–130,03] | 83.620,25 / 48,98 [44,86–54,24] | 92.977,86 / 44,05 [42,55–47,25] | 98.207,17 / 41,71 [39,35–45,82] | 103.008,26 / 39,76 [37,78–44,2] |
| 100d6 | 5.565,15 / 736,01 [729,87–762,42] | 9.274,39 / 441,65 [425,16–469,71] | 11.145,29 / 367,51 [290,9–506,29] | 14.018,78 / 292,18 [276,56–305,19] | 17.550,05 / 233,39 [228,65–241,05] |
| 20d6!2ro=1kh10 | 12.301,16 / 332,98 [319,25–340,57] | 20.027,37 / 204,52 [193,11–218,37] | 18.906,51 / 216,64 [194,26–226,79] | 31.488,39 / 130,08 [128,64–131,85] | 34.902,38 / 117,36 [115,81–118,33] |
| 1000d6 | 487,64 / 8.399,72 [8.288,64–8.547,27] | 448,43 / 9.134,01 [8.682,43–10.075,22] | 617,01 / 6.638,48 [4.381,32–7.888,26] | 1.361,66 / 3.008,1 [2.935,81–3.130,25] | 1.632,66 / 2.508,79 [2.497,01–2.616,52] |
| 100d6ro=1kh60 | 4.706,99 / 870,19 [847,76–889,36] | 5.212,95 / 785,74 [775,65–843,15] | 5.401,23 / 758,35 [729,68–800,24] | 10.092,27 / 405,86 [380,21–472,63] | 12.094,09 / 338,68 [328,83–354,15] |
| 2#{4d6,3d8+2}kh1 | 14.586,73 / 280,8 [271,1–294,23] | 23.466,08 / 174,55 [170,6–197,51] | 23.678,65 / 172,98 [163,52–180,99] | 32.080,21 / 127,68 [121,65–130,39] | 34.567,68 / 118,49 [113,65–126,51] |
| 20d6!2ro=1kh10 # ação 🎲 | 11.666,2 / 351,1 [339,68–363,86] | 17.644,52 / 232,14 [217,12–245,81] | 18.747,77 / 218,48 [205,66–237,16] | 30.410,34 / 134,69 [130,84–143,32] | 32.750,35 / 125,07 [119,22–129,35] |
| 100dF.2 | 5.378,21 / 761,59 [736,28–791,17] | 8.328 / 491,83 [477,64–499,02] | 8.702,7 / 470,66 [444,56–477,66] | 14.299,59 / 286,44 [276,79–318,92] | 16.509,95 / 248,09 [232,95–270,61] |
| 50d6min2.125max4.875kh25 | 6.711,27 / 610,32 [580,79–649,45] | 7.912,17 / 517,68 [504,86–539,23] | 8.187,02 / 500,3 [486,53–507,45] | 12.648,05 / 323,84 [311,35–334,67] | 13.598,87 / 301,2 [284,92–309,24] |
| 40d10>=7f=1 | 9.082,32 / 450,99 [439,67–479,62] | 9.841,68 / 416,19 [411,15–430,78] | 10.045,56 / 407,74 [353,23–425,63] | 18.404,18 / 222,56 [213,15–256,65] | 20.289,82 / 201,87 [196,52–210,39] |
| {6d6,4d8}dl1 | 19.899,62 / 205,83 [196,94–210,17] | 40.171,32 / 101,96 [98,69–110,14] | 46.924,64 / 87,29 [80,44–95,04] | 57.467,27 / 71,28 [69,44–74,22] | 59.843,98 / 68,44 [66,13–70,05] |

## CPU por operação

Agregado em µs de CPU/op / mediana dos lotes [Q1–Q3], processo inteiro; menor é melhor. Leituras brutas estão no JSON.

| Carga | Node | Go anterior · GC100 | Go atual · GC100 | Go anterior · GC500/96MiB | Go atual · GC500/96MiB |
|---|---:|---:|---:|---:|---:|
| 1d20+5 | 40,65 / 41,99 [41,99–44,56] | 17,17 / 17,17 [12,4–19,07] | 11,44 / 11,44 [11,44–11,44] | 11,44 / 11,44 [11,44–11,44] | 12,08 / 11,44 [11,44–11,44] |
| 100d6 | 185,02 / 183,11 [182,92–183,29] | 155,77 / 154,5 [146,87–162,12] | 134,79 / 125,89 [107,77–149,73] | 80,74 / 78,2 [76,29–80,11] | 70,57 / 74,39 [69,62–76,29] |
| 20d6!2ro=1kh10 | 90,33 / 85,94 [83,86–93,51] | 66,12 / 59,13 [57,22–66,76] | 66,12 / 61,04 [61,04–63,9] | 31,15 / 30,52 [30,52–33,38] | 30,52 / 30,52 [30,52–30,52] |
| 1000d6 | 2.051,07 / 2.036,99 [2.007,63–2.086,67] | 3.096,9 / 3.238,68 [3.017,43–3.623,01] | 2.374,01 / 2.403,26 [1.768,11–2.889,63] | 888,19 / 904,08 [851,63–927,93] | 735,6 / 728,61 [717,16–748,63] |
| 100d6ro=1kh60 | 209,76 / 213,5 [201,11–217,47] | 250,5 / 240,33 [227,93–275,61] | 252,41 / 242,23 [234,6–269,89] | 113,81 / 114,44 [98,23–127,79] | 92,19 / 89,65 [87,74–94,41] |
| 2#{4d6,3d8+2}kh1 | 75,03 / 74,34 [69,76–79,1] | 55,95 / 57,22 [48,64–60,08] | 54,68 / 55,31 [44,82–62,94] | 33,7 / 34,33 [31,47–34,33] | 30,52 / 30,52 [27,66–33,38] |
| 20d6!2ro=1kh10 # ação 🎲 | 85,82 / 85,82 [80,87–90,58] | 75,66 / 78,2 [66,76–86,78] | 68,66 / 68,66 [60,08–74,39] | 34,97 / 34,33 [31,47–37,19] | 36,24 / 36,24 [34,33–41,01] |
| 100dF.2 | 188,19 / 188,72 [180,36–197,27] | 172,3 / 173,57 [153,54–193,6] | 153,86 / 154,5 [148,77–163,08] | 71,21 / 72,48 [69,62–72,48] | 63,58 / 62,94 [54,36–71,53] |
| 50d6min2.125max4.875kh25 | 152,55 / 152,47 [145,94–159,18] | 191,37 / 186,92 [174,52–207,9] | 179,93 / 169,75 [164,99–183,11] | 80,11 / 80,11 [73,43–86,78] | 82,65 / 83,92 [77,25–87,74] |
| 40d10>=7f=1 | 119,59 / 112,67 [110,66–123,11] | 166,58 / 167,85 [156,4–170,71] | 146,23 / 144,96 [122,07–167,85] | 61,67 / 55,31 [53,41–68,66] | 58,49 / 57,22 [51,5–62,94] |
| {6d6,4d8}dl1 | 52,21 / 51,64 [46,88–56,4] | 37,51 / 34,33 [26,7–47,68] | 21,62 / 20,98 [16,21–25,75] | 17,8 / 19,07 [16,21–19,07] | 17,17 / 17,17 [15,26–19,07] |

## Latências individuais

Cada célula: p50 / p95 em µs, passagem separada com 4096 amostras; menor é melhor.

| Carga | Node | Go anterior · GC100 | Go atual · GC100 | Go anterior · GC500/96MiB | Go atual · GC500/96MiB |
|---|---:|---:|---:|---:|---:|
| 1d20+5 | 23,8 / 49,03 | 8,8 / 15,73 | 8,7 / 17,1 | 8,8 / 13,7 | 8,5 / 13,1 |
| 100d6 | 165,2 / 315,65 | 55,5 / 235,18 | 45,9 / 199 | 56,6 / 90,4 | 48,2 / 75,63 |
| 20d6!2ro=1kh10 | 67,3 / 128,98 | 27,9 / 115,8 | 25,5 / 102,23 | 27,7 / 43,6 | 25,3 / 38 |
| 1000d6 | 1.846,65 / 2.791,23 | 1.154,35 / 12.234,25 | 1.043,25 / 12.698,9 | 615,8 / 1.298,5 | 533,2 / 1.154,55 |
| 100d6ro=1kh60 | 189,5 / 321,9 | 78,2 / 391,08 | 68,7 / 341,9 | 80,4 / 135,7 | 70,8 / 118,58 |
| 2#{4d6,3d8+2}kh1 | 58,1 / 111,93 | 26,3 / 88,95 | 24,1 / 79,43 | 26,2 / 47,1 | 24,3 / 40,3 |
| 20d6!2ro=1kh10 # ação 🎲 | 78 / 145,5 | 28,1 / 135,55 | 25,1 / 123,65 | 28,9 / 50,33 | 25,8 / 43,33 |
| 100dF.2 | 166,55 / 298,4 | 62,3 / 328,03 | 50,5 / 249,23 | 59,9 / 102,9 | 51,7 / 89,53 |
| 50d6min2.125max4.875kh25 | 135,55 / 265,4 | 67,6 / 360,63 | 73,15 / 353,73 | 69,2 / 121,85 | 61,3 / 107,5 |
| 40d10>=7f=1 | 96,7 / 183,2 | 47,3 / 284,48 | 43,2 / 254,8 | 45,7 / 80,13 | 41,7 / 71,35 |
| {6d6,4d8}dl1 | 40,5 / 85,7 | 15,1 / 41,15 | 14,3 / 40,4 | 15,5 / 25,4 | 14,4 / 23,5 |

## Memória residente

Cada célula: mediana / maior snapshot RSS em MiB.

| Carga | Node | Go anterior · GC100 | Go atual · GC100 | Go anterior · GC500/96MiB | Go atual · GC500/96MiB |
|---|---:|---:|---:|---:|---:|
| 1d20+5 | 135,33 / 135,43 | 14,62 / 15,1 | 14,71 / 15,1 | 30,39 / 30,91 | 30,54 / 33,69 |
| 100d6 | 161,39 / 161,93 | 15,06 / 15,56 | 14,8 / 14,92 | 38,29 / 61,25 | 31,77 / 31,81 |
| 20d6!2ro=1kh10 | 205,42 / 220,66 | 15,78 / 23,05 | 15,39 / 15,55 | 37,26 / 59,91 | 32,44 / 32,8 |
| 1000d6 | 331,52 / 354,9 | 16,41 / 32,96 | 16,2 / 20,24 | 33,69 / 33,84 | 33,52 / 33,7 |
| 100d6ro=1kh60 | 272,01 / 284,63 | 16,43 / 17,75 | 16,4 / 25,24 | 32,93 / 33,25 | 33,07 / 55,68 |
| 2#{4d6,3d8+2}kh1 | 274,59 / 288,15 | 16,81 / 22,45 | 16,79 / 19,05 | 33,14 / 48,72 | 33,16 / 34,33 |
| 20d6!2ro=1kh10 # ação 🎲 | 273,37 / 285,88 | 16,61 / 16,81 | 16,58 / 16,82 | 33,08 / 33,29 | 35,36 / 56,59 |
| 100dF.2 | 272,51 / 284,77 | 16,83 / 21,65 | 16,65 / 16,81 | 33,39 / 33,65 | 33,78 / 47,93 |
| 50d6min2.125max4.875kh25 | 274,22 / 286,39 | 17,4 / 17,54 | 17,14 / 17,34 | 33,96 / 48,57 | 34,08 / 70,43 |
| 40d10>=7f=1 | 276,34 / 286,78 | 17,25 / 18,72 | 17,13 / 17,3 | 34,04 / 34,45 | 34,61 / 70,85 |
| {6d6,4d8}dl1 | 278,13 / 291,59 | 17,42 / 17,7 | 17,37 / 17,89 | 34,34 / 36,17 | 41,94 / 58,01 |

## Reprodução e arquivos

```powershell
node scripts/compare-node-round6.mjs --workers 1 --go 'C:/Users/quira/.codex/visualizations/2026/07/21/019f8591-c4eb-7913-9683-054308852112/go-runtime-full/go/bin/go.exe' --baseline 'D:\Projetos\ERPG\rpg-dice-roller\.artifacts\optimization-round6\node-qpc-baseline.exe' --candidate 'D:\Projetos\ERPG\rpg-dice-roller\.artifacts\optimization-round6\node-qpc-final.exe' --baseline-source 'D:\Projetos\ERPG\rpg-dice-roller\.artifacts\optimization-round6\baseline-src'
```

O baseline precisa ser compilado com os mesmos novos arquivos *_test.go listados no manifesto workerSource. Sem --candidate, o script compila o atual antes dos timers. Limite por invocação: 540 segundos, incluindo preflight e compilação; observado: 327,71 s. Apenas um processo de medição por vez; falhas preservam dados parciais. A máquina compartilhada, frequência de CPU, GC e escalonamento afetam as medições.

[Dados brutos e manifestos](benchmarks/optimization-round6/node-round6-w1.json) · [Preflight integral](benchmarks/optimization-round6/node-round6-w1-preflight.json.gz) · [Orquestrador](../scripts/compare-node-round6.mjs) · [Worker Go](node_compare_bench_test.go) · [Worker Node](../scripts/benchmark-node-reference-round6.mjs).
