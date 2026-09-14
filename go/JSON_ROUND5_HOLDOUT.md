# Rodada 5: holdout de generalização do encoder

Comparação da mesma API de rolagem seguida por JSON.stringify em Node/Bun, encoding/json.Marshal no controle Go std e dicecore.MarshalJSON em Go direct. Go direct teve a maior vazão calculada pela mediana dos lotes em **0/6 cargas com GC100** e **6/6 com GC500/96MiB**, comparado aos dois runtimes JavaScript. O uso de dicecore.MarshalJSON é explícito; os tipos e chamadas de rolagem permanecem os mesmos. Essas contagens descrevem esta amostra; não são um teste de significância ou uma garantia de capacidade HTTP.

Este ensaio separado usa seis expressões adicionais e lotes menores, cobrindo volume, reroll/seleção, grupos/múltiplas rolagens, Unicode, Fudge e valores fracionários. Não é agregado ao resultado principal.

## Ambiente e origem

AMD Ryzen 5 5500 · Windows 11 Pro · 12 CPUs lógicas. Node v24.18.0, Bun 1.4.0, go version go1.26.2 windows/amd64. Árvore atual sobre `cecb59b20b689b43b86b98268a8d20bcbdab70cf`, 12 entradas modificadas. Manifesto estável: `d8a65498e5e6dbdd5f44785ccdc1fe83e7cd1f393c7a7045bd2a74700f34c88b`.

As quatro séries Go usam o mesmo executável atual, SHA-256 `a1d7a56eb7cf300fb0bd722316d6f229d58c0bf4e6a34e008e73d79bc9fc2b7b`. A variável entre std/direct é somente o encoder selecionado. O binário preservado do commit `cecb59b20b689b43b86b98268a8d20bcbdab70cf` (`cecb59b`), SHA-256 `68f1a39b70c5f51f06d7225a7e7ff18d87f7f672cfa9ddd563c7915390ab2604`, é usado exclusivamente como controle adicional de preflight com o worker original; seu tempo não aparece nas séries. A origem declarada desse binário não é provada pelo script; hashes e build info permitem auditoria. Workers originais e leitores de RSS são comparados ao commit-base. O novo worker possui hash próprio no manifesto. O dist TypeScript existente é usado sem rebuild e é incluído no manifesto.

## Método

Seis workers de aplicação, uma engine por worker, MT19937, limites padrão, cache aquecido e freezeResults='never'. Seeds distintas entre chamadas de um lote: `dicecore-backend/v3.7.1/` + índice, repetidas em cada lote e configuração. Todos os processos Go usam GOMAXPROCS=12. GOGC=100 remove o GOMEMLIMIT herdado; GOGC=500 aplica GOMEMLIMIT=96MiB. Essa configuração foi reutilizada sem nova seleção; o limite é flexível e não limita rigidamente o RSS.

Cada processo aquece 64 chamadas por worker por expressão e mede 3 lotes de 512 chamadas. Duas rodadas em processos novos, com ordem invertida, totalizam seis lotes por série/carga. Ordem inicial: node → bun → go-std-default → go-direct-default → go-std-tuned → go-direct-tuned. Ordem final: go-direct-tuned → go-std-tuned → go-direct-default → go-std-default → bun → node. Ordem das cargas: 1000d6 → 100d6ro=1kh60 → 2#{4d6,3d8+2}kh1 → 20d6!2ro=1kh10 # ação 🎲 → 100dF.2 → 50d6min2.125max4.875kh25. Todos os processos de medição deste script são seriais. Startup, imports, compilação, criação de options e aquecimento ficam fora do timer.

O worker Go escolhe uma função do tipo func(any) ([]byte, error) antes dos timers. Std e direct executam o mesmo loop, cada chamada construindo um *DiceRollResult completo e serializando-o. O experimento usa MarshalJSON, sem buffer fornecido pelo benchmark nem AppendJSON. Inclui despacho, construção do resultado, serialização e conclusão dos workers. Não inclui HTTP, rede ou conversão adicional da string JavaScript para Buffer UTF-8.

## Paridade

