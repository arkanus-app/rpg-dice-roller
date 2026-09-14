# Otimização isolada do executor Go

Cinco hipóteses foram avaliadas; H1 e H4 tiveram refinamentos. A candidata promovida contém H1b, H2, H3, H4b e H5. A arena geral H4 foi descartada por reservar memória para uma cauda de explosões cujo tamanho não é conhecido.

## Escopo e controle

Os binários usam o mesmo snapshot do pacote Go em `workspace/`. Somente `executor.go` e `journal.go` foram substituídos entre as variantes. As otimizações paralelas de RNG, seed, replay, matemática e cache não entraram neste confronto isolado. `source-manifest.json` registra os hashes do snapshot inicial; `baseline-sources/` preserva os três arquivos do executor antes das alterações. As cópias `v*-executor.go.txt` e `v3-journal.go.txt` preservam os candidatos intermediários.

Ambiente medido: Windows/amd64, Go 1.26.2, AMD Ryzen 5 5500; saída do benchmark informa 12 CPUs. O benchmark chama a API pública com engine e plano aquecidos fora da medição. Cada resultado escapa pelo mesmo sink. As cargas incluem uma expressão simples, 100 dados e um pool com explosão, reroll e keep-highest, nas três projeções. A primeira fase usa seed fixa; a confirmação usa tanto seed fixa quanto um ciclo de 128 seeds. Não houve outra medição de performance em paralelo.

Estes são microbenchmarks locais. As medianas não são p95 nem medições de servidor, e três/cinco amostras não fundamentam uma afirmação geral sobre toda carga possível. O benchmark integrado posterior mede a combinação dos agentes.

## Hipóteses e decisões

1. **H1 — eventos nas projeções.** `details` e o resumo geral precisam preservar contadores e limites de eventos, mas não retornam os mapas de evento. Manter `Journal.Record(nil)` na mesma posição evita montar metadados desnecessários. O refinamento H1b move também a decisão para os dois chamadores mais frequentes (`roll` e `include`), evitando construir os campos e fazer boxing de valores que serão descartados. Só H1b removeu mais 200 alocações por `100d6/details`. Promovida.
2. **H2 — materialização.** Alocar os slices finais de dados/grupos no tamanho conhecido e transferir o primeiro slice por rolagem evita crescimento progressivo e uma cópia inicial. Estados mutáveis continuam sendo copiados. Promovida pela redução grande e estável de bytes/alocações; efeitos pequenos de tempo em outras cargas não são atribuídos à mudança.
3. **H3 — mapas de eventos internos.** O executor entrega ao journal mapas novos e exclusivos; um método privado registra sua posse, sem copiar todos os campos de novo. O método público `Record` continua copiando o mapa do chamador, inclusive preservando a precedência preexistente de um campo `sequence` fornecido pelo chamador. Promovida; o caminho sem eventos não muda nesta hipótese.
4. **H4 — arena de dados.** A primeira versão alocava chunks para dados iniciais e gerados. Reduziu alocações, mas aumentou a memória do pool em aproximadamente 2 KB por operação e piorou a mediana nessa carga. Descartada em favor de H4b: chunks com endereços estáveis, no máximo 256 posições, somente para dados iniciais conhecidos; dados gerados são alocados individualmente. A reserva ocorre apenas depois de ambos os limites aceitarem o dado e respeita as capacidades restantes. H4b foi promovida por reduzir 99 alocações de `100d6` sem reservar a cauda incerta das explosões.
5. **H5 — IDs e textos.** Usar `strconv` para IDs/índices e inteiros exatos dentro do intervalo seguro, calcular o ID do grupo uma vez por pool e reutilizá-lo nos dados elimina `fmt` dos caminhos frequentes. Valores fracionários e fora desse intervalo mantêm a conversão original. A saída JSON/textual continua sendo comparada aos fixtures TypeScript. Promovida; mais 199 alocações removidas de `100d6/details` em relação a H1b.

## Fase de seleção

Medianas de cinco amostras de 100 ms por carga, seed fixa. Os números de todas as nove cargas e cada amostra individual estão em `summary.json` e nos `.txt` correspondentes. Valores na tabela: microssegundos / bytes por operação / alocações por operação.

