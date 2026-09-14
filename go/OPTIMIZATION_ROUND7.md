# Rodada 7: menos trabalho ao serializar números e strings

A rolagem full seguida de `dicecore.MarshalJSON` teve redução de tempo de
**15,02% em `100d6`** e **6,81% no pool `20d6!2ro=1kh10`**, em comparação
com `bb82246`. A serialização isolada melhorou de **12,01% a 20,29%** em cinco
das nove projeções medidas. As outras comparações não demonstraram diferença
significativa. Não houve regressão de tempo estatisticamente significativa
nos cenários medidos.

## Implementação

O encoder escreve diretamente os números inteiros de 0 a 9, frequentes nos
valores dos dados. Frações, zero negativo, números maiores e erros continuam
no caminho numérico anterior. A igualdade exata é verificada antes de usar o
atalho, inclusive para valores separados de um inteiro por um único ULP.

A classificação ASCII verifica quatro bytes por iteração. Uma substring com
comprimento já validado permite ao compilador eliminar os checks dos quatro
acessos. O restante é verificado byte a byte. Strings com escapes, Unicode ou
UTF-8 inválido continuam usando `encoding/json`. Todos os valores são lidos
novamente a cada chamada; não há cache de JSON nem reutilização de resultados.

A API, a propriedade dos buffers, a ordem dos eventos, as seeds e o replay
permanecem iguais. A biblioteca não altera as configurações globais de GC.

## Rolagem full + JSON

Dez pares alternados, 500 ms por benchmark, MT19937, uma engine com cache de
notação aquecido e 128 seeds alternadas. O tempo inclui criar o resultado e
produzir um buffer JSON próprio. Toda seed passa por comparação de bytes com
`encoding/json` antes da medição.

| Expressão | Antes | Depois | Diferença de tempo |
|---|---:|---:|---|
| `1d20+5` | 10,150 µs | 9,805 µs | Sem diferença significativa |
| `100d6` | 69,55 µs | 59,11 µs | **−15,02%**, p=0,029 |
| `20d6!2ro=1kh10` | 40,28 µs | 37,53 µs | **−6,81%**, p=0,043 |
| `4d6kh3` | 11,35 µs | 11,64 µs | Sem diferença significativa |
| `40d10>=7f=1` | 61,36 µs | 58,66 µs | Sem diferença significativa |
| `8d6+2 # ação 🎲` | 16,12 µs | 15,34 µs | Sem diferença significativa |
| `8d6min2.5max5.5` | 21,59 µs | 20,79 µs | Sem diferença significativa |

As quatro últimas expressões não participaram da escolha das variantes. As
contagens de alocações permaneceram idênticas. Os bytes por operação não
apresentaram diferença significativa; as pequenas variações nos casos com
modificadores refletem quantas iterações de cada seed cabem no benchmark.

[Dados e estatística completos](benchmarks/optimization-round7/final-pipeline-benchstat.txt).

## Serialização isolada

Resultados previamente construídos, dez pares alternados, 300 ms por
benchmark, `dicecore.MarshalJSON` nas duas versões, sem buffer reaproveitado.

| Projeção com ganho confirmado | Antes | Depois | Redução de tempo |
|---|---:|---:|---:|
| d20/full | 3,213 µs | 2,827 µs | 12,01% |
| 100d6/details | 16,08 µs | 12,82 µs | 20,29% |
| 100d6/full | 33,14 µs | 27,99 µs | 15,52% |
| pool/details | 5,329 µs | 4,434 µs | 16,79% |
| pool/full | 16,08 µs | 13,50 µs | 16,10% |

As nove projeções preservam exatamente os bytes alocados e **uma alocação**
por serialização. d20/details e as três projeções summary não tiveram
diferença significativa. [Benchstat completo](benchmarks/optimization-round7/final-json-benchstat.txt).

## Experimentos e limites

