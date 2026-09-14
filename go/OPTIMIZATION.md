# Otimização da biblioteca Go para backend

Este documento registra a primeira rodada, encerrada em `a1c4bbb`.
A [segunda rodada](OPTIMIZATION_ROUND2.md) descreve a representação tipada dos
eventos, o executor de resumos e o confronto atualizado com Node e Bun.

O ponto de partida é o commit `62de502`. O objetivo desta rodada é reduzir tempo
e alocações mantendo a API de rolagem, todos os resultados, erros, limites e
replay da versão TypeScript de referência. A estrutura interna pode mudar.

A busca de código foi limitada a 12 hipóteses. As variantes foram medidas separadamente
com binários preservados, mantendo os demais componentes constantes. Uma
variante só foi aceita após comparações repetidas e testes de equivalência.
Os resultados de componentes abaixo não devem ser somados nem tratados como
ganhos de uma requisição completa.

## Resultado combinado: primeira versão Go → versão otimizada

As 18 combinações medidas tiveram menor mediana de tempo. O confronto final
alternou a ordem baseline/vencedor em cinco pares, com 100 ms por amostra,
cache aquecido e resultados públicos completos de cada modo. O baseline foi
compilado do commit `62de502`, acrescentando apenas o mesmo benchmark. Nenhum
outro benchmark rodou simultaneamente. Valores abaixo usam seeds alternadas
(ciclo de 128); os casos de seed fixa também estão nos dados brutos.

| Carga | Antes → depois (µs) | Aceleração | Bytes alocados/op antes → depois | Alocações/op antes → depois |
| --- | ---: | ---: | ---: | ---: |
| `1d20+5` full | 18,95 → 9,15 | 2,07× | 11.945 → 8.063 | 176 → 82 |
| `1d20+5` details | 15,35 → 7,76 | 1,98× | 8.136 → 5.199 | 150 → 43 |
| `1d20+5` summary | 10,17 → 5,25 | 1,93× | 6.286 → 3.799 | 97 → 12 |
| `100d6` full | 215,53 → 142,62 | 1,51× | 186.309 → 136.759 | 1.760 → 1.368 |
| `100d6` details | 131,18 → 28,36 | 4,63× | 105.319 → 44.815 | 1.336 → 142 |
| `100d6` summary | 12,35 → 7,12 | 1,73× | 6.286 → 3.799 | 97 → 12 |
| Pool full | 84,63 → 49,87 | 1,70× | 66.802 → 47.527 | 718 → 533 |
| Pool details | 49,60 → 19,69 | 2,52× | 38.574 → 16.337 | 559 → 161 |
| Pool summary | 41,95 → 16,36 | 2,56× | 24.027 → 12.228 | 532 → 140 |

Pool é `20d6!2ro=1kh10`. No exemplo de `100d6` details, são **89,4% menos
alocações** e **57,4% menos bytes alocados**. Isso compara as duas versões Go;
a disputa com Node e Bun é medida separadamente nos relatórios de benchmark.

[Todas as amostras, medianas e hashes dos binários](benchmarks/optimization/combined.json).
Os dez logs `combined-*.txt` estão na mesma pasta. Para recalcular o resumo
sem repetir medições: `node scripts/summarize-go-optimization.mjs`.
Os logs textuais têm espaços finais removidos para versionamento; os números
e amostras são preservados.

## Diagnóstico

O perfil inicial de `100d6` em modo details registrou 1.336 alocações e cerca de
105 KB alocados por rolagem. No perfil de alocações, `finalizeWorkingDice`
respondeu por 42,7% do volume, `createWorkingDie` por 18,2% e `recordDieEvent`
por 8,9%. O modo details montava mapas de eventos que eram descartados, e os
buffers de saída cresciam em etapas mesmo quando seu tamanho já era conhecido.

Havia também inicialização repetida da mesma parte constante do MT19937,
formatação de sete inteiros para cada consulta ao cache, validação repetida de
limites imutáveis e uso de aritmética racional para arredondar totais inteiros.

## Variantes de engine e matemática

Go 1.26.2, Windows/amd64, Ryzen 5 5500. Cinco amostras de 100 ms por variante;
medianas de tempo. Os testes são os mesmos em cada binário.

| Variante | Hipótese | Resultado | Memória por operação | Decisão |
| --- | --- | --- | --- | --- |
| E1 | Um inteiro finito já está arredondado a duas casas; evitar `big.Rat` após normalizar | `RoundResult`: 811,9 → 6,086 ns | 432 → 0 B; 24 → 0 alocações | Aceita |
| E2 | Chave nativa comparável elimina formatação/concatenação por cache hit | Compile aquecido: 1.039 → 621,6 ns | 1.681 → 1.528 B; 15 → 8 alocações | Aceita |
| E3 | Limites imutáveis da engine já foram validados no construtor | Compile aquecido, sobre E2: 621,6 → 312,4 ns | 1.528 → 600 B; 8 → 4 alocações | Aceita |

E1 mantém o arredondamento decimal exato para resultados fracionários e a
rejeição de não finitos. E2 preserva as sete dimensões da chave original. E3
mantém a validação completa de overrides e a rejeição de uma engine não
inicializada; não permite elevar os limites por chamada.

Dados: [baseline de arredondamento](benchmarks/optimization/baseline-round.txt),
[E1](benchmarks/optimization/round-integer.txt),
[baseline de cache](benchmarks/optimization/baseline-compile.txt),
[E2](benchmarks/optimization/typed-key-compile.txt) e
[E3](benchmarks/optimization/resolved-limits-compile.txt).

## Variantes de RNG, sementes e replay

