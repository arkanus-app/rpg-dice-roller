# Rodada 6: Go versus Node

Base: `f107265`. Bun deixa de ser alvo desta rodada.

- Operação principal: rolagem full seguida por `dicecore.MarshalJSON`, com
  sementes variando; preservar resultados, replay, erros e propriedade dos dados.
- Meta: reduzir custo de CPU e alocação no GC padrão sem alterar o GC global na
  biblioteca, mantendo os ganhos com configuração explícita do processo.
- Medir separadamente vazão, tempo dos lotes, latência de chamadas quando houver
  medição individual e RSS observado. Não interpretar quartis de lotes como p95.
- Examinar concorrência de 1 e 6 workers; comparar Node e Go antes/depois com
  o mesmo trabalho, incluindo o encoder explícito e suas condições de uso.
- Até quatro hipóteses de código, 120 s por comparação isolada, dez pares
  alternados; confrontos de runtime limitados a 360 s por conjunto.
- As nove expressões da rodada 5 são regressão conhecida, não holdout novo.
  Reservar entradas adicionais para confirmação sem orientar a seleção.
- Gates: cobertura exata 100%, oráculos TypeScript, JSON byte a byte, posse dos
  resultados, erros e concorrência. Nunca reciclar memória ainda entregue ao
  usuário nem adaptar resultados para vencer uma medição.
- Perfis e benchmarks executados sequencialmente; revisão de arquitetura e
  preparação dos testes podem ocorrer em paralelo.

Vencer todos os cenários testados é um alvo mensurável. Vencer em todo hardware,
entrada e aspecto possível não pode ser demonstrado por um conjunto finito de
benchmarks. Relatar perdas e limites, preservando todas as tentativas.

## Ajuste do orçamento de confirmação

O primeiro ensaio com QPC concluiu nove dos dez processos, mas atingiu 360 s
durante o último processo Node. A tentativa foi preservada em
[failed-wall-budget](failed-wall-budget/README.md) e excluída das conclusões.
O orçamento da confirmação completa foi ampliado uma vez para **540 s por
invocação**, preservando todas as cargas, amostras, ordens e binários. Não foi
ampliada a busca de variantes de produção: continuam sendo quatro hipóteses.
