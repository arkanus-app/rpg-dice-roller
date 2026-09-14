# Experimentos da rodada 6

Plano registrado em [PLAN.md](PLAN.md), base `f107265`. Quatro hipóteses,
comparações seriais, dez pares alternados A/B, `-benchtime=100ms`,
`GOMAXPROCS=1`, `GOGC=100`, `GOMEMLIMIT=off`. Cada comparação tem limite de
120 segundos; compilação e profiling ficam fora da medição. As variantes são
comparadas individualmente à base, e a combinação aceita é confirmada depois.
Os ganhos de experimentos distintos não são somados.

## Perfil que orientou as hipóteses

Rolagem full de `100d6` e encoder direto, seis workers, GOMAXPROCS=12 e GC100.
O perfil de alocação atribuiu aproximadamente 46% dos bytes ao crescimento do
buffer JSON, 24% à execução geral, 13% à finalização dos dados e 10% à criação
dos dados temporários. O perfil de CPU apontou escrita de strings/chaves,
barreiras de escrita e trabalho do GC. Amostras de espera do runtime no Windows
também aparecem: não interpretar esse perfil como medição exata de CPU/op.

[CPU](profile-cpu.txt), [alocações](profile-alloc.txt),
[resposta do worker](profile-pipeline-output.txt); perfis pprof no mesmo diretório.

## H1 — arena privada de dados temporários — rejeitada

Uma arena por engine, aquisição atômica e retenção limitada a 256 dados,
limpeza após finalização/erro, sem reaproveitar memória pertencente ao resultado
público. Reduziu B/op em `100d6` full/details, mas a variável de estado capturada
pelo defer passou ao heap. O número de alocações não caiu e d20 alocou mais.
Pool/details ficou **13,20% mais lento** (p=0,007, n=10).

[Dados antes](h1-arena-before.txt), [depois](h1-arena-after.txt),
[benchstat](h1-arena-benchstat.txt), [execução e hashes](h1-arena.json).
Suíte da variante: 4.821/4.821 statements cobertos.

## H2 — tabela de classificação ASCII — aceita

Substitui várias comparações por byte por uma consulta a tabela privada de
256 posições. As strings atuais continuam sendo lidas integralmente; caminhos
Unicode, escapes e UTF-8 inválido preservam a codificação padrão. O byte 0x7F
continua seguro, como em `encoding/json`.

Serialização de `100d6` full **14,95% mais rápida** (p=0,043); pool/details
**20,43%** (p=0,015). Bytes e alocações inalterados nas nove projeções.

[Dados antes](h2-strings-before.txt), [depois](h2-strings-after.txt),
[benchstat](h2-strings-benchstat.txt), [execução e hashes](h2-strings.json).
Suíte da variante: 4.804/4.804 statements cobertos.

## H3 — escrita local do envelope JSON dos dados — aceita

Escreve as chaves fixas diretamente em um slice local, reduzindo chamadas
genéricas e atualizações do ponteiro do escritor. Lê todos os valores do
resultado atual, sem cache de JSON. A conversão numérica e o fallback de erros
continuam usando os caminhos já validados.

Serialização de `100d6` full **31,20% mais rápida**, details **47,38%**;
pool/full **15,99%** (todos p<0,001). Bytes e alocações inalterados.

[Dados antes](h3-envelope-before.txt), [depois](h3-envelope-after.txt),
[benchstat](h3-envelope-benchstat.txt), [execução e hashes](h3-envelope.json).
Testes direcionados passaram antes da medição; suíte completa e testes novos
de envelope foram executados na combinação final.

## H4 — arena com estado mantido na pilha — rejeitada

Corrige o escape introduzido em H1 usando estado local e defer sobre esse
estado. Eliminou uma alocação e reduziu B/op em full/details, mas pool/full
ficou **8,58% mais lento** (p=0,015), e pool/details **12,80% mais lento**
(p<0,001). A economia de bytes não compensou a regressão de tempo no conjunto.

[Dados antes](h4-arena-stack-before.txt), [depois](h4-arena-stack-after.txt),
[benchstat](h4-arena-stack-benchstat.txt), [execução e hashes](h4-arena-stack.json).
Suíte da variante: 4.819/4.819 statements cobertos.

## Confirmação H2 + H3

Com os mesmos workers de benchmark compilados em Go anterior/atual,
a serialização full caiu **19,19% em d20**, **32,62% em 100d6** e **28,18% no
pool**. Em details, 100d6 caiu **51,22%** e pool **41,55%**. Sete das nove
projeções tiveram redução significativa segundo benchstat; as outras duas
não apresentaram diferença significativa. Bytes e alocações permaneceram
iguais, com um buffer próprio por serialização.

[Dados antes](final-json-before.txt), [depois](final-json-after.txt),
[benchstat](final-json-benchstat.txt), [execução e hashes](final-json.json).
Esses microbenchmarks serializam resultados já construídos. Os confrontos
Node medem a rolagem completa seguida de serialização e têm outro regime de
concorrência. Não extrapolar as reduções acima à chamada inteira.

P-valores são por comparação, sem correção para testes múltiplos; não são uma
garantia de repetição dos percentuais. A dispersão consta dos arquivos de
benchstat. [Validação final](VALIDATION.md).
