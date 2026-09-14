# Benchmark: Go, TypeScript no Node e TypeScript no Bun

Execução em 2026-09-14T01:22:43.329Z. Comparação de APIs locais da biblioteca v3.7.1, sem HTTP ou Discord. As 17 cargas originais foram preservadas. Em 6 cargas a mediana de Go foi menor que a do Node; consulte a dispersão antes de interpretar diferenças pequenas. Isso descreve estas cargas e esta máquina; não estima ganho do Fortuna em produção. O [baseline anterior às otimizações](benchmarks/baseline/README.md) executou TypeScript somente no Node; Bun é uma medição nova.

## Ambiente e versão

- CPU: AMD Ryzen 5 5500; 12 processadores lógicos.
- Sistema: Windows 11 Pro; x64.
- Memória instalada: 31,87 GiB.
- Runtimes: Node v24.18.0; Bun 1.4.0; go version go1.26.2 windows/amd64. Node e Bun executam o mesmo bundle TypeScript compilado.
- Commit-base: `62de50293b2e22121f8ae3832f303da973e24934`. Árvore com 31 entradas alteradas/não rastreadas; manifesto SHA-256 nos dados brutos.
- SHA-256 conjunto: `1da581931f69e0e8a0591d06119deccfd6350e5df3b6c8cbec31369dc9c0f944`. Conferido novamente ao terminar, sem alteração.
- Variáveis de runtime: `{"NODE_OPTIONS":null,"GOMAXPROCS":null,"GOGC":null,"GOMEMLIMIT":null}`.

## Método

O harness compilou o executável Go de teste e o bundle TypeScript antes das medições. O preflight comparou o JSON completo de 35 resultados entre os runtimes e passou para todas as cargas. Compilação, inicialização de processo, carregamento de módulos, preparação de engines e serialização do resultado ficaram fora dos cronômetros.

Foram 7 rodadas, produzindo uma amostra por runtime/carga em cada rodada. Cada runtime inicia um processo novo por rodada e percorre todas as cargas; cada carga tem aquecimento explícito seguido de um lote medido. O tamanho do lote é igual para Go e TypeScript na mesma carga, calibrado para aproximadamente 50 ms no runtime mais rápido, limitado a 500.000 operações. O aquecimento executa no mínimo 5000 e no máximo 20.000 chamadas, conforme o tamanho do lote.

Go, Node e Bun não executam medições simultâneas. A ordem entre runtimes e a ordem das cargas alternam entre rodadas. Coleta de lixo fica no funcionamento natural de cada runtime; não há GC forçada. O limite global de execução é cinco minutos. A implementação fica estável durante cada execução; as otimizações anteriores estão identificadas pelo manifesto.

As expressões, modos de resultado, limites padrão, algoritmo MT19937, políticas de cache e seeds são iguais. Todas as engines usam `freezeResults: 'never'`. A maioria das cargas usa seed fixa; a última alterna 16 seeds. Repetir uma seed pode favorecer caches de inicialização do gerador. Seeds únicas, lotes de milhares e concorrência são medidos separadamente em [BACKEND_BENCHMARK.md](BACKEND_BENCHMARK.md). Rolagens sem seed e obtenção de entropia não foram medidas.

## Resultados

Mediana e intervalo interquartil Q1–Q3 dos tempos médios de lote, em **ns/op**. A razão **TS/Go** maior que 1 favorece Go; menor que 1 favorece TypeScript. Ops/s é o inverso da mediana.

