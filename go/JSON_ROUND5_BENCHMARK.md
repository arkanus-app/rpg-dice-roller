# Rodada 5: API full + encoder JSON direto

Comparação da mesma API de rolagem seguida por JSON.stringify em Node/Bun, encoding/json.Marshal no controle Go std e dicecore.MarshalJSON em Go direct. Go direct teve a maior vazão calculada pela mediana dos lotes em **1/3 cargas com GC100** e **3/3 com GC500/96MiB**, comparado aos dois runtimes JavaScript. O uso de dicecore.MarshalJSON é explícito; os tipos e chamadas de rolagem permanecem os mesmos. Essas contagens descrevem esta amostra; não são um teste de significância ou uma garantia de capacidade HTTP.

Este ensaio principal preserva as três expressões das rodadas anteriores. [O holdout](JSON_ROUND5_HOLDOUT.md) usa expressões adicionais em uma execução separada.

## Ambiente e origem

AMD Ryzen 5 5500 · Windows 11 Pro · 12 CPUs lógicas. Node v24.18.0, Bun 1.4.0, go version go1.26.2 windows/amd64. Árvore atual sobre `cecb59b20b689b43b86b98268a8d20bcbdab70cf`, 11 entradas modificadas. Manifesto estável: `d8a65498e5e6dbdd5f44785ccdc1fe83e7cd1f393c7a7045bd2a74700f34c88b`.

As quatro séries Go usam o mesmo executável atual, SHA-256 `a1d7a56eb7cf300fb0bd722316d6f229d58c0bf4e6a34e008e73d79bc9fc2b7b`. A variável entre std/direct é somente o encoder selecionado. O binário preservado do commit `cecb59b20b689b43b86b98268a8d20bcbdab70cf` (`cecb59b`), SHA-256 `68f1a39b70c5f51f06d7225a7e7ff18d87f7f672cfa9ddd563c7915390ab2604`, é usado exclusivamente como controle adicional de preflight com o worker original; seu tempo não aparece nas séries. A origem declarada desse binário não é provada pelo script; hashes e build info permitem auditoria. Workers originais e leitores de RSS são comparados ao commit-base. O novo worker possui hash próprio no manifesto. O dist TypeScript existente é usado sem rebuild e é incluído no manifesto.

## Método

Seis workers de aplicação, uma engine por worker, MT19937, limites padrão, cache aquecido e freezeResults='never'. Seeds distintas entre chamadas de um lote: `dicecore-backend/v3.7.1/` + índice, repetidas em cada lote e configuração. Todos os processos Go usam GOMAXPROCS=12. GOGC=100 remove o GOMEMLIMIT herdado; GOGC=500 aplica GOMEMLIMIT=96MiB. Essa configuração foi reutilizada sem nova seleção; o limite é flexível e não limita rigidamente o RSS.

Cada processo aquece 1000 chamadas por worker por expressão e mede 3 lotes de 5000 chamadas. Duas rodadas em processos novos, com ordem invertida, totalizam seis lotes por série/carga. Ordem inicial: node → bun → go-std-default → go-direct-default → go-std-tuned → go-direct-tuned. Ordem final: go-direct-tuned → go-std-tuned → go-direct-default → go-std-default → bun → node. Ordem das cargas: 1d20+5 → 100d6 → 20d6!2ro=1kh10. Todos os processos de medição deste script são seriais. Startup, imports, compilação, criação de options e aquecimento ficam fora do timer.

O worker Go escolhe uma função do tipo func(any) ([]byte, error) antes dos timers. Std e direct executam o mesmo loop, cada chamada construindo um *DiceRollResult completo e serializando-o. O experimento usa MarshalJSON, sem buffer fornecido pelo benchmark nem AppendJSON. Inclui despacho, construção do resultado, serialização e conclusão dos workers. Não inclui HTTP, rede ou conversão adicional da string JavaScript para Buffer UTF-8.

## Paridade

Preflight com índices 0, 1, 5, 127, 511, 4999: 18 resultados em cada uma das seis séries e no controle original. O novo worker compara integralmente os bytes do encoder escolhido com encoding/json.Marshal do mesmo resultado, fora do timer. O orquestrador também exige os mesmos bytes em todos os casos Go, incluindo o controle original, e igualdade integral do JSON decodificado frente a Node/Bun, sem tolerância numérica. Em todos os lotes, contagem, totais, soma ponderada e chamadas aleatórias devem coincidir. O comprimento é estável por série e idêntico entre todos os encoders Go. Esses contadores não substituem a suíte de conformidade.

Comprimentos: Go mede bytes UTF-8; Node/Bun medem string.length, em unidades UTF-16. O corpus principal é ASCII, confirmado no preflight, portanto os comprimentos são comparáveis. Não é feita conversão UTF-8 no trecho cronometrado do JavaScript.

## Vazão e dispersão

Cada célula: **operações/s / mediana do lote em ms [Q1–Q3]**. Quartis calculados sobre seis lotes; não são p95 de chamadas individuais.

