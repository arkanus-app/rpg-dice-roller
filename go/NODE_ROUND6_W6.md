# Rodada 6: Node versus Go · 6 workers

Mesma API full seguida de JSON.stringify no Node e dicecore.MarshalJSON no Go. Compara Node com Go anterior (f107265) e atual, em GC100 e GC500/96MiB. Todas as séries Go usam GOMAXPROCS=12; cada worker possui uma engine. Os dois regimes de GC são apresentados separadamente; a biblioteca não muda a política global.

## Comparações observadas com Node

Contagem de cargas em que a série atual teve melhor valor observado. Vazão usa a mediana dos lotes; CPU/op usa soma dos deltas / soma das chamadas; RSS usa mediana; p50/p95 são da passagem individual. Essas contagens não são testes de significância e não comprovam superioridade em toda carga ou uma capacidade HTTP.

| Série | Vazão maior | CPU/op menor | RSS menor | p50 menor | p95 menor |
|---|---:|---:|---:|---:|---:|
| Go atual · GC100 | 3/11 | 7/11 | 11/11 | 4/11 | 1/11 |
| Go atual · GC500/96MiB | 11/11 | 11/11 | 11/11 | 11/11 | 5/11 |

## Método e escopo

6 workers de aplicação, uma engine por worker, MT19937, freezeResults='never', limites padrão e cache aquecido. O harness cria explicitamente worker_threads no Node e goroutines no Go. A API Node não distribui as chamadas automaticamente: o backend precisa criar e coordenar seus workers. Os workers não recebem resultados pré-computados ou buffers JSON reutilizáveis. Cada chamada constrói um resultado completo e produz saída própria. Não há HTTP, rede, persistência ou conversão adicional da string JavaScript para bytes UTF-8. O teste inclui despacho/conclusão dos workers e digest por chamada.

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
| 1d20+5 | 95.220,38 / 43,02 [41,52–51,73] | 146.820,56 / 27,9 [26,69–32,62] | 144.653,71 / 28,32 [26,71–29,03] | 303.057,21 / 13,52 [13,2–14,11] | 259.867,97 / 15,76 [14,43–17,42] |
| 100d6 | 17.011,3 / 240,78 [238,48–243,39] | 14.534,8 / 281,81 [267,65–300,56] | 18.057,73 / 226,83 [223,37–232,59] | 38.616,65 / 106,07 [98,38–110,5] | 37.879,77 / 108,13 [104,71–116,74] |
| 20d6!2ro=1kh10 | 39.799,76 / 102,92 [92,04–112,9] | 27.922,55 / 146,69 [145,55–152,85] | 29.282,28 / 139,88 [136,63–141,35] | 83.355,63 / 49,14 [46,63–53,69] | 62.719,35 / 65,31 [56,32–71,35] |
| 1000d6 | 1.515,96 / 2.701,92 [2.479,49–2.829,34] | 2.096,49 / 1.953,74 [1.870,34–2.057,51] | 2.295,67 / 1.784,23 [1.656,04–1.890,4] | 3.616,46 / 1.132,6 [1.106,82–1.228,9] | 3.799,66 / 1.077,99 [1.025,22–1.123,54] |
| 100d6ro=1kh60 | 15.697,59 / 260,93 [254,47–266,63] | 9.508,97 / 430,75 [424,46–462,95] | 10.670,31 / 383,87 [368,44–387,4] | 28.370,21 / 144,38 [138,92–163,3] | 28.883,49 / 141,81 [136,47–147,13] |
| 2#{4d6,3d8+2}kh1 | 50.464,95 / 81,17 [75,14–85,91] | 31.617,45 / 129,55 [120,04–154,81] | 34.992,58 / 117,05 [110,17–126,93] | 109.273,29 / 37,48 [37,04–38,14] | 85.590,82 / 47,86 [43,33–53,07] |
| 20d6!2ro=1kh10 # ação 🎲 | 45.945,14 / 89,15 [87,52–90,09] | 21.842,66 / 187,52 [158,64–206,5] | 26.876,86 / 152,4 [139,84–168,97] | 92.466,34 / 44,3 [43,55–45,05] | 92.589,35 / 44,24 [42,51–51,97] |
| 100dF.2 | 19.520,22 / 209,83 [202,12–235,63] | 13.775,53 / 297,34 [279,17–323,66] | 15.266,75 / 268,3 [253,68–296,85] | 40.966,37 / 99,98 [97,63–102,53] | 40.697,46 / 100,65 [98,97–105,57] |
| 50d6min2.125max4.875kh25 | 23.611,78 / 173,47 [145,78–200,51] | 11.600,27 / 353,1 [299,44–407,1] | 14.341,97 / 285,6 [278,97–298,67] | 34.712,36 / 118 [117,14–121,66] | 30.546,55 / 134,09 [122,76–139,58] |
| 40d10>=7f=1 | 32.833,44 / 124,75 [121,67–126,63] | 14.624,82 / 280,07 [267,03–300,31] | 18.454,08 / 221,96 [219,06–222,76] | 42.472,03 / 96,44 [88,32–103,05] | 47.634,3 / 85,99 [81,53–92,52] |
| {6d6,4d8}dl1 | 66.247,39 / 61,83 [61,19–63,25] | 62.320,08 / 65,73 [62,32–73,62] | 63.010,78 / 65 [59,61–72,93] | 170.241,42 / 24,06 [22,32–25,52] | 120.090,36 / 34,11 [30,56–38,76] |

