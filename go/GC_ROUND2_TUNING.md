# Segunda rodada: configuração de GC para o backend

A extensão confirmou **GOGC=500 e GOMEMLIMIT=96MiB**. O maior snapshot RSS entre as nove cargas foi 78,44 MiB. No alvo 100d6/full, a confirmação produziu 73.606,1 operações/s contra 31.320,96 do controle fresco, razão 2,35×. A configuração padrão e a tentativa sem cap reprovada permanecem integralmente publicadas.

## Experimento inicial, sem GOMEMLIMIT

Nenhuma configuração alternativa ficou confirmada pelos critérios deste experimento. GOGC=500 foi escolhido na seleção, mas a confirmação não sustentou todos os critérios.

## Método

Mesmos binário Go, expressões, MT19937, seeds únicas, limites e modo de resultado do [benchmark padrão](BACKEND_ROUND2_BENCHMARK.md). Uma engine por worker, seis workers, 5 lotes de 10000 chamadas por carga e aquecimento de 5000 chamadas por worker. Nenhuma configuração GC é definida dentro da biblioteca.

A seleção executa um controle fresco GOGC=100 e depois 200/500/1000. Entre as alternativas cujo **maior snapshot após lotes é ≤128 MiB em todas as nove cargas**, escolhe a maior mediana de throughput de 100d6/full. Se superar o controle, repete a candidata e depois GOGC=100, em ordem reversa. A confirmação exige superar o novo controle no alvo e manter o teto nas nove cargas. Esse teto é um critério experimental de snapshots; não é GOMEMLIMIT nem garantia de pico de RSS.

GOMAXPROCS herdado: padrão; GOMEMLIMIT: não definido. AMD Ryzen 5 5500 · Windows 11 Pro · go version go1.26.2 windows/amd64. Binário SHA-256: `c3cb043275cdbbff37906ff0a4e94d6479deaad1ab6d49f4b1580940ada8b431`. Duração do experimento: 33,04 s, orçamento próprio 180 s dentro do saldo reservado para backend e GC.

## Seleção: quatro configurações

Cada célula: **operações/s / RSS mediano MiB / maior snapshot RSS MiB**. Todas as cargas são publicadas, inclusive as que excederam o teto ou perderam throughput.

| Carga | GOGC=100 | GOGC=200 | GOGC=500 | GOGC=1000 |
|---|---:|---:|---:|---:|
| 1d20+5 · full | 272.352,66 / 17,87 / 18,32 | 380.410,39 / 22,08 / 23,29 | 521.490,63 / 33,62 / 35,23 | 534.556,4 / 69,34 / 69,8 |
| 1d20+5 · details | 358.685,2 / 17,6 / 19,25 | 320.825,42 / 21,7 / 42,93 | 621.137,3 / 35,06 / 41,1 | 633.504,8 / 97,42 / 98,72 |
| 1d20+5 · summary | 520.947,29 / 18,76 / 19,57 | 632.687,15 / 35 / 45,32 | 830.482,01 / 33,74 / 35,91 | 976.781,89 / 93,57 / 94,43 |
| 100d6 · full | 31.939,37 / 17,77 / 18,23 | 45.149,83 / 27,94 / 31,74 | 80.272,28 / 93,14 / 127,31 | 87.789,92 / 517,75 / 543,55 **>128** |
| 100d6 · details | 52.440,39 / 17,59 / 18,25 | 67.887,51 / 25,9 / 40,64 | 126.677,69 / 69,39 / 109,2 | 149.027,52 / 458,72 / 470,14 **>128** |
| 100d6 · summary | 297.984,43 / 18,72 / 19,39 | 400.909,26 / 23,02 / 26,05 | 643.840,38 / 56,04 / 59,35 | 543.770,83 / 438,91 / 440,16 **>128** |
| 20d6!2ro=1kh10 · full | 41.187,99 / 18,11 / 18,34 | 69.066,93 / 29,54 / 34,27 | 114.407,31 / 73,36 / 100,48 | 148.445,04 / 400,01 / 414,73 **>128** |
| 20d6!2ro=1kh10 · details | 89.310,91 / 18,32 / 19,42 | 148.637,22 / 23,29 / 23,82 | 209.029,23 / 38,31 / 41,64 | 245.407,81 / 367,23 / 371,83 **>128** |
| 20d6!2ro=1kh10 · summary | 342.075,65 / 19,71 / 20,2 | 433.127,31 / 24,1 / 24,74 | 528.722,87 / 36,84 / 37,75 | 555.682,13 / 356,26 / 358,45 **>128** |