| Carga | Node [Q1–Q3], ns/op | Bun [Q1–Q3], ns/op | Go [Q1–Q3], ns/op | Node ops/s | Bun ops/s | Go ops/s | Node/Go | Bun/Go |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Normalização — ciclo de quatro entradas | 2.158 [2.064–2.289] | 2.265 [2.098–3.171] | 3.049 [3.016–3.248] | 463.471 | 441.487 | 327.969 | 0,71× | 0,74× |
| Compilar fórmula, cache desativado | 14.299 [13.623–18.376] | 24.424 [19.761–27.768] | 13.738 [13.247–14.395] | 69.933 | 40.943 | 72.790 | 1,04× | 1,78× |
| Compilar fórmula, cache aquecido | 434 [427–449] | 186 [174–193] | 390 [348–531] | 2.303.456 | 5.383.116 | 2.561.817 | 1,11× | 0,48× |
| 1d20+5 — full | 8.336 [8.165–8.397] | 8.463 [8.264–9.082] | 10.320 [9.889–10.888] | 119.961 | 118.160 | 96.895 | 0,81× | 0,82× |
| 100d6 — full | 53.627 [51.973–53.873] | 66.628 [64.042–67.418] | 124.389 [123.577–151.583] | 18.647 | 15.009 | 8.039 | 0,43× | 0,54× |
| 1d20+5 — details | 5.672 [5.352–5.765] | 6.319 [5.712–6.630] | 7.219 [6.797–7.663] | 176.307 | 158.255 | 138.526 | 0,79× | 0,88× |
| 100d6 — details | 26.374 [25.267–27.684] | 32.676 [30.632–34.780] | 34.664 [30.729–36.656] | 37.916 | 30.604 | 28.849 | 0,76× | 0,94× |
| 1d20+5 — summary | 4.634 [4.436–5.152] | 5.087 [4.460–5.299] | 5.080 [4.896–5.136] | 215.780 | 196.577 | 196.847 | 0,91× | 1,00× |
| 100d6 — summary | 12.823 [12.584–13.267] | 7.950 [7.309–8.161] | 7.230 [7.099–7.597] | 77.985 | 125.786 | 138.314 | 1,77× | 1,10× |
| Pool com explosão limitada — full | 22.136 [21.528–22.748] | 30.114 [29.065–31.725] | 44.801 [43.356–50.189] | 45.175 | 33.207 | 22.321 | 0,49× | 0,67× |
| Pool com explosão limitada — summary | 13.482 [11.729–14.203] | 15.894 [14.542–18.248] | 13.344 [12.994–14.634] | 74.174 | 62.917 | 74.941 | 1,01× | 1,19× |
| Fate, 20 dados — full | 16.298 [15.855–17.695] | 22.292 [21.606–22.485] | 40.131 [36.850–45.262] | 61.359 | 44.860 | 24.918 | 0,41× | 0,56× |
| V5, pool 10/fome 3 — full | 14.823 [12.499–15.890] | 17.706 [16.639–18.776] | 28.251 [26.321–30.547] | 67.463 | 56.477 | 35.397 | 0,52× | 0,63× |
| Fate, 20 dados — compact | 10.984 [10.576–12.845] | 13.910 [12.925–16.151] | 18.066 [17.001–20.091] | 91.039 | 71.888 | 55.352 | 0,61× | 0,77× |
| V5, pool 10/fome 3 — compact | 9.293 [8.854–10.423] | 13.639 [11.417–14.608] | 13.686 [12.747–15.031] | 107.610 | 73.318 | 73.069 | 0,68× | 1,00× |
| Misto, todos os sistemas — compact | 144.942 [139.110–149.487] | 239.925 [227.658–244.522] | 116.846 [104.436–123.943] | 6.899 | 4.168 | 8.558 | 1,24× | 2,05× |
| 1d20+5 — summary, 16 seeds alternadas | 16.935 [16.470–17.215] | 21.532 [21.002–21.615] | 4.979 [4.786–5.011] | 59.048 | 46.442 | 200.857 | 3,40× | 4,32× |

Q1–Q3 mostra dispersão entre lotes, não intervalo de confiança. Os lotes não medem latência individual de requisição; não há p95 de requisições nesta tabela. As amostras, durações, warmups e quantidades exatas por carga estão no JSON original.

O ganho mais claro de Go aparece em `1d20+5` summary com seeds alternadas: 4,98 µs/op, contra 16,94 µs no Node e 21,53 µs no Bun, equivalendo a 3,40× e 4,32× de throughput. O caso misto compact também favoreceu Go: 116,85 µs, contra 144,94 µs no Node e 239,92 µs no Bun. Em `100d6` summary, Go levou 7,23 µs, Node 12,82 µs e Bun 7,95 µs; a diferença pequena frente ao Bun deve ser lida junto dos quartis.

Os resultados full continuam sendo uma limitação. `100d6` full levou 124,39 µs em Go, contra 53,63 µs no Node e 66,63 µs no Bun; Fate full levou 40,13 µs, contra 16,30 µs e 22,29 µs. Go também ficou atrás em normalização e nas rolagens simples full/details com seed fixa. Bun foi o mais rápido na compilação com cache aquecido, com 0,186 µs contra 0,390 µs de Go e 0,434 µs do Node.

As medianas de compilação fria e pool summary frente ao Node, assim como `1d20+5` summary e V5 compact frente ao Bun, têm diferenças pequenas ou faixas Q1–Q3 sobrepostas. Elas não sustentam uma conclusão firme de vantagem. As melhorias frente à versão Go anterior estão na tabela abaixo; elas não significam que Go venceu todos os runtimes em todas as cargas.

## Gráficos

![Tempo médio por operação: medianas e intervalo interquartil de Go e TypeScript](benchmarks/latency.png)

![Razão TS/Go por carga: valores acima de 1 favorecem Go](benchmarks/speedup.png)

Versões vetoriais para exportar: [tempos por operação](benchmarks/latency.svg) e [razões TS/Go](benchmarks/speedup.svg). Os gráficos usam os mesmos dados da tabela.

## Go antes e depois

Mesmas 17 cargas e seed/mode/cache do baseline. Razão maior que 1 indica redução do tempo de Go nesta execução; as execuções aconteceram em horários diferentes.