## CPU por operação

Agregado em µs de CPU/op / mediana dos lotes [Q1–Q3], processo inteiro; menor é melhor. Leituras brutas estão no JSON.

| Carga | Node | Go anterior · GC100 | Go atual · GC100 | Go anterior · GC500/96MiB | Go atual · GC500/96MiB |
|---|---:|---:|---:|---:|---:|
| 1d20+5 | 66,16 / 61,04 [57,19–76,23] | 29,88 / 30,52 [20,03–43,87] | 36,24 / 34,33 [27,66–43,87] | 12,08 / 11,44 [0,95–21,93] | 20,98 / 20,98 [19,07–22,89] |
| 100d6 | 338,87 / 335,69 [332,76–341,55] | 282,92 / 286,1 [253,68–312,81] | 226,34 / 226,97 [210,76–231,74] | 126,52 / 125,89 [122,07–138,28] | 125,89 / 120,16 [111,58–140,19] |
| 20d6!2ro=1kh10 | 146,24 / 141,11 [138,37–152,47] | 148,77 / 148,77 [130,65–164,03] | 136,69 / 143,05 [121,12–150,68] | 64,85 / 62,94 [61,04–67,71] | 61,04 / 62,94 [55,31–64,85] |
| 1000d6 | 3.657,06 / 3.675,42 [3.488,65–3.813,84] | 2.318,06 / 2.382,28 [2.186,78–2.446,17] | 2.072,02 / 2.073,29 [1.984,6–2.127,65] | 1.445,13 / 1.445,77 [1.415,25–1.464,84] | 1.346,59 / 1.348,5 [1.309,39–1.370,43] |
| 100d6ro=1kh60 | 363,69 / 366,21 [359,62–370,06] | 448,86 / 476,84 [395,77–497,82] | 399,91 / 406,27 [381,47–422,48] | 170,39 / 162,12 [147,82–196,46] | 172,93 / 165,94 [157,36–194,55] |
| 2#{4d6,3d8+2}kh1 | 123,33 / 123,9 [106,81–135,31] | 117,62 / 104,9 [92,51–145,91] | 120,16 / 110,63 [94,41–152,59] | 43,87 / 45,78 [41,96–52,45] | 60,4 / 64,85 [53,41–67,71] |
| 20d6!2ro=1kh10 # ação 🎲 | 116,33 / 118,29 [109,56–121,15] | 193,28 / 186,92 [184,06–206,95] | 136,69 / 139,24 [123,02–152,59] | 53,41 / 53,41 [50,54–56,27] | 55,31 / 53,41 [41,96–70,57] |
| 100dF.2 | 298,83 / 289,79 [277,47–322,45] | 296,27 / 295,64 [254,63–333,79] | 246,05 / 234,6 [219,35–247] | 132,88 / 135,42 [116,35–148,77] | 118,89 / 122,07 [105,86–132,56] |
| 50d6min2.125max4.875kh25 | 240,28 / 259,28 [214,54–275,63] | 315,98 / 312,81 [275,61–347,14] | 314,08 / 312,81 [288,96–342,37] | 153,86 / 164,03 [145,91–173,57] | 155,77 / 148,77 [148,77–157,36] |
| 40d10>=7f=1 | 171,59 / 173,58 [158,39–185,85] | 270,84 / 259,4 [245,09–273,7] | 239,69 / 238,42 [219,35–251,77] | 107,45 / 110,63 [97,27–121,12] | 109,35 / 99,18 [92,51–123,02] |
| {6d6,4d8}dl1 | 106,24 / 104,98 [94,6–109,68] | 65,49 / 59,13 [42,92–78,2] | 75,02 / 76,29 [51,5–86,78] | 32,42 / 28,61 [23,84–41,96] | 42,6 / 38,15 [38,15–41,01] |

