# Rodada 3: revisão guiada por skills Go

- Base: `ca34ff9`, branch `Go-Version`; árvore inicialmente limpa.
- Skills selecionadas: `golang-performance` e `golang-benchmark`, versão 1.3.2,
  repositório https://github.com/samber/cc-skills-golang, revisão
  `19a0626ae8565d27a7b7bdf59d8d99d94d7e284c`, licença MIT.
- Instalação: diretórios completos em `~/.codex/skills`, usando o instalador
  oficial local e revisão fixa. Apenas instruções e referências são aplicadas;
  exemplos e estimativas genéricas não contam como evidência do projeto.
- Operação principal: resultado completo e `encoding/json.Marshal`; diagnóstico
  separado de codificação de resultados já construídos.
- Métricas: ns/op, B/op, allocs/op, throughput de lotes e RSS amostrado.
- Regras: mesmos resultados e API, fixtures TypeScript intactas, cobertura Go
  exatamente 100%, race detector e vet aprovados. Nenhuma dependência de
  produção, alteração global de GC ou substituição do RNG planejada.
- Orçamento: no máximo três hipóteses de código, até 90 segundos de medição
  por variante; confirmação alternada baseline/candidato com ao menos seis
  amostras por lado. Comparação final de runtimes até cinco minutos.
- Execução sequencial de medições nesta máquina. Agente auxiliar faz auditoria
  de código sem disputar CPU com benchmarks. Perfis não entram nos tempos
  usados para afirmar ganho. Resultados negativos permanecem no registro.
- Critério de promoção: melhoria repetida no alvo, sem regressão de contrato,
  cobertura, alocações ou desempenho material nos controles relevantes.

Os dados da segunda rodada permanecem históricos. Esta rodada tem diretório,
manifestos e relatório próprios; configurações de GC serão explicitadas,
sem reaproveitar a confirmação antiga como se tivesse validado código novo.

## Extensão após a solicitação explícita da skill

O usuário reiterou o pedido de aplicar `golang-performance` e ampliar a revisão.
Após as três hipóteses iniciais, a revisão arquitetural foi dividida entre
alocações, concorrência e algoritmos/cache. Duas hipóteses adicionais, ambas
sustentadas pelo perfil de alocações, recebem o mesmo teto de 90 s por comparação:
reserva limitada dos índices privados de dados e construção direta do texto.
Medições continuam sequenciais; variantes são editadas em worktrees isolados.
Mudanças em locks/cache e representação pública ficam fora desta extensão,
pois requerem evidência e análise de contratos adicionais.