| Carga | Go baseline, ns/op | Go atual, ns/op | Antes/depois |
|---|---:|---:|---:|
| Normalização — ciclo de quatro entradas | 3.152 | 3.049 | 1,03× |
| Compilar fórmula, cache desativado | 13.946 | 13.738 | 1,02× |
| Compilar fórmula, cache aquecido | 1.255 | 390 | 3,22× |
| 1d20+5 — full | 19.126 | 10.320 | 1,85× |
| 100d6 — full | 214.196 | 124.389 | 1,72× |
| 1d20+5 — details | 14.862 | 7.219 | 2,06× |
| 100d6 — details | 133.041 | 34.664 | 3,84× |
| 1d20+5 — summary | 10.954 | 5.080 | 2,16× |
| 100d6 — summary | 13.105 | 7.230 | 1,81× |
| Pool com explosão limitada — full | 75.088 | 44.801 | 1,68× |
| Pool com explosão limitada — summary | 41.445 | 13.344 | 3,11× |
| Fate, 20 dados — full | 60.584 | 40.131 | 1,51× |
| V5, pool 10/fome 3 — full | 42.317 | 28.251 | 1,50× |
| Fate, 20 dados — compact | 41.877 | 18.066 | 2,32× |
| V5, pool 10/fome 3 — compact | 30.426 | 13.686 | 2,22× |
| Misto, todos os sistemas — compact | 157.378 | 116.846 | 1,35× |
| 1d20+5 — summary, 16 seeds alternadas | 10.909 | 4.979 | 2,19× |

## Cargas

| ID | Operação | Entrada | Modo | Cache |
|---|---|---|---|---|
| normalize | normalize | Ciclo de quatro entradas no JSON | — | — |
| compile-cold | compile | `2#4d6kh3+1d8` | — | desativado |
| compile-hot | compile | `2#4d6kh3+1d8` | — | aquecido |
| d20-full | roll | `1d20+5` | full | aquecido |
| 100d6-full | roll | `100d6` | full | aquecido |
| d20-details | roll | `1d20+5` | details | aquecido |
| 100d6-details | roll | `100d6` | details | aquecido |
| d20-summary | roll | `1d20+5` | summary | aquecido |
| 100d6-summary | roll | `100d6` | summary | aquecido |
| pool-full | roll | `20d6!2ro=1kh10` | full | aquecido |
| pool-summary | roll | `20d6!2ro=1kh10` | summary | aquecido |
| fate-full | fate | `{"dice":20}` | full | aquecido |
| v5-full | vampire-v5 | `{"pool":10,"hunger":3,"difficulty":4}` | full | aquecido |
| fate-compact | fate | `{"dice":20}` | compact | aquecido |
| v5-compact | vampire-v5 | `{"pool":10,"hunger":3,"difficulty":4}` | compact | aquecido |
| mixed-compact | mixed | `2d20kh1; fate(4); v5(7,3,4); assim(d6=2,d10=1,d12=1,keep=1); dh(2,15)` | compact | aquecido |
| d20-changing-seed | roll | `1d20+5` | summary | aquecido |

Cada operação de normalização processa uma única entrada; os lotes percorrem as quatro entradas em ciclo. No caso de compilação sem cache, a engine é criada antes de cronometrar e cada operação refaz o trabalho de análise/compilação. No caso aquecido, cada operação chama a API pública de compilação; Go também entrega a cópia de plano exigida por seu contrato de propriedade. Rolagens usam entradas textuais com cache aquecido, não um atalho interno de executor.

## Reprodução e dados originais

A partir da raiz do repositório, com Node 24.18.0, Bun 1.4.0 disponível no PATH, Go 1.26.2 e as dependências npm instaladas:

```powershell
node scripts/compare-go-typescript.mjs --go 'C:\Users\quira\.codex\visualizations\2026\07\21\019f8591-c4eb-7913-9683-054308852112\go-runtime-full\go\bin\go.exe' --bun 'bun'
```

Para verificar o harness rapidamente, acrescente `--quick`; esse modo grava dados separados e não substitui este relatório. `--preflight-only` executa somente a verificação de resultados, após os builds.

- [Medições, metadados e manifesto](benchmarks/comparison-final.json).
- [JSON integral dos resultados usados no preflight](benchmarks/preflight-final.json).
- [Orquestrador](../scripts/compare-go-typescript.mjs), [worker TypeScript](../scripts/benchmark-go-reference.mjs) e [worker Go](benchmark_test.go).

Os modos de desenvolvimento gravam seus dados em `.artifacts/benchmark-calibration/`, preservando as medições finais.

Para regenerar os gráficos sem repetir as medições, use Python com `matplotlib` instalado:

```powershell
python scripts/plot-go-benchmark.py
```

O [script dos gráficos](../scripts/plot-go-benchmark.py) lê os dados finais preservados no repositório.

## Limitações

É um microbenchmark de biblioteca em uma máquina Windows compartilhada com aplicações de desenvolvimento. JIT, GC, frequência da CPU e processos externos podem influenciar as amostras. O experimento mede as implementações atuais, incluindo seus custos de validação, alocação e propriedade de dados; não isola o efeito da linguagem. Comparações próximas de 1× exigem atenção à dispersão e nova repetição em ambiente controlado.

Neste experimento sequencial não há medição comparável de memória: Go B/op e crescimento de heap JavaScript têm definições diferentes, e nenhum deles foi tratado como equivalência. O [experimento de backend](BACKEND_BENCHMARK.md) acrescenta snapshots RSS do processo completo, usando a mesma unidade nos três runtimes. O preflight demonstra igualdade destas cargas; a conformidade completa pertence à suíte de testes da migração.
