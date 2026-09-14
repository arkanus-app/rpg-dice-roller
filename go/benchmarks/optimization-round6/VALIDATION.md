# Validação da rodada 6

Base `f107265`, com as mudanças H2 (classificação ASCII) e H3 (envelope dos
dados no JSON). H1 e H4, arenas privadas, foram medidas e rejeitadas por
regressões de tempo. Os arquivos dessas arenas não fazem parte da biblioteca.

## Contrato e cobertura

- `go test ./... -coverprofile=benchmarks/optimization-round6/final-coverage.out -count=1`:
  passou em 2,045 s; **4.817/4.817 statements**, sem exclusões.
- `node scripts/check-go-coverage.mjs go/benchmarks/optimization-round6/final-coverage.out`:
  confirmou a contagem exata, além do percentual arredondado de Go.
- `go test -race ./... -count=1`: passou em **15,129 s**, com CGO e GCC somente
  para a instrumentação de races.
- `go vet ./...`: passou.
- `go test -run=^$ -fuzz=^FuzzNativeJSONParity$ -fuzztime=5s -parallel=2`:
  passou em 6,534 s, **11.981 execuções**, 67 entradas iniciais do corpus/cache
  local e 21 novas entradas interessantes. As entradas adicionais do cache de
  fuzzing não são todas fixtures versionadas.
- Compilação cruzada dos testes para Linux/amd64 com CGO desabilitado: passou.
  O binário Linux não foi executado nesta máquina Windows.

Os testes novos comparam os 256 valores de byte, isolados e em diferentes
posições, com `encoding/json`. Também verificam prefixos binários, objetos
aninhados e campos seguintes, estados nil/vazios/múltiplos, números extremos,
Unicode, bytes UTF-8 inválidos e precedência dos erros. A suíte existente
continua verificando mutação, callbacks, ciclos, propriedade dos resultados e
igualdade integral do JSON. A cobertura de statements não equivale a uma prova
de ausência de defeitos nem às quatro métricas de cobertura de TypeScript.

## Oráculos TypeScript

Todos passaram com `--check`, sem atualizar as referências:

| Gerador em `scripts/` | Casos verificados |
|---|---:|
| `generate-go-fixtures.mjs` | 539 |
| `generate-go-compiler-fixtures.mjs` | 468 |
| `generate-go-executor-fixtures.mjs` | 238 em três projeções |
| `generate-go-engine-fixtures.mjs` | 24 cenários, 91 operações |
| `generate-go-system-fixtures.mjs` | 1.014 |
| `generate-go-math-conformance.mjs` | 12.680 |

## Ambiente de execução

Go 1.26.2, Windows/amd64, Ryzen 5 5500. Binários medidos compilados com
`CGO_ENABLED=0`; o detector de races usa `CGO_ENABLED=1` e GCC do w64devkit.
Nenhum teste, build, perfil ou renderização foi executado simultaneamente aos
benchmarks. A preparação e revisão dos arquivos ocorreram em paralelo.

Os confrontos Node incluem validação completa de 66 saídas por configuração
antes da medição, igualdade de bytes entre Go e a biblioteca padrão e entre
Go anterior/atual, além de digests de todas as chamadas cronometradas. Os
arquivos brutos registram status, hashes, ambiente e as verificações executadas.

## Timer dos confrontos Node

A [primeira tentativa](failed-coarse-clock/README.md) foi interrompida porque
o relógio Go usado no Windows não resolvia chamadas curtas. Ela está arquivada
e não integra as conclusões. O harness final usa `QueryPerformanceCounter`,
com frequência inicializada fora dos timers e um counter temporário exclusivo
por worker/coordenador, evitando criar esse temporário a cada leitura. A conversão dos
deltas usa multiplicação de 128 bits para evitar overflow.

O [smoke test](clock-smoke.json) executou Go anterior/atual, com 1/6 workers,
em d20 e 100d6: 512 amostras individuais, todas positivas. O contador reportou
10 MHz nesta máquina. Isso descreve sua frequência, não uma garantia de
acurácia de 100 ns. Os dois binários foram recompilados com o mesmo harness;
`go vet` e a compilação Linux foram repetidos após essa correção exclusiva
dos arquivos de teste. A biblioteca de produção permaneceu inalterada.
