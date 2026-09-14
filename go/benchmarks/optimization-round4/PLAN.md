# Rodada 4: reduzir os custos restantes

- Base: `8432345`, branch `Go-Version`, árvore inicialmente limpa.
- Skills: `golang-performance`, `golang-benchmark` e
  `benchmark-optimization-loop`, mesmas revisões usadas na rodada 3.
- Alvos: API nativa full/details/summary e resultado completo com JSON padrão.
- Métricas: ns/op, B/op, allocs/op e vazão de lotes com seis workers.
- Contrato: API, resultados, JSON, RNG, sementes, replay, erros, propriedade dos
  resultados e isolamento concorrente; 100% exatos de cobertura de produção.
- Orçamento: até quatro hipóteses de código, até 120 s de comparação por
  hipótese, dez pares alternados. Confirmação integrada até 120 s e comparação
  final com Node/Bun até 300 s. Perfis são diagnósticos separados.
- Revisões de memória, concorrência/JSON e algoritmos/cache em paralelo;
  compilações e medições coordenadas exclusivamente pelo agente principal.
- Promover somente melhorias demonstradas sem regressão material nos controles
  ou falha de contrato; guardar também candidatos rejeitados e resultados nulos.
- Sem alteração de GC global, nova dependência de produção ou mudança no
  trabalho exigido de Go/TypeScript para favorecer o comparativo.

Esta rodada mantém os relatórios anteriores como históricos e mede novamente
o baseline na mesma máquina, sessão, compilador e configuração do candidato.

Após o pedido adicional de novos benchmarks e comparação, a confirmação também
inclui a API nativa contra Node/Bun: nove cargas, os mesmos seis workers e seis
configurações, com orçamento próprio de até 300 s. A série JSON continua separada;
as duas medem operações diferentes e não são misturadas em um placar único.