## Confirmação em ordem reversa

A candidata é executada primeiro; o controle 100 vem depois. A razão compara as medianas de throughput desta etapa, não com controles de outro experimento.

| Carga | Controle fresco100: ops/s / RSS med. / maior | Candidata GOGC=500: ops/s / RSS med. / maior | Candidata/controle |
|---|---:|---:|---:|
| 1d20+5 · full | 248.269,56 / 17,38 / 17,66 | 497.386,24 / 39,35 / 43,79 | 2× |
| 1d20+5 · details | 317.814,45 / 17,67 / 18,53 | 484.726,28 / 37,73 / 42,72 | 1,53× |
| 1d20+5 · summary | 521.178,07 / 19,05 / 19,13 | 697.481,39 / 45,03 / 46,31 | 1,34× |
| 100d6 · full | 28.167,55 / 17,75 / 18,54 | 74.590,07 / 92,13 / 121,83 | 2,65× |
| 100d6 · details | 53.213,06 / 18,49 / 19,64 | 110.796,2 / 57,59 / 104,88 | 2,08× |
| 100d6 · summary | 287.229,21 / 18,46 / 19,29 | 467.923,82 / 76,16 / 100,86 | 1,63× |
| 20d6!2ro=1kh10 · full | 43.043,1 / 17,96 / 18,1 | 112.966,65 / 195,42 / 226,48 **>128** | 2,62× |
| 20d6!2ro=1kh10 · details | 93.949,2 / 19,16 / 27,8 | 192.385,02 / 119,66 / 135,66 **>128** | 2,05× |
| 20d6!2ro=1kh10 · summary | 343.876,59 / 19,95 / 20,27 | 526.770,48 / 108,14 / 112,94 | 1,53× |

Nesta confirmação, a candidata teve mediana de throughput maior ou igual à do controle nas nove cargas. Isso descreve esta execução; não garante ganho em outras cargas ou máquinas.

## Extensão explícita: GOGC=500 com limite suave de memória

Após a reprovação de GOGC=500 sem cap por RSS, foi autorizada uma extensão limitada a duas candidatas: GOGC=500/GOMEMLIMIT=64MiB e GOGC=500/GOMEMLIMIT=96MiB. Um controle fresco100 sem cap veio antes da seleção; depois a candidata escolhida e outro controle 100 foram executados nessa ordem. Mesmos binário, nove cargas, seeds, lotes, aquecimento e contadores. Orçamento adicional de 90 s; duração de 26,48 s.

**GOMEMLIMIT é um limite suave para memória gerida pelo runtime Go, não um limite de RSS do processo.** O critério continuou sendo maior snapshot RSS ≤128 MiB em cada uma das nove cargas e maior throughput de 100d6/full. A extensão não apaga nem reclassifica a tentativa anterior sem cap.

A extensão confirmou **GOGC=500 e GOMEMLIMIT=96MiB**. O maior snapshot RSS entre as nove cargas foi 78,44 MiB. No alvo 100d6/full, a confirmação produziu 73.606,1 operações/s contra 31.320,96 do controle fresco, razão 2,35×. A configuração padrão e a tentativa sem cap reprovada permanecem integralmente publicadas.

Seleção; cada célula: operações/s / RSS mediano MiB / maior snapshot MiB.

| Carga | Controle 100 sem cap | GOGC=500 /64MiB | GOGC=500 /96MiB |
|---|---:|---:|---:|
| 1d20+5 · full | 289.823,99 / 17,4 / 17,88 | 357.838,09 / 59,03 / 64,66 | 489.208,07 / 56,97 / 63,21 |
| 1d20+5 · details | 380.607,3 / 17,57 / 18,43 | 613.952,69 / 39,22 / 44,59 | 567.988,19 / 36,9 / 42,32 |
| 1d20+5 · summary | 576.791,08 / 18,92 / 18,96 | 918.982,5 / 34,67 / 35,44 | 895.495,66 / 34,66 / 34,93 |
| 100d6 · full | 29.973,86 / 18,17 / 18,39 | 77.068,44 / 45 / 46,07 | 80.452,14 / 65,26 / 83,81 |
| 100d6 · details | 50.089,16 / 18,27 / 19,42 | 145.825,31 / 40,16 / 49,95 | 135.708,6 / 38,54 / 42,66 |
| 100d6 · summary | 257.700,08 / 18,75 / 18,85 | 609.336,25 / 40,32 / 43,13 | 518.097,13 / 36,21 / 37,93 |
| 20d6!2ro=1kh10 · full | 44.306,41 / 17,64 / 18,32 | 144.678,02 / 41,06 / 49,13 | 132.938,24 / 42,63 / 52,71 |
| 20d6!2ro=1kh10 · details | 83.814,08 / 18,5 / 18,99 | 239.275,09 / 36 / 50,01 | 215.947,27 / 37,44 / 45,11 |
| 20d6!2ro=1kh10 · summary | 277.494,89 / 19,44 / 19,95 | 558.743,5 / 36,51 / 36,69 | 526.809,33 / 51,98 / 54,58 |

