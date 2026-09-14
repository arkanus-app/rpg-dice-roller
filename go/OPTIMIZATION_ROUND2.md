# Segunda rodada de otimização Go

Na comparação final de lotes com seis workers e uma engine por worker, Go com **`GOGC=500` e
`GOMEMLIMIT=96MiB` venceu Node e Bun nas nove cargas**. O maior RSS amostrado
nessa confirmação foi **78,44 MiB**. Com a configuração padrão, Go venceu ambos
em cinco das nove cargas. A condição de execução faz parte do resultado.

| API full, 10.000 chamadas por lote | Go configurado, chamadas/s | Node, chamadas/s | Bun, chamadas/s | Go/Node |
|---|---:|---:|---:|---:|
| `1d20+5` | 457.406 | 162.582 | 106.429 | 2,81× |
| `100d6` | 73.606 | 45.025 | 43.565 | 1,63× |
| `20d6!2ro=1kh10` | 143.425 | 90.814 | 80.726 | 1,58× |

Esses valores medem a construção dos resultados nativos. O custo adicional de
JSON muda a conclusão: mesmo configurado, Go venceu ambos em **uma das três
cargas** com serialização. `100d6` + JSON fez 11.246 chamadas/s em Go, contra
19.039 no Node e 24.279 no Bun; o pool modificado fez 32.960, contra 47.803 e
48.067. A vantagem de rolagem não se converte em vitória do pipeline com JSON
nessas duas cargas. O [experimento próprio](JSON_BENCHMARK.md) publica os modos
padrão e configurado integralmente. As nove cargas da API nativa, dados
brutos, quartis e gráficos estão no [confronto de backend](BACKEND_ROUND2_BENCHMARK.md).
No microbenchmark sequencial das 17 cargas históricas, sem ajuste de GC, Go teve
mediana menor que Node em nove cargas; a configuração vencedora de backend não
foi usada para substituir esses resultados.

O ponto de partida é `a1c4bbb`. Esta rodada preserva as funções de rolagem,
resultados JSON, texto, ordem de eventos, sementes, replay e erros de limites.
A representação nativa dos eventos passou de mapas a structs tipadas, conforme
a autorização para adaptar a estrutura Go. Consulte a adaptação no [README](README.md).

As dez hipóteses de código foram divididas em eventos (4), resumos (3) e
sementes/projeções/IDs (3). Refinamentos da mesma hipótese foram comparados com
a versão aceita anterior. As medições de componentes usam snapshots isolados;
seus ganhos não se somam. As medições finais congelam um manifesto de fontes.
O experimento adicional de GC altera somente a configuração do processo de
benchmark; a biblioteca não chama `debug.SetGCPercent` nem modifica o ambiente.

A primeira seleção de GC testou 100/200/500/1000 e escolheu 500, mas sua repetição
sem limite de memória ultrapassou o critério de RSS de 128 MiB. Essa tentativa
foi reprovada e preservada. Uma extensão explícita, limitada a 90 s, comparou
`GOGC=500` com `GOMEMLIMIT` de 64 e 96 MiB, selecionou 96 MiB e repetiu essa
configuração seguida do controle padrão. Os resultados dos dois experimentos
permanecem separados. `GOMEMLIMIT` é um limite suave da memória do runtime,
não um limite rígido de RSS. Consulte [o registro completo](GC_ROUND2_TUNING.md).

## Diagnóstico e mudanças

O perfil inicial de `100d6` completo atribuiu 58,7% do espaço alocado a
`recordDieEvent` e seus filhos, 15,4% à criação dos dados e 12,6% à cópia dos
dados resolvidos. Cada evento criava um mapa e encaixotava valores escalares.

