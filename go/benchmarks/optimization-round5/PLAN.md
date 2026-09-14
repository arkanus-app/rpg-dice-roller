# Rodada 5: serialização nativa para o backend

- Baseline: `cecb59b`; API de rolagem e resultados preservados.
- Métrica principal: resultado full construído e serializado em bytes novos por
  chamada. Comparar JSON.stringify em Node/Bun, encoding/json.Marshal em Go e
  serializer direto Go, com GC padrão e configuração GC500/96MiB publicada.
- Hipótese principal: encoder tipado independente evita reflexão e revalidação
  do próprio JSON. Funções aditivas MarshalJSON/AppendJSON; os métodos e o
  comportamento de encoding/json permanecem disponíveis e inalterados.
- Fallback do objeto completo para campos dinâmicos, callbacks ou eventos
  legados; mesma saída byte a byte e mesmos erros que a biblioteca padrão.
- Gates: cobertura exata de produção 100%, paridade TypeScript, race, vet,
  testes diferenciais de mutações/ciclos/callbacks/Unicode/números e fuzzing.
- Orçamento: até três hipóteses (encoder direto, reserva de buffer, scratch
  privado se necessário), até 120 s por comparação com dez pares alternados;
  comparação principal e holdout com no máximo 300 s cada.
- Holdout inclui expressões maiores, modificadores, grupos e texto Unicode.
- Perfis separados da medição. Apenas o agente principal executa benchmarks;
  agentes auxiliares revisam contratos e preparam testes/harness em paralelo.
- Não cachear resultados ou JSON, não mudar RNG/GC global, não alterar resultados
  para reduzir bytes. Não usar buffers retornados em pool privado.

O ganho do serializer direto será identificado explicitamente como exigindo a
chamada dicecore.MarshalJSON. Não será atribuído a encoding/json.Marshal.
