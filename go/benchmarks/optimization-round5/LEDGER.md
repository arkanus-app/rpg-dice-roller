# Registro de experimentos — rodada 5

O resultado aceito é um encoder direto aditivo, com reserva de capacidade corrigida. A escolha da reserva reduz memória em relação à primeira implementação, mas traz regressões de tempo em dois microbenchmarks. O ganho final publicado é a comparação independente entre `encoding/json.Marshal` e `dicecore.MarshalJSON` **no mesmo binário final**; percentuais de experimentos anteriores não são somados.

Este registro cobre serialização de resultados já construídos. Não mede rolagem completa, HTTP nem comparação com Node/Bun; essas medições pertencem aos relatórios próprios da rodada.

## Método e orçamento

O [plano inicial](PLAN.md) permitia três hipóteses, 120 segundos por comparação e dez pares alternados. H1 implementou o encoder; H2 tentou reduzir a reserva; H3 consumiu a última hipótese como correção limitada de H2. Não houve experimento com scratch privado nem pool de buffers retornados.

Cada ensaio usa os nove casos `BenchmarkRollJSON/{d20,100d6,pool}/{summary,details,full}`, resultado fixo gerado antes de `b.Loop`, seed `event-json-throughput`, MT19937 e bytes novos pertencentes ao chamador. Os nomes representam `1d20+5`, `100d6` e `20d6!2ro=1kh10`. A função `func(any) ([]byte, error)` é selecionada fora do timer. A igualdade integral com os bytes da biblioteca padrão também é verificada antes do timer.

Foram dez processos por variante, com pares std/direct ou antes/depois e ordem alternada, `-test.benchtime=100ms`, `GOMAXPROCS=1`, `GOGC=100` e `GOMEMLIMIT=off`. O harness remove grafias herdadas dessas variáveis em Windows. Máquina: AMD Ryzen 5 5500, Windows/amd64. Perfis foram coletados separadamente. As durações abaixo são de parede do ensaio; cada execução terminou dentro de seu teto de 120 segundos.

| Ensaio | Comparação | Duração | Decisão |
|---|---|---:|---|
| H1 / v1 | std/direct no mesmo `current.exe` | 23,719 s | Encoder aceito; reserva requer melhoria |
| H2 / v2 | H1/H2, ambos direct | 24,287 s | Rejeitado |
| H3 / v3 | H1/H3, ambos direct | 24,655 s | Aceito por memória, com custo de tempo divulgado |
| Confirmação final | std/direct no mesmo `final.exe` | 23,820 s | Base das afirmações finais sobre o encoder |

Todas as amostras e tentativas foram preservadas. Os intervalos e valores p são os produzidos pelo benchstat, com dez amostras por caso; `p=0.000` no arquivo é arredondamento, não probabilidade zero. A estação compartilhada tem ruído de frequência, escalonamento e GC. As comparações de nove casos não têm correção por múltiplos testes; os valores p não substituem confirmação em produção.

## H1 — encoder tipado independente

O [perfil do baseline](profile-baseline-cpu.txt) colocou `encoding/json.appendCompact` em 35,02% do tempo próprio e 61,73% acumulado. H1 evita reflexão e revalidação do JSON produzido pelo caminho tipado, mantendo fallback integral para entradas que requerem o comportamento da biblioteca padrão. A API de rolagem e os resultados permanecem iguais; o chamador precisa optar por `dicecore.MarshalJSON` ou `dicecore.AppendJSON`.

A [fonte H1](v1-json.go.txt) reservava no máximo 64 KiB, com base de 1.024 bytes e pesos de 256 por dado/grupo, 160 por evento e 128 por rolagem; cada contagem era limitada a 1.024.

No [benchstat H1](v1-encoder-benchstat.txt), o tempo caiu nos nove casos. Em full, caiu 69,88% para d20, 82,15% para 100d6 e 80,77% para pool; alocações passaram de duas para uma. Porém, B/op aumentou 80% em cada summary, 57,14% em d20/details, 10,94% em 100d6/details e 20,75% em pool/details. Esse custo determinou a hipótese seguinte.

Evidências: [antes](v1-encoder-before.txt), [depois](v1-encoder-after.txt), [metadados e hashes](v1-encoder.json).

## H2 — reserva menor, rejeitada

