# Dicecore para Go

Implementação nativa de `@erpg/dicecore` 3.7.1, com compilador, executor,
replay determinístico e sistemas de RPG. O módulo usa apenas a biblioteca padrão
de Go; não executa JavaScript, Node.js ou código C para resolver rolagens.

```text
github.com/arkanus-app/rpg-dice-roller/go
```

O código está na branch `Go-Version`, na pasta `go/` deste repositório. Para
integrar um projeto local antes de publicar uma versão do módulo, adicione um
`replace` no `go.mod` do consumidor apontando para este diretório:

```sh
go mod edit -replace github.com/arkanus-app/rpg-dice-roller/go=/caminho/rpg-dice-roller/go
go get github.com/arkanus-app/rpg-dice-roller/go
```

## Rolar e reproduzir

```go
package main

import (
    "fmt"

    dicecore "github.com/arkanus-app/rpg-dice-roller/go"
)

func main() {
    result, err := dicecore.RollRPGDice("4d6kh3+2", dicecore.RollOptions{
        Seed: "personagem-42",
    })
    if err != nil { panic(err) }
    replayed, err := dicecore.RollRPGDice("4d6kh3+2", dicecore.RollOptions{
        Replay: result.Replay,
    })
    if err != nil { panic(err) }
    fmt.Println(result.Total, replayed.Total)
}
```

`RollRPGDice` entrega dados, grupos, eventos e texto completo.
`RollRPGDiceDetails` preserva os detalhes sem materializar o diário completo;
`RollRPGDiceSummary` entrega o resumo. Semente, consumo aleatório, total, limites
e replay seguem o contrato de cada projeção TypeScript.

Os eventos completos usam `ResolvedEvents` (`[]ResolvedEvent`), com campos Go tipados. Por exemplo,
`result.Events[i].Value` acessa o valor de uma rolagem; campos de modificadores e
grupos ficam em `event.Details`, quando presente. `Type` e `Subject` identificam
os campos aplicáveis. Essa representação substitui o acesso anterior por mapa
(`event["value"]`); `json.Marshal(result)` preserva os mesmos campos e valores
do resultado TypeScript. O journal público de baixo nível ainda aceita e retorna
`DiceEvent` como mapa.

## Engine e sistemas

Crie uma engine para compartilhar limites e caches entre chamadas. Ela pode ser
usada concorrentemente; cada rolagem tem seu próprio estado de execução.

```go
engine, err := dicecore.CreateDiceEngine(dicecore.DiceEngineOptions{
    Limits: dicecore.DiceLimitOverrides{"maxInitialDice": 100},
    Cache: dicecore.DiceCacheOptions{"maxInputEntries": 200},
})
if err != nil { panic(err) }
plan, err := engine.Compile("2d6+3")
if err != nil { panic(err) }
result, err := engine.RollSummary(plan, dicecore.RollOptions{Seed: "encontro-1"})
if err != nil { panic(err) }
fmt.Println(result.Total, engine.GetCacheStats())

fate, err := dicecore.RollFateDice(nil, dicecore.SystemRollOptions{
    RollOptions: dicecore.RollOptions{Seed: "fate-1"},
    Detail: "compact",
})
if err != nil { panic(err) }
fmt.Println(fate.Total)
```

Também estão disponíveis `RollAssimilation`, `EvaluateAssimilationSelection`,
`RollDaggerheart`, `RollVampireV5`, `RollMixedDice` e `CreateSystemRoller`.
`nil` usa a entrada padrão em Fate e Daggerheart. As entradas dos sistemas aceitam
seus structs Go ou objetos `map[string]any`, com validação de valores e campos.

Resultados e campos do envelope dos planos públicos pertencem ao chamador.
Alterá-los não modifica o cache nem uma rolagem futura. Os getters de baixo
nível `GetPlanProgram` e `GetPlanAST` expõem estruturas internas compartilhadas
para leitura: essas estruturas e seus descendentes não devem ser alterados.
Go não oferece o `Object.freeze` de JavaScript:
as opções de congelamento são aceitas, e o isolamento é feito por propriedade
dos dados e cópias. Geradores aleatórios e budgets de baixo nível pertencem a
uma execução; não compartilhe essas instâncias mutáveis entre goroutines.

## Validar

Requer Go 1.26 ou mais recente; a referência de desenvolvimento é Go 1.26.2.
Na pasta `go/`:

```sh
go test ./...
go vet ./...
go test -coverpkg=./... -coverprofile=coverage.out ./...
go tool cover -func=coverage.out
node ../scripts/check-go-coverage.mjs coverage.out
# Com uma toolchain C disponível para instrumentação:
go test -race ./...
```

A exigência é **100% dos statements Go**, sem excluir arquivos de produção.
O verificador lê contagens exatas e rejeita qualquer statement sem execução,
inclusive quando o percentual arredondado aparece como `100.0%`.
Node.js é necessário somente para ferramentas de desenvolvimento e comparação.

O [relatório da migração](MIGRATION.md) descreve a equivalência funcional e as
adaptações de linguagem. A [documentação das referências](testdata/README.md)
explica como reproduzir as comparações TypeScript. O [benchmark](BENCHMARK.md)
compara Go, Node e Bun com entradas idênticas e mantém os dados brutos. O
[benchmark de backend](BACKEND_BENCHMARK.md) mede lotes de 10.000 chamadas com
1/2/4/6 workers, engines compartilhadas ou por worker e memória residente.
A [segunda rodada de otimização](OPTIMIZATION_ROUND2.md) inclui eventos tipados,
resumos compactos e menos alocações. Consulte o [confronto atualizado de backend](BACKEND_ROUND2_BENCHMARK.md),
o [teste com serialização JSON](JSON_BENCHMARK.md) e o [experimento de GC atualizado](GC_ROUND2_TUNING.md).
Os resultados anteriores permanecem disponíveis para comparação.

A [terceira rodada, guiada por skills e perfis](OPTIMIZATION_ROUND3.md) reduz as
alocações nas nove cargas nativas. Em `100d6` completo, são 55→34 alocações e
10,60% menos bytes por chamada, preservando o contrato e a cobertura de 100%.
O [comparativo JSON da rodada 3](JSON_ROUND3_BENCHMARK.md) inclui a versão
anterior e a atual medidas na mesma sessão.

A [quarta rodada](OPTIMIZATION_ROUND4.md) compacta os dados privados, transfere
os estados e reduz os temporários da seleção. O pool completo passa de 141 para
116 alocações, e `100d6` aloca 4 KiB a menos por chamada em full/details.
Os novos confrontos da [API nativa](BACKEND_ROUND4_BENCHMARK.md) e de
[rolagem com JSON](JSON_ROUND4_BENCHMARK.md) medem Go anterior/atual, Node e Bun
com GC padrão e configurado, incluindo os casos em que Go perde.

Na confirmação da segunda rodada com seis workers e uma engine por worker, `GOGC=500` e `GOMEMLIMIT=96MiB` deram maior
vazão que Node e Bun nas nove cargas da API nativa sem JSON, com RSS amostrado até 78,44 MiB.
Essas variáveis configuram o processo Go inteiro; a biblioteca não as altera.
O orçamento de memória de um futuro backend deve considerar também os demais
componentes desse processo. Incluindo JSON, Go venceu uma das três cargas;
Node e Bun continuam mais rápidos nas duas cargas com resultados maiores.

A [licença do projeto](../licence.txt) e os
[avisos dos kernels matemáticos](THIRD_PARTY_NOTICES.md) se aplicam a este código.