| Carga | Node | Bun | Go std · GC100 | Go direct · GC100 | Go std · GC500/96MiB | Go direct · GC500/96MiB |
|---|---:|---:|---:|---:|---:|---:|
| 1d20+5 · full | 122.809,24 / 40,71 [37,98–94,31] | 114.513,3 / 43,66 [40,8–46,71] | 99.725,56 / 50,14 [48,9–50,55] | 151.641,29 / 32,97 [32,57–35,95] | 216.262,51 / 23,12 [22,41–25,32] | 300.633,43 / 16,63 [15,31–17,9] |
| 100d6 · full | 21.330,81 / 234,4 [224,55–264,74] | 23.850,36 / 209,64 [205,39–209,72] | 6.735,25 / 742,36 [722,12–756,77] | 15.890,88 / 314,65 [311,5–317,62] | 12.271,26 / 407,46 [375,98–477,9] | 36.524,42 / 136,89 [131,62–147,65] |
| 20d6!2ro=1kh10 · full | 45.727,39 / 109,34 [106,38–118,16] | 42.466,9 / 117,74 [115,75–118,89] | 11.668,67 / 428,5 [405,98–429,51] | 27.766,66 / 180,07 [179,51–198,23] | 39.718,9 / 125,88 [118,57–145,48] | 70.084,75 / 71,34 [67,79–76,99] |

## Comparação das medianas

Valores maiores que 1 favorecem o numerador; diferenças próximas do ruído precisam de confirmação.

| Carga | Direct/std GC100 | Direct/std GC500/96MiB | Direct GC500/Node | Direct GC500/Bun |
|---|---:|---:|---:|---:|
| 1d20+5 · full | 1,52× | 1,39× | 2,45× | 2,63× |
| 100d6 · full | 2,36× | 2,98× | 1,71× | 1,53× |
| 20d6!2ro=1kh10 · full | 2,38× | 1,76× | 1,53× | 1,65× |

## Memória observada

Cada célula: **mediana / maior snapshot RSS em MiB**. Leituras após lotes, fora do timer, com workers e últimos resultados/JSON vivos. Incluem runtime e harness; cargas anteriores podem influenciar as seguintes. Não representam pico, teto ou memória isolada por expressão.

| Carga | Node | Bun | Go std · GC100 | Go direct · GC100 | Go std · GC500/96MiB | Go direct · GC500/96MiB |
|---|---:|---:|---:|---:|---:|---:|
| 1d20+5 · full | 245,33 / 246,21 | 165,41 / 167,9 | 15,97 / 16,3 | 15,53 / 16,65 | 32,43 / 32,94 | 32,13 / 34,18 |
| 100d6 · full | 335,85 / 378,36 | 273,92 / 287,21 | 34,43 / 53,83 | 16,89 / 17,2 | 38,46 / 74,06 | 42,56 / 83,95 |
| 20d6!2ro=1kh10 · full | 454,57 / 470,39 | 262,32 / 264,81 | 34,99 / 53,69 | 16,8 / 17,22 | 45,11 / 74,09 | 68,14 / 79,21 |

## Comprimento médio por resultado

Node/Bun: unidades UTF-16. Go: bytes UTF-8. Ver a ressalva de Unicode acima.

| Carga | Node | Bun | Go std · GC100 | Go direct · GC100 | Go std · GC500/96MiB | Go direct · GC500/96MiB |
|---|---:|---:|---:|---:|---:|---:|
| 1d20+5 · full | 2.381,22 | 2.381,22 | 2.381,22 | 2.381,22 | 2.381,22 | 2.381,22 |
| 100d6 · full | 53.055 | 53.055 | 53.055 | 53.055 | 53.055 | 53.055 |
| 20d6!2ro=1kh10 · full | 15.336,98 | 15.336,98 | 15.336,98 | 15.336,98 | 15.336,98 | 15.336,98 |

## Reprodução e evidência

```powershell
node scripts/compare-json-round5.mjs --go 'C:/Users/quira/.codex/visualizations/2026/07/21/019f8591-c4eb-7913-9683-054308852112/go-runtime-full/go/bin/go.exe' --baseline 'D:\Projetos\ERPG\rpg-dice-roller\.artifacts\optimization-round5\baseline.exe' --bun 'bun'
```

Requer Go, Node, Bun, dist já construído e executável de testes preservado do baseline. Teto total de 300 segundos incluindo compilação e preflight; duração observada: 33,56 segundos. Falhas preservam dados parciais. Main e holdout gravam arquivos separados; relatórios anteriores permanecem preservados. Máquina de trabalho compartilhada: JIT, GC, frequência de CPU e escalonamento afetam medições locais.

[Dados e manifestos](benchmarks/optimization-round5/json-round5.json) · [Preflight integral](benchmarks/optimization-round5/json-round5-preflight.json.gz) · [Orquestrador](../scripts/compare-json-round5.mjs) · [Rodada anterior](JSON_ROUND4_BENCHMARK.md).
