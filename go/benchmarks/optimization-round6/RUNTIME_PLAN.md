# Confirmação de configuração para latência

A comparação principal terminou: com seis workers, Go atual em
GOMAXPROCS=12/GOGC=500/GOMEMLIMIT=96MiB venceu Node nas 11 expressões em vazão,
CPU/op, RSS e p50, mas apenas cinco em p95. Portanto, esse perfil ainda não
atende ao objetivo de vencer todas as métricas observadas.

Sem alterar a biblioteca, seus binários, a API ou os resultados, executar uma
única rodada exploratória com Node, o perfil Go de controle acima e até três
perfis novos, definidos antes da execução:

| Perfil | GOMAXPROCS | GOGC | GOMEMLIMIT |
|---|---:|---:|---:|
| Controle | 12 | 500 | 96MiB |
| Limitar paralelismo do runtime | 6 | 500 | 96MiB |
| GC menos frequente, mais memória | 6 | 1500 | 192MiB |
| GC ainda menos frequente, mais memória | 6 | 3000 | 256MiB |

Métrica principal: p95 individual. Guardrails: vazão, CPU/op, p50 e RSS versus Node,
com as 11 expressões preservadas e a mesma propriedade dos resultados/JSON.
Os perfis maiores assumem explicitamente uma troca de memória por latência;
GOMEMLIMIT é flexível e não é limite rígido de RSS. Comparar os perfis completos
não permite atribuir seus efeitos somente a GOGC ou somente ao orçamento.

Critério de adoção desta rodada: preferir o perfil com menor limite de memória
entre os que superarem Node nas cinco métricas em todas as 11 expressões.
Empates no limite usam a menor soma dos RSS medianos. Se nenhum atender a esse
critério, documentar o que ainda perde, sem declarar vitória integral.

Mesmos parâmetros da confirmação principal: seis workers, uma engine por
worker, MT19937, seeds variando, cache aquecido, full + JSON, 4.096 chamadas por
lote, três lotes, 2.048 latências em passagem separada, duas ordens invertidas.
Preflight integral e digests exatos são obrigatórios. Teto: 540 segundos para
o conjunto; execução serial, sem outros testes, builds ou perfis concorrentes.

Todos os perfis e perdas permanecem publicados; nenhum ajuste por expressão.
As 11 cargas fazem parte da seleção do perfil de runtime. Os dois holdouts
iniciais continuam sendo holdouts da seleção de código, mas esta etapa não
os apresenta como entradas inéditas para escolha de configuração.

Esta extensão não reabre a busca de código da biblioteca: foram mantidas duas
das quatro hipóteses de implementação, cuja confirmação original permanece
intacta. O script e os arquivos desse novo ensaio usam nomes separados.

## Diagnóstico anterior ao novo ensaio

Um worker instrumentado com `GODEBUG=gctrace=1` em `40d10>=7f=1`, no perfil
de controle, registrou **62 ciclos de GC** durante aquecimento, um lote de
4.096 chamadas e 2.048 chamadas individuais. O heap alvo aparece muitas vezes
perto de 20 MiB, apesar do limite flexível de 96MiB. Isso motivou testar menor
frequência de GC, sem demonstrar sozinho causalidade para cada cauda de
latência. Os tempos internos do trace também usam o relógio do runtime no
Windows e não substituem o QPC do benchmark.

[Trace](latency-control-gctrace.txt) e
[requisição/resposta instrumentadas](latency-control-profile.json). Esse
diagnóstico não contribui para as tabelas de desempenho.
