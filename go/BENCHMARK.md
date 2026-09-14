# Benchmark: biblioteca Go × TypeScript

Execução em 2026-09-14T00:34:23.958Z. Comparação de APIs locais da biblioteca v3.7.1, sem HTTP ou Discord. TypeScript apresentou menor mediana em 15 das 17 cargas. A compilação sem cache praticamente empatou; Go foi 1,60× mais rápido no resumo com 16 seeds alternadas. Esta versão Go ainda não apresenta ganho geral de velocidade nas cargas medidas. Os resultados descrevem estas implementações e esta máquina, sem estimar o ganho do Fortuna em produção.

## Ambiente e versão

- CPU: AMD Ryzen 5 5500; 12 processadores lógicos.
- Sistema: Windows 11 Pro; x64.
- Memória instalada: 31,87 GiB.
- Runtimes: TypeScript compilado executado no Node v24.18.0; go version go1.26.2 windows/amd64.
- Commit-base: `79c34f98fe512d8cd0d9d42c53dc587e6907a580`. A árvore continha 68 entradas alteradas/não rastreadas; o manifesto SHA-256 dos arquivos medidos está nos dados brutos.
- SHA-256 conjunto: `032cb389a7e29b579a6855ef360081338950cfec8dd556751de3a019665c7697`. Conferido novamente ao terminar, sem alteração.
- Variáveis de runtime: `{"NODE_OPTIONS":null,"GOMAXPROCS":null,"GOGC":null,"GOMEMLIMIT":null}`.

## Método

O harness compilou o executável Go de teste e o bundle TypeScript antes das medições. O preflight comparou o JSON completo de 35 resultados entre os runtimes e passou para todas as cargas. Compilação, inicialização de processo, carregamento de módulos, preparação de engines e serialização do resultado ficaram fora dos cronômetros.

Foram 7 rodadas, produzindo uma amostra por runtime/carga em cada rodada. Cada runtime inicia um processo novo por rodada e percorre todas as cargas; cada carga tem aquecimento explícito seguido de um lote medido. O tamanho do lote é igual para Go e TypeScript na mesma carga, calibrado para aproximadamente 50 ms no runtime mais rápido, limitado a 500.000 operações. O aquecimento executa no mínimo 5000 e no máximo 20.000 chamadas, conforme o tamanho do lote.

Go e TypeScript nunca rodam simultaneamente neste harness. A ordem entre runtimes e a ordem das cargas alternam entre rodadas. Coleta de lixo fica no funcionamento natural de cada runtime; não há GC forçada. O limite global de execução é dez minutos. Nenhuma implementação foi otimizada durante este experimento.

As expressões, modos de resultado, limites padrão, algoritmo MT19937, políticas de cache e seeds são iguais. Ambas as engines usam `freezeResults: 'never'`, excluindo o congelamento recursivo opcional dos resultados. A maioria das cargas usa uma seed fixa; a última alterna 16 seeds. Essa distinção importa: o TypeScript mantém um pequeno cache da inicialização MT para a última seed. Rolagens sem seed, custo de obtenção de entropia e cargas paralelas não foram medidos.

## Resultados

Mediana e intervalo interquartil Q1–Q3 dos tempos médios de lote, em **ns/op**. A razão **TS/Go** maior que 1 favorece Go; menor que 1 favorece TypeScript. Ops/s é o inverso da mediana.