O [registro das três hipóteses](benchmarks/optimization-round7/LEDGER.md)
preserva as tentativas, inclusive a classificação ASCII por índice, rejeitada
por não demonstrar ganho. Fontes intermediárias, perfis, dados brutos e hashes
dos executáveis estão no mesmo diretório. Os ganhos de hipóteses distintas
não são somados: a combinação final foi medida contra o código original.

Go 1.26.2, Windows/amd64, Ryzen 5 5500, `CGO_ENABLED=0`, `GOMAXPROCS=1`,
`GOGC=100`, `GOMEMLIMIT=off`. Binários compilados antes de medir, processos
alternados A/B e B/A, sem builds ou outros ensaios simultâneos. Cada comparação
tem orçamento máximo de 120 segundos.

São medições locais com dispersão relevante. Os p-valores são por comparação,
sem correção para testes múltiplos; não são garantia de repetir os percentuais
em outro ambiente. Esta rodada não mede p95, HTTP, seis workers, Node ou Bun.
Os comparativos da rodada 6 continuam sendo evidência da versão anterior.

## Validação

- Suíte Go completa: passou; **4.830/4.830 statements cobertos**, sem exclusões.
- `go vet ./...`: passou.
- `go test -race ./... -count=1`: passou em 15,875 s.
- Fuzzing de paridade JSON: **17.030 execuções**, passou em 6,542 s.
- Lint do novo script de benchmark: passou.
- Testes adicionais verificam todos os 256 bytes em todas as posições de
  strings de 1 a 12 bytes, com prefixo binário e com/sem capacidade disponível;
  também verificam os vizinhos representáveis dos inteiros 0 a 10.

O detector de races e o fuzzing foram executados depois de todas as medições.
Os testes existentes de fixtures, replay, mutação, callbacks, erros e
propriedade dos resultados continuam passando. Não foi necessário atualizar
as referências TypeScript. A cobertura de statements não prova ausência de
defeitos.

## Reprodução

Com Go 1.26.2 e benchstat no PATH, a partir da raiz do repositório. Os binários
medidos nesta sessão estão em `.artifacts/optimization-round7/`; os JSONs
registram seus hashes e os argumentos exatos. Para reconstruir a base em um
checkout separado, copie somente o novo benchmark para o código original:

```powershell
git worktree add --detach .artifacts/round7-baseline-src bb82246
Copy-Item go/json_pipeline_bench_test.go .artifacts/round7-baseline-src/go/json_pipeline_bench_test.go
$env:CGO_ENABLED = '0'
go -C .artifacts/round7-baseline-src/go test -c -o ../../optimization-round7/baseline.exe
go -C go test -c -o ../.artifacts/optimization-round7/final.exe

node scripts/compare-go-round7-micro.mjs .artifacts/optimization-round7/baseline.exe .artifacts/optimization-round7/final.exe rerun-json '^BenchmarkRollJSON$' 300ms
node scripts/compare-go-round7-micro.mjs .artifacts/optimization-round7/baseline.exe .artifacts/optimization-round7/final.exe rerun-pipeline '^BenchmarkRollAndJSON$' 500ms
benchstat go/benchmarks/optimization-round7/rerun-json-before.txt go/benchmarks/optimization-round7/rerun-json-after.txt
benchstat go/benchmarks/optimization-round7/rerun-pipeline-before.txt go/benchmarks/optimization-round7/rerun-pipeline-after.txt

go -C go test ./... '-coverprofile=benchmarks/optimization-round7/rerun-coverage.out' -count=1
node scripts/check-go-coverage.mjs go/benchmarks/optimization-round7/rerun-coverage.out
go -C go vet ./...
# Configure CC apontando para um compilador C para o detector:
$env:CGO_ENABLED = '1'
go -C go test -race ./... -count=1
$env:CGO_ENABLED = '0'
go -C go test '-run=^$' '-fuzz=^FuzzNativeJSONParity$' '-fuzztime=5s' '-parallel=2'
```

Para reverter somente a otimização, restaure `event.go` da base `bb82246` e
a asserção booleana original da tabela em `event_strings_test.go`. Os novos
testes de paridade e o benchmark continuam úteis com a implementação anterior.
