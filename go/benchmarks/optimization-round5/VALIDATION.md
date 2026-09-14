# Validação da rodada 5

Executada localmente em Windows/amd64 com Go 1.26.2. O código de produção final
tem **4.802/4.802 statements cobertos**, sem exclusões; a contagem exata foi
conferida por `scripts/check-go-coverage.mjs`.

| Verificação | Resultado observado |
|---|---|
| `go test ./... -coverprofile=... -count=1` | Aprovado em 2,158 s, 100% |
| `go test -race ./... -coverprofile=... -count=1` | Aprovado em 28,887 s, 100%; GCC usado somente para instrumentação |
| `go vet ./...` | Aprovado na árvore final |
| Exemplos `ExampleMarshalJSON` e `ExampleAppendJSON` | Aprovados; também incluídos na suíte final |
| Testes diferenciais JSON | 554 projeções válidas do corpus, ponteiros/valores, mutações, erros, callbacks, ciclos, buffers e concorrência |
| `FuzzNativeJSONParity`, 10 s e dois workers | 13.183 execuções, sem falhas; aplicado ao encoder H1, antes dos ajustes de reserva. Os 20 seeds também passam na suíte final |
| `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go test -c` | Compilação aprovada; o executável Linux não foi executado |
| `gofmt` dos quatro arquivos Go novos | Aprovado |
| ESLint dos quatro scripts JavaScript novos | Aprovado, sem warnings |
| Quatro gráficos PNG | Renderizados e inspecionados visualmente; SVGs também preservados |

Os seis geradores TypeScript foram executados com `--check`, sem alterações
nas referências. Saídas observadas:

- `generate-go-fixtures.mjs`: 539 casos determinísticos; inclui normalização,
  parser, matemática, RNG, seeds, replay, limites, budgets e corpora históricos.
- `generate-go-compiler-fixtures.mjs`: 468 casos.
- `generate-go-executor-fixtures.mjs`: 238 casos, três projeções por caso.
- `generate-go-engine-fixtures.mjs`: 24 cenários e 91 operações.
- `generate-go-system-fixtures.mjs`: 388 rolagens, 115 contratos, 10 seleções e
  501 nomes.
- `generate-go-math-conformance.mjs`: 12.680 casos matemáticos exatos.

[Cobertura exata](final-coverage.txt) · [Perfil completo](final-coverage.out) ·
[Race detector](final-race.txt) · [Fuzzing H1](fuzz.txt) ·
[Auditoria de fontes e resultados](verification.json).

O perfil `baseline-json-cpu.pprof` usa o binário do commit `cecb59b` e
`BenchmarkResolvedEventsJSON/100d6`. O perfil `direct-json-cpu.pprof` usa a
variante H2 (`capacity.exe`) e `BenchmarkRollJSON/100d6/full` com encoder direct.
Ambos foram coletados separadamente, por 2 s, `GOMAXPROCS=1`, `GOGC=100` e
`GOMEMLIMIT=off`; seus tempos não são usados para calcular os ganhos finais.
Os binários e fontes das variantes estão identificados no [registro](LEDGER.md).

A auditoria verifica os artefatos gravados e seus hashes. Ela não substitui
testes executados, revisão visual nem um ensaio de carga do futuro servidor HTTP.