Preflight com índices 0, 1, 5, 127, 255, 511: 36 resultados em cada uma das seis séries e no controle original. O novo worker compara integralmente os bytes do encoder escolhido com encoding/json.Marshal do mesmo resultado, fora do timer. O orquestrador também exige os mesmos bytes em todos os casos Go, incluindo o controle original, e igualdade integral do JSON decodificado frente a Node/Bun, sem tolerância numérica. Em todos os lotes, contagem, totais, soma ponderada e chamadas aleatórias devem coincidir. O comprimento é estável por série e idêntico entre todos os encoders Go. Esses contadores não substituem a suíte de conformidade.

Comprimentos: Go mede bytes UTF-8; Node/Bun medem string.length, em unidades UTF-16. O holdout inclui Unicode; esses comprimentos podem divergir entre linguagens mesmo com conteúdo idêntico. Não é feita conversão UTF-8 no trecho cronometrado do JavaScript.

## Vazão e dispersão

Cada célula: **operações/s / mediana do lote em ms [Q1–Q3]**. Quartis calculados sobre seis lotes; não são p95 de chamadas individuais.

| Carga | Node | Bun | Go std · GC100 | Go direct · GC100 | Go std · GC500/96MiB | Go direct · GC500/96MiB |
|---|---:|---:|---:|---:|---:|---:|
| 1000d6 · full | 1.564,69 / 327,22 [323,95–342,47] | 2.104,65 / 243,27 [239,38–259,62] | 1.006,21 / 508,84 [498,44–630,95] | 1.955,89 / 261,77 [223,07–290,59] | 1.434,45 / 356,93 [336,03–372,31] | 3.940,9 / 129,92 [128,04–132,54] |
| 100d6ro=1kh60 · full | 11.215,97 / 45,65 [44,71–52,18] | 14.571,8 / 35,14 [32,83–38,49] | 4.548,42 / 112,57 [108,95–116,66] | 10.481,43 / 48,85 [47,02–51,14] | 12.068,68 / 42,42 [42,02–42,86] | 26.119,32 / 19,6 [19,18–20,11] |
| 2#{4d6,3d8+2}kh1 · full | 40.789,99 / 12,55 [10,8–13,39] | 23.463,1 / 21,82 [16,1–26,17] | 19.683,75 / 26,01 [25,19–26,46] | 34.731,64 / 14,74 [13,27–16,93] | 51.089,65 / 10,02 [9,55–10,24] | 107.569,8 / 4,76 [4,69–5,74] |
| 20d6!2ro=1kh10 # ação 🎲 · full | 38.115,23 / 13,43 [12,45–14,36] | 29.292,63 / 17,48 [15,04–19,01] | 11.990,13 / 42,7 [41,37–44,06] | 26.616,28 / 19,24 [17,2–21,98] | 40.325,76 / 12,7 [12,35–13,86] | 88.495,58 / 5,79 [5,33–5,93] |
| 100dF.2 · full | 18.414,58 / 27,8 [27,07–28,77] | 16.898,22 / 30,3 [27–32,93] | 5.217,57 / 98,13 [93,04–106,42] | 13.667,51 / 37,46 [33,66–41,51] | 14.143,92 / 36,2 [35,16–39,75] | 39.584,98 / 12,93 [12,36–13,36] |
| 50d6min2.125max4.875kh25 · full | 23.458,91 / 21,83 [21,2–22,3] | 20.379,69 / 25,12 [22,6–31,12] | 5.355,07 / 95,61 [91,4–100,9] | 10.955,28 / 46,74 [46,5–47,59] | 16.381,04 / 31,26 [30,91–31,4] | 36.389,22 / 14,07 [13,95–14,29] |

## Comparação das medianas

Valores maiores que 1 favorecem o numerador; diferenças próximas do ruído precisam de confirmação.

| Carga | Direct/std GC100 | Direct/std GC500/96MiB | Direct GC500/Node | Direct GC500/Bun |
|---|---:|---:|---:|---:|
| 1000d6 · full | 1,94× | 2,75× | 2,52× | 1,87× |
| 100d6ro=1kh60 · full | 2,3× | 2,16× | 2,33× | 1,79× |
| 2#{4d6,3d8+2}kh1 · full | 1,76× | 2,11× | 2,64× | 4,58× |
| 20d6!2ro=1kh10 # ação 🎲 · full | 2,22× | 2,19× | 2,32× | 3,02× |
| 100dF.2 · full | 2,62× | 2,8× | 2,15× | 2,34× |
| 50d6min2.125max4.875kh25 · full | 2,05× | 2,22× | 1,55× | 1,79× |