Cinco amostras finais de 200 ms, com `-cpu=1`, comparando novamente baseline e
vencedor. Cada construção do MT recebe palavras de seed novas; sementes de
texto incluem um contador novo a cada operação.

| Variante | Hipótese | Mediana antes → depois | Memória por operação | Decisão |
| --- | --- | --- | --- | --- |
| R1 | Copiar o precursor constante da inicialização MT | Construtor + primeiro draw: 5.395 → 4.404 ns, na etapa isolada | 2.688 B; 1 alocação | Aceita |
| R2 | Separar os trechos do twist para eliminar operações de resto | R1+R2 no confronto final: 5.131 → 3.340 ns; stream: 5,029 → 3,382 ns/draw | Sem alteração de alocações | Aceita |
| R3 | Hash direto do fluxo UTF-16 sem slices intermediários | ASCII: 355,4 → 295,4 ns; Unicode: 440,5 → 336,8 ns | ASCII: 247 → 159 B; 5 → 4 alocações | Aceita |
| R4 | Decodificar replay em buffer de 16 bytes na stack | 245 → 216,5 ns | 240 → 224 B; 3 → 2 alocações | Aceita |

Nenhum cache de seeds foi introduzido. O precursor MT ocupa 2.496 bytes fixos,
independe das entradas e é copiado para cada gerador. O estado aleatório permanece
exclusivo da execução. A comparação adicional verificou 524.160 draws e estados
completos contra a implementação anterior, além de 1.015 entradas de hashing.

[Todas as amostras, hashes e etapas RNG](benchmarks/optimization/rng-seed.json).

## Variantes do executor

| Hipótese | Mudança aceita | Evidência isolada |
| --- | --- | --- |
| X1 | Contar eventos sem construir mapas nas projeções que não os retornam; evitar boxing também no chamador | `100d6` details: 1.336 → 733 alocações na etapa inicial; refinamento remove mais 200 |
| X2 | Materializar slices de dados/grupos no tamanho conhecido e transferir o primeiro resultado | `100d6` details: 95.642 → 52.529 B/op sobre X1 |
| X3 | Transferir a posse dos mapas internos recém-criados ao journal | `100d6` full: 237,6 → 174,5 µs na seleção |
| X4 | Reservar chunks de até 256 dados iniciais com endereços estáveis, após aceitar os limites | Remove 99 alocações de `100d6`; arena que também reservava dados gerados foi rejeitada |
| X5 | Formatar IDs e inteiros diretamente; calcular o ID do grupo uma vez por pool | Remove mais 199 alocações de `100d6` details |

O método público do journal ainda copia os mapas recebidos. Os eventos mantêm
sua ordem, conteúdo e contabilização de limites. A arena só reserva dados
iniciais conhecidos e respeita o orçamento restante; não antecipa a cauda de
explosões. Valores fracionários e inteiros fora do intervalo seguro continuam
usando a conversão textual anterior.

A confirmação isolada em ordem inversa verificou `100d6` details de 128,1 para
47,7 µs, antes de integrar os ganhos de RNG, matemática e engine. Esses valores
não substituem o confronto combinado acima.

[Ledger com variantes, rejeição, amostras e comandos](benchmarks/optimization/executor/LEDGER.md).
O ledger preserva referências aos binários e fontes intermediárias locais em
`.artifacts/optimization/executor/`; esses arquivos temporários não são distribuídos
no repositório. Os logs, resumos e hashes usados como evidência estão versionados.

## Correção final

**4.151/4.151 statements Go cobertos (100%)**, incluindo todos os arquivos de
produção. A suíte completa passou com `-race`, em 15,561 s. `go vet`, `gofmt`,
typecheck e lint passaram. Os seis geradores de referências TypeScript passaram
com `--check`, incluindo resultados completos, erros e 12.680 casos matemáticos
comparados sem tolerância. O novo teste do executor verifica 1.200 dados em
duas rolagens, atravessando chunks, com IDs, parentesco e replay preservados.

## Reprodução

Na pasta `go/`, com Go 1.26.2:

```sh
go test -run '^$' -bench BenchmarkEngineOverhead -benchtime=100ms -count=5
go test -run '^$' -bench BenchmarkRandomBackend -benchtime=200ms -count=5 -cpu=1
go test -run '^$' -bench BenchmarkBackendOperation -benchtime=100ms -count=5
```

Para repetir a comparação com o baseline, use um checkout separado do commit
`62de502` e copie apenas os arquivos `*_performance_test.go` e
`performance_test.go` atuais para sua pasta `go/`. Não execute os dois runtimes
ao mesmo tempo. Os binários congelados, perfis e arquivos intermediários desta
sessão ficam em `.artifacts/optimization/` no checkout de desenvolvimento.

O [benchmark comparativo](BENCHMARK.md) mede as APIs completas. O baseline
original foi preservado em [benchmarks/baseline](benchmarks/baseline/), incluindo
os resultados brutos e gráficos. O [benchmark de backend](BACKEND_BENCHMARK.md)
mede lotes de 10.000 chamadas, paralelismo e memória residente com Go, Node e Bun.
Testes de CPU e alocações são distintos de RSS:
`B/op` representa bytes alocados durante a operação, não memória residente ou
memória que permanece ocupada após a coleta de lixo.

Depois das mudanças de código, uma hipótese adicional de configuração foi
avaliada em [GC_TUNING.md](GC_TUNING.md): três valores de GOGC, com orçamento
de 180 s, controles novos e confirmação em ordem inversa. Essa configuração
pertence ao futuro processo de backend e não altera globalmente o GC a partir
da biblioteca. As comparações padrão continuam publicadas com as configurações
originais dos runtimes.