| Variante | 100d6 full | 100d6 details | Pool summary |
|---|---:|---:|---:|
| Baseline congelado | 229.151 / 186292 / 1760 | 137.684 / 105302 / 1336 | 57.930 / 26169 / 585 |
| H1: supressão de metadados | 249.488 / 186294 / 1760 | 99.220 / 95642 / 733 | 25.953 / 16749 / 352 |
| H2: tamanho exato e transferência de slices | 237.604 / 143012 / 1751 | 70.804 / 52529 / 725 | 29.923 / 16749 / 352 |
| H3: posse dos mapas internos | 174.492 / 143022 / 1751 | 77.253 / 52532 / 725 | 28.732 / 16749 / 352 |
| H4: arena geral (descartada) | 160.118 / 143395 / 1652 | 70.844 / 52913 / 626 | 31.423 / 18737 / 328 |
| H4b: arena apenas para dados iniciais | 178.383 / 143399 / 1652 | 73.945 / 52913 / 626 | 28.008 / 16620 / 333 |
| H1b: evitar boxing no chamador | 174.020 / 143402 / 1652 | 63.912 / 51309 / 426 | 26.763 / 16332 / 297 |
| H5: IDs e textos inteiros diretos | 152.053 / 139402 / 1453 | 41.281 / 47316 / 227 | 23.046 / 15299 / 245 |

## Confirmação em ordem inversa

A candidata V5 foi medida primeiro, seguida pelo binário baseline original, com três amostras de 200 ms por carga. Isto repete o confronto em ordem oposta à seleção e acrescenta seeds alternadas. Os resumos rápidos de `1d20+5` e `100d6` usam o caminho especializado que não foi alterado por estas hipóteses; seus bytes e alocações permanecem iguais. As diferenças pequenas de tempo nesses controles não são atribuídas ao executor. A redução de alocações nas projeções gerais se mantém nas duas políticas de seed.

| Carga / projeção / seed alternada | Baseline µs | V5 µs | Redução de tempo | Alocações baseline → V5 |
|---|---:|---:|---:|---:|
| `1d20+5/full/changing=false` | 18.830 | 17.682 | 6.1% | 177 → 167 |
| `1d20+5/full/changing=true` | 20.501 | 16.727 | 18.4% | 176 → 167 |
| `1d20+5/details/changing=false` | 14.970 | 14.848 | 0.8% | 150 → 128 |
| `1d20+5/details/changing=true` | 15.485 | 15.054 | 2.8% | 150 → 128 |
| `1d20+5/summary/changing=false` | 11.563 | 12.089 | -4.5% | 97 → 97 |
| `1d20+5/summary/changing=true` | 12.145 | 11.924 | 1.8% | 97 → 97 |
| `100d6/full/changing=false` | 225.538 | 152.558 | 32.4% | 1760 → 1453 |
| `100d6/full/changing=true` | 220.797 | 159.974 | 27.5% | 1760 → 1453 |
| `100d6/details/changing=false` | 128.138 | 47.654 | 62.8% | 1336 → 227 |
| `100d6/details/changing=true` | 134.754 | 44.918 | 66.7% | 1336 → 227 |
| `100d6/summary/changing=false` | 14.113 | 13.480 | 4.5% | 97 → 97 |
| `100d6/summary/changing=true` | 14.272 | 13.111 | 8.1% | 97 → 97 |
| `20d6!2ro=1kh10/full/changing=false` | 83.635 | 67.304 | 19.5% | 792 → 683 |
| `20d6!2ro=1kh10/full/changing=true` | 88.321 | 62.641 | 29.1% | 718 → 619 |
| `20d6!2ro=1kh10/details/changing=false` | 54.624 | 24.533 | 55.1% | 616 → 270 |
| `20d6!2ro=1kh10/details/changing=true` | 54.132 | 24.085 | 55.5% | 559 → 246 |
| `20d6!2ro=1kh10/summary/changing=false` | 48.201 | 25.272 | 47.6% | 585 → 245 |
| `20d6!2ro=1kh10/summary/changing=true` | 46.948 | 23.237 | 50.5% | 532 → 225 |

## Correção e cobertura

O conjunto `TestExecutor|TestExecutionJournal` passou após cada candidato. Ele inclui fixtures TypeScript para todas as projeções, replay, resultados textuais, modificadores, limites e rejeições. O perfil focado foi gerado após H5 e contém:

- `executor.go`: 543/543 statements cobertos.
- `executor_summary.go`: 124/124 statements cobertos.
- `journal.go`: 39/39 statements cobertos.