## Memória observada

Cada célula: **mediana / maior snapshot RSS em MiB**. Leituras após lotes, fora do timer, com workers e últimos resultados/JSON vivos. Incluem runtime e harness; cargas anteriores podem influenciar as seguintes. Não representam pico, teto ou memória isolada por expressão.

| Carga | Node | Bun | Go std · GC100 | Go direct · GC100 | Go std · GC500/96MiB | Go direct · GC500/96MiB |
|---|---:|---:|---:|---:|---:|---:|
| 1000d6 · full | 669,95 / 678,44 | 296,09 / 309,37 | 35,7 / 37,07 | 29,34 / 32,66 | 85,49 / 92,16 | 84,79 / 87,33 |
| 100d6ro=1kh60 · full | 653,27 / 664,35 | 311,31 / 321,02 | 16,86 / 22,99 | 15,98 / 16,5 | 72,36 / 79,34 | 69,57 / 77,22 |
| 2#{4d6,3d8+2}kh1 · full | 657,61 / 662,78 | 315,5 / 324,07 | 16,92 / 17,04 | 16,35 / 16,67 | 62,64 / 66,64 | 62,21 / 64,84 |
| 20d6!2ro=1kh10 # ação 🎲 · full | 658,2 / 663,61 | 337,23 / 341,39 | 17,06 / 17,45 | 16,98 / 17,88 | 56,55 / 61,4 | 57,17 / 60,22 |
| 100dF.2 · full | 658,63 / 662,41 | 333,52 / 342,65 | 17,03 / 17,25 | 17,06 / 17,52 | 57,34 / 72,56 | 47,56 / 53,3 |
| 50d6min2.125max4.875kh25 · full | 660,91 / 667,15 | 334,83 / 346,68 | 17,2 / 17,24 | 17,22 / 25,23 | 50,73 / 59,29 | 33,94 / 39,73 |

## Comprimento médio por resultado

Node/Bun: unidades UTF-16. Go: bytes UTF-8. Ver a ressalva de Unicode acima.

| Carga | Node | Bun | Go std · GC100 | Go direct · GC100 | Go std · GC500/96MiB | Go direct · GC500/96MiB |
|---|---:|---:|---:|---:|---:|---:|
| 1000d6 · full | 527.480 | 527.480 | 527.480 | 527.480 | 527.480 | 527.480 |
| 100d6ro=1kh60 · full | 56.918,54 | 56.918,54 | 56.918,54 | 56.918,54 | 56.918,54 | 56.918,54 |
| 2#{4d6,3d8+2}kh1 · full | 12.089,32 | 12.089,32 | 12.089,32 | 12.089,32 | 12.089,32 | 12.089,32 |
| 20d6!2ro=1kh10 # ação 🎲 · full | 15.310,56 | 15.310,56 | 15.318,56 | 15.318,56 | 15.318,56 | 15.318,56 |
| 100dF.2 · full | 53.456,78 | 53.456,78 | 53.456,78 | 53.456,78 | 53.456,78 | 53.456,78 |
| 50d6min2.125max4.875kh25 · full | 34.112,45 | 34.112,45 | 34.112,45 | 34.112,45 | 34.112,45 | 34.112,45 |

## Reprodução e evidência

```powershell
node scripts/compare-json-round5.mjs --go 'C:/Users/quira/.codex/visualizations/2026/07/21/019f8591-c4eb-7913-9683-054308852112/go-runtime-full/go/bin/go.exe' --baseline 'D:\Projetos\ERPG\rpg-dice-roller\.artifacts\optimization-round5\baseline.exe' --bun 'bun' --holdout
```

Requer Go, Node, Bun, dist já construído e executável de testes preservado do baseline. Teto total de 300 segundos incluindo compilação e preflight; duração observada: 28,92 segundos. Falhas preservam dados parciais. Main e holdout gravam arquivos separados; relatórios anteriores permanecem preservados. Máquina de trabalho compartilhada: JIT, GC, frequência de CPU e escalonamento afetam medições locais.

[Dados e manifestos](benchmarks/optimization-round5/json-round5-holdout.json) · [Preflight integral](benchmarks/optimization-round5/json-round5-holdout-preflight.json.gz) · [Orquestrador](../scripts/compare-json-round5.mjs) · [Rodada anterior](JSON_ROUND4_BENCHMARK.md).