A [fonte H2](v2-json.go.txt) mudou a base para 512 bytes e os pesos para 236 por dado, 224 por grupo, 144 por evento e 128 por rolagem. O limite de reserva inicial passou a 1 MiB, com contagens limitadas a 4.096 dados/grupos/rolagens e 8.192 eventos. Isso é uma estimativa inicial limitada: resultados maiores continuam crescendo normalmente.

Apesar de reduzir B/op em sete casos, H2 fez d20/full crescer de **3.072 para 5.376 B/op (+75%)** e de **uma para duas alocações**. A reserva inicial ficou insuficiente nesse caso. Nenhuma mudança de tempo atingiu o limiar padrão do benchstat; d20/full apresentou p=0,052. A variante foi rejeitada pela regressão determinística de memória/alocações, sem esperar outra rodada favorável.

Evidências: [benchstat H2](v2-capacity-benchstat.txt), [antes](v2-capacity-before.txt), [depois](v2-capacity-after.txt), [metadados](v2-capacity.json), [harness arquivado usado em H2](v2-capacity-script.mjs.txt).

## H3 — correção limitada de H2, aceita por memória

H3 preservou pesos e limites de H2 e restaurou a base de 1.024 bytes quando há grupos ou eventos. Nas demais projeções, manteve 512 bytes. O critério usa a estrutura real do resultado; não reconhece expressões, seeds ou valores particulares do benchmark. A implementação aceita está em [json.go](../../json.go).

Esta é uma variante nova e identificada, consumindo a terceira hipótese. Foi comparada novamente com H1 em dez pares completos e gravada em arquivos v3 próprios. A execução H2 rejeitada não foi descartada nem substituída. Não se trata de repetir a mesma variante até surgir uma amostra favorável.

O [benchstat H3 versus H1](v3-capacity-benchstat.txt) mostra **menos B/op em 7/9 casos, empate em 2/9 e uma alocação nos nove**:

| Caso | H1 B/op | H3 B/op | Variação |
|---|---:|---:|---:|
| d20/summary | 1.152 | 640 | −44,44% |
| d20/details | 1.408 | 896 | −36,36% |
| d20/full | 3.072 | 3.072 | igual |
| 100d6/summary | 1.152 | 640 | −44,44% |
| 100d6/details | 27.264 | 24.576 | −9,86% |
| 100d6/full | 65.536 | 57.344 | −12,50% |
| pool/summary | 1.152 | 640 | −44,44% |
| pool/details | 8.192 | 8.192 | igual |
| pool/full | 20.480 | 18.432 | −10,00% |

A aceitação **não significa que H3 seja mais rápida que H1**. Foram observadas regressões de tempo em **d20/full: +29,95%, p=0,004** e **pool/details: +19,56%, p=0,023**. Os outros sete casos não tiveram diferença detectada pelo limiar padrão do benchstat; isso não prova equivalência. A média geométrica de tempo subiu 14,62%. O motivo para manter H3 foi reduzir memória e corrigir a segunda alocação de H2, aceitando esse custo observado.

Evidências: [antes](v3-capacity-before.txt), [depois](v3-capacity-after.txt), [metadados](v3-capacity.json). O manifesto compara fontes atuais apenas com a candidata; os hashes de ambos os executáveis identificam o controle preservado. Entre H1, H2 e H3, o único arquivo Go com hash diferente nos manifestos é `go/json.go`.

## Confirmação independente — std versus direct final

O [ensaio final](final-encoder.json) usa **o mesmo `final.exe` nas duas variantes**. Apenas `DICECORE_JSON_ENCODER` muda. O primeiro argumento do script é ignorado em `--confirm`; os dois hashes registrados são idênticos.

| Full | Tempo std | Tempo direct | Variação de tempo | Variação B/op | Alocações |
|---|---:|---:|---:|---:|---:|
| d20 | 9,082 µs | 2,724 µs | −70,00% | −17,24% | 2 → 1 |
| 100d6 | 256,46 µs | 45,96 µs | −82,08% | −41,67% | 2 → 1 |
| pool | 96,87 µs | 18,10 µs | −81,31% | −42,40% | 2 → 1 |

O tempo foi menor nos nove casos do [benchstat final](final-encoder-benchstat.txt), com p<0,001. B/op empatou nos três summaries e nos details de d20/100d6 pelo limiar do benchstat. **pool/details continua consumindo 20,75% mais B/op: 6.784 → 8.192**, embora tenha menor tempo. As reduções full são propriedades desse encoder explícito, medidas isoladamente; não são percentuais de melhoria da rolagem inteira.

