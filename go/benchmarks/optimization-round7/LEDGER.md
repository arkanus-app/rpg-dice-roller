# Rodada 7 — registro de medição

Base: `bb82246`, branch `Go-Version`, árvore inicialmente limpa. Foco: JSON
tipado e rolagem full + JSON, sem mudar a API nem configurar o GC da biblioteca.
Até três hipóteses sequenciais; até 120 segundos por comparação e 25 minutos
de investigação após a preparação. Cada hipótese altera um mecanismo.

Gate: suíte Go completa, igualdade com encoding/json, replay e fixtures
existentes, vet, detector de races e cobertura exata de 100% dos statements.
Métricas: ns/op, B/op e allocs/op. Dez pares A/B alternados, medidos serialmente,
Go 1.26.2, Windows/amd64, Ryzen 5 5500, GOMAXPROCS=1, GOGC=100,
GOMEMLIMIT=off. Compilação e profiling fora da medição.

O perfil inicial de 100d6/full com encoder direto encontrou 17,47% de CPU
própria em appendEventString, 8,33% em eventJSON.number e 11,56% em memmove.
O benchmark instrumentado deu 33.668 ns/op, 57.344 B/op e uma alocação;
esse valor serve para diagnóstico, não para afirmar ganho.

## Hipóteses

| Variante | Hipótese | Resultado | Decisão |
|---|---|---|---|
| H1 — dígitos | Escrever diretamente os inteiros 0–9 | JSON de 100d6/full: −13,76%; details: −19,06%; d20/full: −8,76%. Chamada completa sem diferença significativa no ensaio exploratório. | Aceita para o encoder, confirmada novamente na combinação final. |
| H2 — ASCII por índice | Classificar quatro bytes com uma operação AND | Nenhuma das nove projeções apresentou ganho significativo. O diagnóstico do compilador ainda apontou checks de limites em cada acesso do bloco. | Rejeitada. |
| H3 — ASCII por substring | Manter uma substring restante de pelo menos quatro bytes, permitindo eliminar os checks dos quatro acessos | JSON de 100d6/full: −9,08% versus H1 (p=0,019); outras projeções sem diferença significativa. | Aceita, confirmada novamente na combinação final. |

H2 e H3 foram comparadas contra H1, a variante aceita até então. Não são
comparações contra o código original. As três rodadas exploratórias e a
primeira medição da chamada completa usam 100 ms por benchmark.

Fontes intermediárias preservadas em `sources/`; resultados brutos, hashes dos
binários, ordem de execução e tempos constam dos JSONs por experimento. Os
arquivos `*-benchstat.txt` contêm os testes estatísticos completos.

## Confirmação

`final-json` compara a base original com H1 + H3, em dez pares alternados,
300 ms por benchmark. Reduções significativas: d20/full 12,01%;
100d6/details 20,29%; 100d6/full 15,52%; pool/details 16,79%; pool/full 16,10%.
As quatro outras projeções não tiveram diferença significativa. As nove
mantiveram exatamente os bytes alocados e uma alocação por serialização.
Não somar os ganhos das hipóteses: a combinação foi medida diretamente.

`final-pipeline` usa 500 ms por benchmark e sete expressões, incluindo quatro
expressões que não participaram da escolha das variantes. 100d6/full + JSON
caiu 15,02% (69,55 → 59,11 µs; p=0,029), e o pool caiu 6,81%
(40,28 → 37,53 µs; p=0,043). Outras expressões sem diferença significativa,
com alocações iguais e nenhuma diferença significativa em B/op.

Validação final: 4.830/4.830 statements, vet, races e 17.030 execuções de
fuzzing passaram. A mudança fica limitada a H1 + H3. Não há nova hipótese
após esta confirmação.

P-valores por comparação, sem correção para testes múltiplos. Há dispersão
relevante nesta máquina compartilhada; resultados sem significância não são
contados como ganhos nem como regressões confirmadas.
