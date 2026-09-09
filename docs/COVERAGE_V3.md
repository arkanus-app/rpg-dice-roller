# Cobertura da V3

Verificação local em 2026-09-09, com Node 24.18.0 e Vitest/V8.

| Métrica | Antes | Depois |
| --- | ---: | ---: |
| Linhas | 96,20% | 100% (2.848/2.848) |
| Instruções | 96,31% | 100% (2.944/2.944) |
| Funções | 100% | 100% (436/436) |
| Branches | 90,99% | 100% (2.167/2.167) |
| Testes | 411 | 548 |

Os comandos `npm run test:coverage` e `npm run test:coverage:v3` exigem agora
100% nas quatro métricas **por arquivo**, incluindo todo `src/v3/**/*.ts`.
Somente os próprios arquivos de teste ficam fora da instrumentação; não foram
adicionadas exclusões de código de produção nem diretivas para ignorar cobertura.

## Casos adicionados

- Opções de consumidores JavaScript com tipos inválidos, proxies revogados e
  getters que lançam exceções; planos externos malformados e limites mais baixos
  aplicados a planos já compilados.
- Fontes criptográficas indisponíveis, descritores de replay inválidos e replay
  misto com entradas ausentes, arrays esparsos ou falha na enumeração.
- Limites compartilhados de análise semântica, saturação de custos, argumentos
  não constantes, overflow e interações de explosão, reroll e unicidade.
- Paridade entre resultados completos, detalhes e resumos para expressões,
  ordenação, exclusões sobrepostas e grupos aninhados.
- Contratos de engines personalizadas: faces e dados incompatíveis, ausência de
  dados de dualidade e orçamento agregado da notação mista.
- Falhas inesperadas das dependências do compilador, com mocks isolados, e
  pipelines internos corrompidos, sem modificar as expectativas de compatibilidade.
- Todos os prefixos truncados de notações com funções, grupos, modificadores e
  comparações, verificando os erros e offsets no final da entrada.

## Simplificações internas

O parser passou a preservar o tipo do token validado por `expect`. Travessias
terminam pelo resultado de `pop`, eliminando a segunda checagem de uma pilha já
verificada. O executor expressa no tipo que toda avaliação possui um grupo e que
cada modo retorna um resultado específico. Leituras de arrays internos densos e
buffers de tamanho fixo usam as invariantes de construção.

Isso remove caminhos redundantes que não eram alcançáveis por entradas do usuário.
As validações das entradas públicas e os limites de execução continuam testados.
Os totais de instruções, branches e funções mudaram por essas simplificações.

## Validação

- `npm run test:coverage`: typechecks, lint e 548 testes passaram com 100% por arquivo.
- `npm run test:coverage:v3`: os mesmos 548 testes e exigências passaram.
- `npm run build:bundle`, `npm run build:declaration` e `npm run package:verify`:
  build, declarações, exports e consumidores ESM/CommonJS passaram.
- A suíte adicional `npm run test:browser` não iniciou: falta o executável
  Chromium headless da versão instalada do Playwright. Os números acima são
  da suíte Node/V8, não de uma execução em navegador.
- Comparação adicional contra o build independente do commit `ac3febe`: 6.840
  resultados de rolagem, com dois RNGs e três modos, e 5.000 inspeções de entradas
  geradas produziram JSON idêntico. Essa comparação é uma verificação adicional
  local; os testes permanentes usam referências fixas e não dependem do build antigo.

O pacote verificado tem 87.599 bytes compactado; o core ESM com gzip tem 23.099
bytes, dentro do limite existente de 23 KiB.

Cobertura de 100% comprova que os caminhos instrumentados foram exercitados;
não constitui prova de ausência de bugs. As referências de compatibilidade,
testes de propriedades e limites continuam complementando essa métrica.
