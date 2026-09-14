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

## Serializar para o backend

Use `dicecore.MarshalJSON(result)` para codificar diretamente um resultado
full, details ou summary. A função entrega os mesmos bytes e erros de
`encoding/json.Marshal`, lendo os campos atuais a cada chamada. A API de
rolagem e o comportamento de `json.Marshal(result)` permanecem iguais;
o uso do encoder direto é explícito.

```go
result, err := dicecore.RollRPGDice("100d6", dicecore.RollOptions{Seed: "encontro-1"})
if err != nil { panic(err) }
payload, err := dicecore.MarshalJSON(result)
if err != nil { panic(err) }
fmt.Println(string(payload))

// Também é possível montar um envelope em um buffer pertencente ao chamador.
buffer := []byte(`{"roll":`)
buffer, err = dicecore.AppendJSON(buffer, result)
if err != nil { panic(err) }
buffer = append(buffer, '}')
```

O encoder tipado atende `DiceRollResult`, `DiceRollDetails` e
`DiceRollSummary`, por valor ou ponteiro. Outros tipos, inclusive envelopes
externos e resultados de sistemas, usam a biblioteca padrão. Um resultado com
`Sides` diferente de `int64`, `string` ou `nil`, ou com eventos do journal
legado, também é delegado integralmente à biblioteca padrão. Isso conserva
marshalers personalizados, ciclos, mutações feitas por callbacks e erros.

`AppendJSON` reaproveita a capacidade disponível e preserva o prefixo de `dst`.
Em erro, devolve o `dst` original; a capacidade além de seu comprimento pode
ter sido usada como temporário. Não há cache de JSON nem mudança no resultado.
Os bytes retornados pertencem ao chamador; reutilize um buffer somente depois
que seu consumidor terminar. Resultados podem ser codificados em paralelo para
buffers independentes, desde que não sejam alterados durante a codificação.

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

Na segunda rodada, em 13/09/2026, seis workers e uma engine por worker com
`GOGC=500` e `GOMEMLIMIT=96MiB` deram maior vazão que Node e Bun nas nove cargas
da API nativa sem JSON, com RSS amostrado até 78,44 MiB. Naquele ensaio,
incluindo `encoding/json.Marshal`, Go venceu uma das três cargas e perdeu
as duas maiores. Esses resultados históricos não medem o encoder direto.

Essas variáveis configuram o processo Go inteiro; a biblioteca não as altera.
O orçamento de memória de um futuro backend deve considerar também os demais
componentes desse processo. O [comparativo da quinta rodada](JSON_ROUND5_BENCHMARK.md)
mede `encoding/json.Marshal` e `dicecore.MarshalJSON` no mesmo binário Go,
frente a Node e Bun. O [holdout da quinta rodada](JSON_ROUND5_HOLDOUT.md)
verifica expressões adicionais em um ensaio separado.
O [relatório da quinta rodada](OPTIMIZATION_ROUND5.md) reúne os resultados,
os custos de memória e a adoção explícita do encoder direto no backend.

A [sexta rodada, focada em Node](OPTIMIZATION_ROUND6.md), melhora a escrita do
JSON mantendo o contrato e a cobertura exata de 100%. Os ensaios com
[um worker](NODE_ROUND6_W1.md) e [seis workers](NODE_ROUND6_W6.md) comparam
rolagem completa + JSON em 11 expressões, com vazão, CPU/op, latência individual
e RSS apresentados separadamente. Os gráficos distinguem GC padrão e
configuração explícita do processo.

A [sétima rodada](OPTIMIZATION_ROUND7.md) reduz o trabalho ao escrever números
e strings. No ensaio com um worker, o tempo de rolagem full + JSON caiu 15,02%
em `100d6` e 6,81% no pool com modificadores, sem aumento das alocações.
Os testes mantêm cobertura exata de 100%. O relatório separa esses ganhos dos
cenários sem diferença significativa e dos ensaios anteriores com seis workers.

A [licença do projeto](../licence.txt) e os
[avisos dos kernels matemáticos](THIRD_PARTY_NOTICES.md) se aplicam a este código.