| Hipótese | Decisão e efeito |
|---|---|
| E1: eventos tipados | Substitui os mapas da execução por `ResolvedEvent`; journal público continua aceitando mapas. A primeira tentativa reduziu alocações, mas aumentou bytes por crescimento do slice. |
| E2: reserva limitada | Reserva um prefixo conhecido, no máximo 256 eventos, respeitando limites. Evita cópias geométricas de structs grandes. |
| E3: payload opcional | Eventos comuns guardam apenas os campos comuns; modificadores e grupos usam `ResolvedEventDetails`. Os valores são materializados durante a rolagem. |
| E4: JSON em buffer compartilhado | A tentativa no envelope completo regrediu e foi descartada. O refinamento escreve apenas a coleção `ResolvedEvents` em um buffer, mantendo o encoder padrão do envelope. |
| S1: resumo numérico | Executor para pools com modificadores mantém valores, inclusão, classificação e índices. Conta os mesmos eventos e limites sem construir entidades que a API de resumo não retorna. |
| S2: seleção contígua | A primeira tentativa sem vetores intermediários perdeu tempo em duas cargas; o refinamento guarda valor e índice juntos para preservar desempates e reduzir indireções. |
| S3: espaço local limitado | Buffers locais de 32 itens reduzem alocações de pools pequenos; pools maiores crescem normalmente. |
| R1: estado MT preparado | Cache por engine guarda no máximo um estado imutável de 624 palavras, após repetição de uma semente. Cada execução copia o estado e mantém seu próprio orçamento. Fluxos de sementes novas não alocam entradas nesse cache. |
| R2: projeções de sistemas | Fate, Assimilation e Vampire V5 alocam o slice final com o tamanho conhecido, evitando crescimento e cópias. |
| R3: armazenamento de IDs | IDs de pools com pelo menos 32 dados conhecidos usam um `strings.Builder` por rolagem. Strings anteriores permanecem válidas; o buffer nunca é reutilizado ou devolvido a um pool. Pools pequenos conservam a construção individual após a variante inicial regredir. |

## Evidência de componentes

R1 e R2 foram comparados com `a1c4bbb` em duas ordens inversas, com duas amostras
de 100 ms por ordem. Os valores abaixo são medianas das quatro amostras.

| Carga isolada | Antes, µs | Depois, µs | Razão antes/depois |
|---|---:|---:|---:|
| d20 completo, semente repetida, R1 | 9,779 | 6,120 | 1,60× |
| d20 details, semente repetida, R1 | 6,904 | 3,301 | 2,09× |
| d20 summary, semente repetida, R1 | 5,778 | 2,187 | 2,64× |
| Fate completo, R2 | 32,814 | 28,041 | 1,17× |
| Fate compact, R2 | 15,019 | 14,562 | 1,03× |
| Vampire V5 completo, R2 | 25,856 | 25,464 | 1,02× |
| Vampire V5 compact, R2 | 14,831 | 13,205 | 1,12× |

Com sementes alternadas, R1 variou entre 0,97× e 1,02×: não há ganho demonstrado
nesse caso. R2 reduziu Fate em aproximadamente 6,1 KiB e cinco alocações, e
Vampire V5 em 2,9 KiB e quatro alocações por chamada. Diferenças de tempo próximas
de 1× estão dentro da dispersão observada.

O TypeScript de referência já prepara e reutiliza o primeiro bloco MT de uma
semente repetida. R1 mantém o mesmo algoritmo e sequência, sem reaproveitar um
gerador mutável entre requisições. Em R3, guardar um único ID pode reter o chunk
inteiro de strings daquela rolagem; menos alocações não significa retenção mínima
para consumidores que guardem somente um pequeno subconjunto de IDs.

R3 teve resultado misto na confirmação limpa sobre o executor antigo com mapas:

| `100d6`, variante isolada de IDs | Antes, µs | Depois, µs | Alocações antes → depois |
|---|---:|---:|---:|
| full, semente repetida | 96,202 | 114,358 | 1.368 → 1.270 |
| full, sementes alternadas | 107,948 | 115,364 | 1.368 → 1.270 |
| details, semente repetida | 35,160 | 30,299 | 142 → 44 |
| details, sementes alternadas | 25,081 | 22,050 | 142 → 44 |