## Latências individuais

Cada célula: p50 / p95 em µs, passagem separada com 4096 amostras; menor é melhor.

| Carga | Node | Go anterior · GC100 | Go atual · GC100 | Go anterior · GC500/96MiB | Go atual · GC500/96MiB |
|---|---:|---:|---:|---:|---:|
| 1d20+5 | 49,9 / 107,55 | 13,9 / 184,5 | 14,7 / 214,23 | 14 / 31 | 13,5 / 44,3 |
| 100d6 | 346 / 631,68 | 378,3 / 767,4 | 315,25 / 657,25 | 100,4 / 531,58 | 89,5 / 503,83 |
| 20d6!2ro=1kh10 | 131 / 237,9 | 231,15 / 516,9 | 212,25 / 479,5 | 44,6 / 226,65 | 45,6 / 317,38 |
| 1000d6 | 4.191,4 / 7.600,1 | 2.784,75 / 5.131 | 2.315,5 / 3.848,78 | 1.281,3 / 3.181,8 | 1.275,9 / 3.392,18 |
| 100d6ro=1kh60 | 313,65 / 489,85 | 600,75 / 1.205,53 | 490,25 / 891,85 | 126,9 / 673,6 | 130,2 / 652,58 |
| 2#{4d6,3d8+2}kh1 | 73,15 / 145,63 | 178,15 / 645,6 | 157,3 / 470,63 | 30,55 / 148,58 | 40,1 / 191,85 |
| 20d6!2ro=1kh10 # ação 🎲 | 102 / 188,43 | 246,35 / 529,85 | 231,5 / 554,9 | 38,6 / 221,95 | 42,3 / 246,98 |
| 100dF.2 | 281,9 / 456,65 | 401,6 / 872,28 | 359,85 / 834,23 | 94,6 / 470,53 | 89,85 / 448,33 |
| 50d6min2.125max4.875kh25 | 231,05 / 432,15 | 463 / 992,85 | 389,65 / 758,85 | 112,5 / 591,6 | 113 / 600,95 |
| 40d10>=7f=1 | 163,6 / 244,05 | 357,9 / 769,45 | 303,85 / 631,7 | 84,1 / 469,83 | 78,9 / 525,58 |
| {6d6,4d8}dl1 | 70,2 / 122,18 | 50,9 / 327,23 | 44 / 323,3 | 24 / 62,48 | 24,9 / 80,63 |