Usam-se estes resultados finais, sem somar ganhos de H1, H2 e H3 nem atribuir as diferenças entre ensaios ao código. As regressões de H3 contra H1 continuam válidas como observação da seleção. Evidências completas: [std](final-encoder-before.txt), [direct](final-encoder-after.txt), [metadados](final-encoder.json).

## Origem e reprodução

Os executáveis locais ficam em `.artifacts/optimization-round5`; não são artefatos portáveis do repositório. Hashes SHA-256:

| Estado | Executável | SHA-256 |
|---|---|---|
| Antes da API aditiva, commit `cecb59b` | `baseline.exe` | `68f1a39b70c5f51f06d7225a7e7ff18d87f7f672cfa9ddd563c7915390ab2604` |
| H1 | `current.exe` | `1c29de174454624906dffb7d104ab076b96e5630b1db6f8141b122140556f348` |
| H2 rejeitado | `capacity.exe` | `acf6699bc9c59a73be59e4fdc09e4ad937a5e9d54802e0d7ce0a51217a3ef723` |
| H3/final | `final.exe` | `a1d7a56eb7cf300fb0bd722316d6f229d58c0bf4e6a34e008e73d79bc9fc2b7b` |

O baseline original não possui o novo microbenchmark; é controle do worker original no ensaio de runtime. H1 e a confirmação usam o controle std do próprio binário, isolando a escolha do encoder. Os hashes de `go/json.go` nas fontes H1/H2/final são, respectivamente, `3c98feeffa1b6a5149ad212d37946a9265942a51274314ed850c4ba469a99459`, `4008cc2573bdc495e8688c2cc2905a722739aa2102800cc7883104b028c83544` e `8ea16309d7c80cf9ad4f9eb8f9e73789978076060f9770c8329a33a1991020df`. Os arquivos H1/H2 arquivados conferem com os hashes dos respectivos manifestos.

Na raiz do repositório, as invocações registradas foram:

```powershell
node scripts/compare-go-round5-micro.mjs .artifacts/optimization-round5/current.exe
node scripts/compare-go-round5-capacity.mjs .artifacts/optimization-round5/current.exe .artifacts/optimization-round5/capacity.exe
node scripts/compare-go-round5-capacity.mjs .artifacts/optimization-round5/current.exe .artifacts/optimization-round5/final.exe --corrected
node scripts/compare-go-round5-capacity.mjs .artifacts/optimization-round5/current.exe .artifacts/optimization-round5/final.exe --confirm
```

Esses comandos gravam novamente os arquivos correspondentes: execute uma reprodução em cópia de trabalho separada para preservar a evidência publicada. H2 foi medido antes da adição de `--corrected`; seu [harness arquivado](v2-capacity-script.mjs.txt) tem SHA-256 `d1f9aeea8c5572a18f26e7100ccb7de4a506617d4c578355469f481975df357a`. O [harness atual](../../../scripts/compare-go-round5-capacity.mjs) usado em H3/confirmação tem SHA-256 `ffc86a33c563f2ef0841e361482d5306054a75a67cbbe9be6d3b8fd18796e992`. A diferença adiciona o nome de saída `v3-capacity` por `--corrected`; as configurações de medição são as mesmas.

Para reconstruir, use uma cópia isolada da árvore final e compile o módulo `go`. Antes de compilar H1 ou H2, restaure **nessa cópia** `go/json.go` a partir de `v1-json.go.txt` ou `v2-json.go.txt`, preservando todos os outros arquivos Go. Compile cada estado para um nome diferente. Exemplo, com o diretório atual dentro do módulo `go` da cópia correspondente:

```powershell
# H1: go/json.go restaurado de v1-json.go.txt
go test -c -o ../.artifacts/optimization-round5/current.exe
# H2: go/json.go restaurado de v2-json.go.txt
go test -c -o ../.artifacts/optimization-round5/capacity.exe
# H3: go/json.go da árvore final
go test -c -o ../.artifacts/optimization-round5/final.exe
```

O estado anterior à API é reconstruível em checkout separado de `cecb59b`, executando `go test -c -o ../.artifacts/optimization-round5/baseline.exe` a partir de seu módulo `go`. Crie previamente os diretórios de saída. Caminhos de build, versão do Go e ambiente podem produzir hashes binários diferentes; os manifestos preservam a identidade das medições originais. Não execute builds, perfis e benchmarks concorrentes durante a reprodução.