O novo teste `TestExecutorKeepsIdentityAcrossArenaChunksAndRolls` verifica 1.200 dados em duas rolagens, atravessando chunks da arena e gerando filhos: IDs, ordem, vínculos de parentesco, inclusão, estatísticas e replay nas projeções. O resultado de empate de keep-highest foi verificado diretamente no TypeScript: são mantidos `roll-1-die-600` e `roll-2-die-600`. O teste existente do journal confirma que mutar o mapa original não altera o evento registrado. A validação completa, o gate global de 100% e race da candidata combinada ficam a cargo da integração final; este ledger não antecipa seu resultado.

## Comandos e reprodução

Comandos executados em PowerShell. `GO` abaixo representa o executável Go 1.26.2; na sessão foi usado o caminho absoluto do runtime local. `PYTHON` representa Python com biblioteca padrão para resumir os logs. A medição não precisa de matplotlib.

```powershell
# A partir da raiz do repositório, congelar o pacote antes das mudanças:
New-Item -ItemType Directory -Force '.artifacts/optimization/executor/workspace'
Copy-Item -Path 'go/*' -Destination '.artifacts/optimization/executor/workspace' -Recurse

# Dentro de .artifacts/optimization/executor/workspace, antes de cada medição:
# Copiar somente executor.go/journal.go da variante correspondente para este snapshot.
& $GO test -c -o '../baseline.exe' .
# Variantes seguintes usam o mesmo comando, trocando apenas o nome de saída.

# Dentro de .artifacts/optimization/executor, seleção:
& './baseline.exe' '-test.run=^$' '-test.bench=^BenchmarkBackendOperation/.*/.*/changing=false$' '-test.benchtime=100ms' '-test.count=5' '-test.benchmem' | Out-File 'baseline.txt' -Encoding utf8
# Repetido em ordem: v1-events-suppressed, v2-materialization, v3-owned-events,
# v4-dice-arena, v4b-initial-dice-arena, v1b-event-fields, v5-integer-text.

# Confirmação, nesta ordem, usando os binários já congelados:
& './v5-integer-text.exe' '-test.run=^$' '-test.bench=^BenchmarkBackendOperation/.*/.*/changing=(false|true)$' '-test.benchtime=200ms' '-test.count=3' '-test.benchmem' | Out-File 'final-reverse-winner.txt' -Encoding utf8
& './baseline.exe' '-test.run=^$' '-test.bench=^BenchmarkBackendOperation/.*/.*/changing=(false|true)$' '-test.benchtime=200ms' '-test.count=3' '-test.benchmem' | Out-File 'final-reverse-baseline.txt' -Encoding utf8

# Dentro de go/, validar o código de produção final:
& $GO test -run 'TestExecutor|TestExecutionJournal' -coverprofile='../.artifacts/optimization/executor/coverage-focused.out' .

# Da raiz do repositório, resumir os logs e reconstruir este ledger:
& $PYTHON '.artifacts/optimization/executor/summarize.py'
& $PYTHON '.artifacts/optimization/executor/write_ledger.py'
```

## Hashes dos binários medidos

SHA-256 permite associar os logs às mesmas variantes sem recompilá-las durante o confronto final.

| Binário | SHA-256 |
|---|---|
| `baseline.exe` | `da10f4ad8fec394118c748588a7f9245661174f36adccbfdba5fa4150583fd43` |
| `v1-events-suppressed.exe` | `21cb4af54ebd572214b3332e509fead10979465be5eca6bda1033806f2a4d376` |
| `v1b-event-fields.exe` | `65701ea92bc9aad97728adbd080c65ea37bc9a0d659da390c36cdd6817e1ac5e` |
| `v2-materialization.exe` | `48839e21dc387d1b51fbeb494cc9f99c2366f4bf8fb332aaa60daafe40cfe875` |
| `v3-owned-events.exe` | `49505c1c57c6c1815eafc61066f45d3e0c851fb6228141c12a6f009dda762a9d` |
| `v4-dice-arena.exe` | `1c7e3807583ba7836d9249649ade6c8fb8206e9daf7c76000f943807b62c7538` |
| `v4b-initial-dice-arena.exe` | `5f37d9665ecff06cb4ce83c9724e9f1628b09d13e80a0d767f2cb593daf5338b` |
| `v5-integer-text.exe` | `412294fc3b8f9bdb72beeb7785aa7b53c6d86b220c03c10bc23a432c7d540a6a` |