Confirmação reversa: candidata primeiro e controle fresco depois.

| Carga | Controle 100 sem cap | Candidata confirmada | Candidata/controle |
|---|---:|---:|---:|
| 1d20+5 · full | 275.214,46 / 17,34 / 17,8 | 457.406,32 / 69,46 / 76,77 | 1,66× |
| 1d20+5 · details | 366.566,23 / 17,68 / 18,28 | 545.440,66 / 74,18 / 77,65 | 1,49× |
| 1d20+5 · summary | 519.232,37 / 19,11 / 20,42 | 817.293,94 / 59,02 / 62,83 | 1,57× |
| 100d6 · full | 31.320,96 / 17,52 / 18,02 | 73.606,1 / 51,48 / 74,49 | 2,35× |
| 100d6 · details | 48.153,6 / 18,74 / 18,76 | 137.037,17 / 61,6 / 78,44 | 2,85× |
| 100d6 · summary | 236.927,52 / 18,48 / 18,78 | 444.774,57 / 54,36 / 76,82 | 1,88× |
| 20d6!2ro=1kh10 · full | 41.059,28 / 17,56 / 18,18 | 143.424,69 / 42,72 / 50,72 | 3,49× |
| 20d6!2ro=1kh10 · details | 102.644,74 / 18,67 / 19,13 | 233.201,89 / 36,15 / 43,86 | 2,27× |
| 20d6!2ro=1kh10 · summary | 293.237,07 / 19,21 / 20,66 | 545.280,06 / 36,8 / 37,46 | 1,86× |

A candidata teve mediana de throughput maior ou igual ao controle fresco nas nove cargas nesta confirmação.

[Dados integrais da extensão](benchmarks/gc-round2-memory-cap.json) · [Orquestrador da extensão](../scripts/compare-go-gc-memory-cap.mjs). Para reproduzir a extensão após o experimento inicial, execute `node scripts/compare-go-gc-memory-cap.mjs`; depois gere este relatório e os gráficos.

## Leitura e limitações

RSS é medido após os lotes, fora do cronômetro, com os workers e suas referências vivos. Inclui runtime e harness. O processo percorre cargas em sequência; memória retida ou reservada por cargas anteriores pode influenciar snapshots posteriores. O maior snapshot não é o pico entre medições, e RSS pode variar de forma não monotônica ao aumentar GOGC. Throughput é calculado pela mediana da duração dos lotes; não é latência individual nem capacidade de um servidor HTTP.

Os [gráficos do backend](BACKEND_ROUND2_BENCHMARK.md#gráficos) mantêm Node/Bun/Go padrão e só acrescentam a configuração Go confirmada, identificando essa medição separada. A [primeira rodada de GC](benchmarks/round2-baseline/go/GC_TUNING.md) e todos os seus dados continuam preservados.

## Reprodução e evidência

Execute primeiro scripts/compare-backend-round2.mjs para construir e medir o binário de referência. Em seguida, com fontes e binário inalterados:

```powershell
$env:DICECORE_GC_BUDGET_MS = '180000' # ou o saldo restante dos cinco minutos reservados
node scripts/compare-go-gc-round2.mjs
node scripts/compare-go-gc-memory-cap.mjs
node scripts/report-go-gc-round2.mjs
python scripts/plot-backend-round2.py
```

O orquestrador verifica o hash do binário e de todas as fontes medidas, além dos contadores de entrega de cada lote. Os gráficos requerem matplotlib==3.10.8. [JSON integral, configurações, comandos e lotes](benchmarks/gc-round2-tuning.json) · [Orquestrador](../scripts/compare-go-gc-round2.mjs).