| Carga | TS mediana [Q1–Q3], ns/op | Go mediana [Q1–Q3], ns/op | TS ops/s | Go ops/s | TS/Go |
|---|---:|---:|---:|---:|---:|
| Normalização — ciclo de quatro entradas | 2.426 [2.054–2.620] | 3.152 [3.073–3.382] | 412.184 | 317.278 | 0,77× |
| Compilar fórmula, cache desativado | 13.992 [13.631–20.910] | 13.946 [13.008–14.270] | 71.471 | 71.703 | 1,00× |
| Compilar fórmula, cache aquecido | 408 [403–414] | 1.255 [1.208–1.484] | 2.452.448 | 796.602 | 0,32× |
| 1d20+5 — full | 7.369 [6.706–7.590] | 19.126 [18.740–19.566] | 135.704 | 52.284 | 0,39× |
| 100d6 — full | 50.365 [49.843–51.635] | 214.196 [204.366–220.133] | 19.855 | 4.669 | 0,24× |
| 1d20+5 — details | 5.312 [5.279–5.527] | 14.862 [13.640–15.250] | 188.244 | 67.288 | 0,36× |
| 100d6 — details | 24.601 [24.306–24.903] | 133.041 [123.228–139.626] | 40.648 | 7.516 | 0,18× |
| 1d20+5 — summary | 4.554 [4.293–5.072] | 10.954 [10.722–11.607] | 219.606 | 91.295 | 0,42× |
| 100d6 — summary | 12.113 [11.830–12.257] | 13.105 [12.959–13.623] | 82.554 | 76.307 | 0,92× |
| Pool com explosão limitada — full | 20.958 [19.996–21.426] | 75.088 [73.413–78.724] | 47.715 | 13.318 | 0,28× |
| Pool com explosão limitada — summary | 11.899 [11.686–12.571] | 41.445 [38.775–43.164] | 84.043 | 24.129 | 0,29× |
| Fate, 20 dados — full | 15.443 [15.422–15.958] | 60.584 [54.759–61.900] | 64.754 | 16.506 | 0,25× |
| V5, pool 10/fome 3 — full | 12.837 [12.401–12.980] | 42.317 [41.237–43.208] | 77.897 | 23.631 | 0,30× |
| Fate, 20 dados — compact | 10.383 [10.036–10.500] | 41.877 [40.599–42.336] | 96.308 | 23.880 | 0,25× |
| V5, pool 10/fome 3 — compact | 8.805 [8.662–9.012] | 30.426 [30.153–31.586] | 113.576 | 32.866 | 0,29× |
| Misto, todos os sistemas — compact | 131.037 [129.077–134.550] | 157.378 [151.795–158.466] | 7.631 | 6.354 | 0,83× |
| 1d20+5 — summary, 16 seeds alternadas | 17.453 [16.424–18.474] | 10.909 [10.254–11.327] | 57.297 | 91.670 | 1,60× |

Q1–Q3 mostra dispersão entre lotes, não intervalo de confiança. Os lotes não medem latência individual de requisição; não há p95 de requisições nesta tabela. As amostras, durações, warmups e quantidades exatas por carga estão no JSON original.

Na compilação sem cache, a diferença entre medianas foi de apenas 0,32%, com sobreposição dos intervalos interquartis; este resultado não sustenta uma vantagem de desempenho. Entre as rolagens, `1d20+5` em modo full levou 7,37 µs em TypeScript e 19,13 µs em Go. Em `100d6` com details, foram 24,60 µs e 133,04 µs. A troca de seed alterou a comparação do resumo de `1d20+5`: com seed fixa, TypeScript foi mais rápido; alternando 16 seeds, Go foi mais rápido. O cache da última seed MT em TypeScript é uma diferença conhecida das implementações, mas o experimento não isolou a contribuição de cada etapa para o tempo total.

## Gráficos

![Tempo médio por operação: medianas e intervalo interquartil de Go e TypeScript](benchmarks/latency.png)

![Razão TS/Go por carga: valores acima de 1 favorecem Go](benchmarks/speedup.png)

Versões vetoriais para exportar: [tempos por operação](benchmarks/latency.svg) e [razões TS/Go](benchmarks/speedup.svg). Os gráficos usam os mesmos dados da tabela.

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

A partir da raiz do repositório, com Node 24.18.0, Go 1.26.2 e as dependências npm instaladas:

```powershell
node scripts/compare-go-typescript.mjs --go 'C:\Users\quira\.codex\visualizations\2026\07\21\019f8591-c4eb-7913-9683-054308852112\go-runtime-full\go\bin\go.exe'
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

Não há medição comparável de memória: Go B/op e crescimento de heap JavaScript têm definições diferentes, e nenhum deles foi tratado como equivalência. O preflight demonstra igualdade destas cargas; a conformidade completa pertence à suíte de testes da migração.