A escolha mantém a redução de alocações e o ganho de details; não demonstra
melhoria de latência de full atribuível aos IDs. O confronto anterior de R3
teve tempos full próximos de 1×. A avaliação da implementação combinada pertence
às tabelas finais, com eventos tipados e o mesmo contrato em todos os runtimes.

O confronto limpo de resumos confirmou o executor escolhido:

| Carga | Executor geral, µs | Resumo compacto, µs | Alocações antes → depois |
|---|---:|---:|---:|
| Pool de 20 dados | 14,952 | 6,787 | 137 → 10 |
| 100 dados modificados | 42,913 | 15,108 | 320 → 12 |
| Pool com todos os modificadores exercitados | 17,690 | 7,098 | 158 → 13 |

Os nomes exatos das notações, amostras, variantes rejeitadas e hashes estão no
[ledger dos resumos](benchmarks/optimization-round2/compact-summary/LEDGER.md).
Os [logs e manifesto R1–R3](benchmarks/optimization-round2/root/manifest.json)
guardam os confrontos individuais. Uma tentativa de confirmar IDs e um teste
integrado coincidiram com outro benchmark de desenvolvimento; esses tempos
foram descartados e a confirmação foi repetida sem concorrência de benchmarks.
Nos novos logs textuais, espaços ao fim das linhas foram removidos; amostras
numéricas não foram alteradas. O arquivo integral do baseline conserva seus bytes.

## Contrato e validação

Os testes conferem resultados completos e suas projeções, replay, sementes,
limites simultâneos, desempates, sistemas, propriedade de resultados e execução
concorrente. A suíte de resumo compara 42 expressões, dois algoritmos aleatórios
e 16 sementes, além de replay e erros de orçamento. Cobertura é verificada por
contagem exata de statements em todos os arquivos de produção. A integração
passou com **4.531/4.531 statements (100%)** e detector de races em 27,225 s.
`go vet`, formatação, compilação Linux/amd64, typecheck/lint e os seis geradores
de referências TypeScript também passaram. O [perfil de cobertura](benchmarks/optimization-round2/root/final-coverage.txt)
e o [resultado do detector de races](benchmarks/optimization-round2/root/final-race.txt)
estão preservados.

Os eventos tipados têm serialização e desserialização próprias. Casos com
valores zero, `null`, campos omitidos, caracteres escapados, erros de números
inválidos e eventos de grupo são conferidos. Ao trocar a representação, a suíte
detectou uma perda de `groupId` na desserialização usada por engines de sistemas
injetadas; a correção passou na suíte inteira antes da promoção. Nenhuma
referência TypeScript foi alterada.

O [ledger de eventos](benchmarks/optimization-round2/events/LEDGER.md) conserva
as quatro hipóteses e a confirmação: `100d6` completo com sementes alternadas
caiu de 139,128 para 58,473 µs e de 1.368 para 153 alocações no snapshot isolado.
A serialização da coleção caiu de 280,182 para 248,690 µs e de 202 para duas
alocações. São etapas separadas; o benchmark com JSON mede a combinação real.

## Comparações finais

- [17 cargas históricas: Go, Node e Bun](BENCHMARK.md).
- [Lotes de 10.000 chamadas com seis workers](BACKEND_ROUND2_BENCHMARK.md).
- [Construção do resultado e serialização JSON](JSON_BENCHMARK.md).
- [Configuração opcional de GC](GC_ROUND2_TUNING.md).
- [Baseline integral anterior a esta rodada](benchmarks/round2-baseline/manifest.json).

As tabelas de backend medem o tempo do lote e RSS do processo fora do cronômetro.
RSS amostrado não é pico de memória. As diferenças são evidência desta máquina
Windows e destas cargas; não constituem uma promessa de velocidade para toda
expressão, plataforma ou servidor HTTP.
