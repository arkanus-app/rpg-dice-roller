# Ensaio interrompido pelo timer

A primeira invocação de um worker foi interrompida pela validação de durações
individuais estritamente positivas. `time.Now`/`time.Since` no binário Go
Windows retornaram zero para 2.031 das 2.048 chamadas d20 do primeiro processo
Go, indicando resolução insuficiente para medir essas chamadas. Node tinha
concluído uma rodada e Go anterior/GC100 tinha concluído sua primeira rodada;
as outras séries não foram executadas.

O JSON mantém `status: failed`, erro, amostras e hashes originais. Esta tentativa
não contribui para as tabelas ou gráficos finais. Não foram removidos zeros
nem imputadas latências. O timer do harness foi substituído por
`QueryPerformanceCounter` no Windows para medir diferenças de ticks, com
frequência consultada antes dos timers; a chamada completa foi repetida para
todos os runtimes. A biblioteca de produção não foi alterada por essa correção.

Os microbenchmarks anteriores usam lotes de aproximadamente 100 ms pelo
framework de testes Go; a resolução observada tem impacto relativo muito menor
nesses lotes, mas ainda compõe a incerteza das medições curtas. Os novos
confrontos usam o contador de alta resolução tanto nos lotes como nas chamadas
individuais. A frequência nominal não é uma garantia de acurácia da latência.