## Memória residente

Cada célula: mediana / maior snapshot RSS em MiB.

| Carga | Node | Go anterior · GC100 | Go atual · GC100 | Go anterior · GC500/96MiB | Go atual · GC500/96MiB |
|---|---:|---:|---:|---:|---:|
| 1d20+5 | 245,86 / 246,23 | 15,67 / 21,95 | 15,79 / 16,66 | 33,1 / 33,83 | 32,7 / 54,3 |
| 100d6 | 295,62 / 328,51 | 16,41 / 16,67 | 16,46 / 16,89 | 37,42 / 52,5 | 67,97 / 81,66 |
| 20d6!2ro=1kh10 | 315,71 / 333,93 | 17,08 / 17,35 | 17,02 / 17,37 | 34,42 / 37,56 | 74,13 / 91,47 |
| 1000d6 | 1.033,14 / 1.083,12 | 31,56 / 33,78 | 31,32 / 32,52 | 90,5 / 93,04 | 90,8 / 92,75 |
| 100d6ro=1kh60 | 1.020,97 / 1.025,48 | 18,4 / 18,88 | 17,88 / 18,89 | 40,23 / 80,84 | 57,28 / 77,94 |
| 2#{4d6,3d8+2}kh1 | 1.013,06 / 1.028,07 | 17,75 / 17,96 | 17,71 / 17,94 | 34,32 / 47,47 | 41,99 / 66,8 |
| 20d6!2ro=1kh10 # ação 🎲 | 1.037,73 / 1.055,8 | 18,13 / 18,66 | 18 / 18,18 | 34,37 / 44,53 | 35,5 / 44,51 |
| 100dF.2 | 1.036,74 / 1.055,27 | 18,56 / 18,91 | 18,66 / 19,17 | 49,98 / 81,45 | 45,99 / 59,3 |
| 50d6min2.125max4.875kh25 | 1.041,79 / 1.057,57 | 18,47 / 19,81 | 18,55 / 19,42 | 42,97 / 57,29 | 58 / 71,16 |
| 40d10>=7f=1 | 1.041,42 / 1.062,45 | 18,46 / 19,5 | 18,9 / 20,36 | 45,11 / 67,34 | 62,36 / 85,11 |
| {6d6,4d8}dl1 | 1.058,89 / 1.087,22 | 18,84 / 20,17 | 18,84 / 19,7 | 53,43 / 67,42 | 58,99 / 86,06 |

## Reprodução e arquivos

```powershell
node scripts/compare-node-round6.mjs --workers 6 --go 'C:/Users/quira/.codex/visualizations/2026/07/21/019f8591-c4eb-7913-9683-054308852112/go-runtime-full/go/bin/go.exe' --baseline 'D:\Projetos\ERPG\rpg-dice-roller\.artifacts\optimization-round6\node-qpc-baseline.exe' --candidate 'D:\Projetos\ERPG\rpg-dice-roller\.artifacts\optimization-round6\node-qpc-final.exe' --baseline-source 'D:\Projetos\ERPG\rpg-dice-roller\.artifacts\optimization-round6\baseline-src'
```

O baseline precisa ser compilado com os mesmos novos arquivos *_test.go listados no manifesto workerSource. Sem --candidate, o script compila o atual antes dos timers. Limite por invocação: 540 segundos, incluindo preflight e compilação; observado: 129,14 s. Apenas um processo de medição por vez; falhas preservam dados parciais. A máquina compartilhada, frequência de CPU, GC e escalonamento afetam as medições.

[Dados brutos e manifestos](benchmarks/optimization-round6/node-round6-w6.json) · [Preflight integral](benchmarks/optimization-round6/node-round6-w6-preflight.json.gz) · [Orquestrador](../scripts/compare-node-round6.mjs) · [Worker Go](node_compare_bench_test.go) · [Worker Node](../scripts/benchmark-node-reference-round6.mjs).
