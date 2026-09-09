# Devlog do @erpg/dicecore V3

Este registro resume as decisões de engenharia da V3. Ele descreve o estado do repositório e não anuncia publicação ou tag.

## Objetivo

A V2 oferecia uma fachada útil ao ERPG, mas ainda reconstruía metadados depois da rolagem, expunha snapshots com `unknown[]` e dependia de parser e runtime herdados. A V3 move compilação, execução, grupos, segurança e replay para um único núcleo fortemente tipado.

As invariantes definidas foram:

1. a fórmula é compilada uma vez e o mesmo plano governa custo e execução;
2. cada execução possui RNG, orçamento e journal próprios;
3. o resultado público não expõe AST, classes internas, `Map`, `Set` ou `unknown[]`;
4. o dice3dview apresenta o resultado, mas não decide regras;
5. a compatibilidade histórica é preservada por resultados de referência fixos, sem depender do runtime V2.

## Toolchain TypeScript

Runtime V3, testes, benchmark e scripts de pacote foram escritos em TypeScript. O perfil estrito inclui verificações como `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `verbatimModuleSyntax` e `isolatedModules`.

Jest e Babel foram substituídos por Vitest. O lint usa configuração flat e análise type-aware. Rollup gera ESM e CommonJS, enquanto o TypeScript emite as declarações. `publint`, Are the Types Wrong e fixtures consumidoras verificam o tarball.

`dist/` é um produto reproduzível do build e fica fora do Git. O pacote preparado inclui apenas o necessário para consumo. A V3 não declara dependências de runtime. `random-js`, usado exclusivamente pelo legado, foi removido também das dependências de desenvolvimento.

## Compilador próprio

O parser publicado da V3 não usa Peggy nem o JavaScript gerado da V2. Um scanner TypeScript produz tokens com spans e um parser Pratt/recursive descent constrói uma AST com unions discriminadas.

O compilador:

- aplica a normalização amigável do ERPG;
- separa comentário e prefixo `N#`;
- valida quantidade, lados, profundidade e número de nós;
- calcula dados estáticos e pior caso de geração/chamadas aleatórias;
- produz `RollPlanGroup` com IDs derivados do tipo e da posição do nó;
- guarda a AST executável fora do DTO público.

O `RollPlan` público é imutável e JSON-safe. A AST permanece associada em memória ao compilador; quando um plano é clonado ou desserializado, o engine valida seus campos públicos e recompila `input` antes de executar. Assim o DTO atravessa processos sem expor a AST e sem confiar em um plano estruturalmente adulterado.

## Runtime e replay

Cada chamada cria um `ExecutionContext` com orçamento, `ExecutionJournal` e MT19937 próprios. Isso remove a troca temporária de um gerador singleton e deixa execuções reentrantes e isoladas.

Seeds de número e texto são canonicalizadas em domínios diferentes. Sem seed, quatro palavras de 32 bits vêm de `globalThis.crypto.getRandomValues`; a ausência da API gera `RNG_UNAVAILABLE`, sem fallback inseguro.

Todo resultado recebe um `ReplayDescriptor` com seed canônica, origem, algoritmo `mt19937` e versão `1`. O descritor pode ser passado em `roll(..., { replay })` para restaurar exatamente o material do gerador, inclusive quando a origem foi crypto. `seed` e `replay` não podem ser combinados. Descritores com versão desconhecida ou estrutura inválida falham de forma explícita.

## Limites em duas camadas

A compilação rejeita entradas, ASTs, multi-roll e quantidades iniciais fora dos tetos. Ela também informa o custo estimado no plano. O executor consome orçamentos reais para dados gerados, chamadas aleatórias e eventos, impedindo que combinações de explode, reroll e unique ultrapassem os limites em runtime.

Engines possuem tetos imutáveis. Uma chamada pode reduzir esses valores para um contexto mais restrito, mas nunca aumentá-los. Isso permite que backend e frontend compartilhem a biblioteca sem abrir exceções acidentais à política do processo.

## DTO e causalidade

`DiceRollResult` separa três visões complementares:

- `dice` descreve o estado final: face inicial, valor final, contribuição, inclusão e estados;
- `groups` descreve expressões já resolvidas, com valor, span e IDs dos filhos;
- `events` descreve a cronologia real, incluindo transições de reroll e relações de explosão.

`parentDieId` liga dados gerados à sua causa. `sourceNodeId` identifica um trecho compilado e se repete entre as entradas de multi-roll; `id` identifica cada resolução concreta. Pools usam `null` sem target e um resumo numérico quando há classificação.

Esse contrato elimina a reconstrução de grupos pelo frontend e a segunda avaliação com `mathjs`. O adaptador 3D pode animar `events` e usar `included`/`contribution` para a apresentação final.

## Compatibilidade V2

A migração interna foi encerrada em 2026-09-09. Antes da remoção, V2 e V3 foram executadas contra o mesmo corpus de 31 notações e duas seeds, totalizando 62 resultados esperados. Esse corpus permanece em `tests/fixtures/v3-compatibility-corpus.ts`, sem regeneração a partir do motor atual. `src/v3/compatibility-golden.test.ts` mantém a verificação de normalização, totais, valores dos dados e pools sem executar a V2.

O runtime, parser gerado, gramática, testes exclusivos e templates de documentação da V2 foram removidos. O build, lint e typecheck agora usam apenas o código atual. O histórico da V2 continua disponível no Git e o guia de migração permanece útil para consumidores antigos.

Diferenças intencionais da V3 incluem:

- DTO incompatível, porém totalmente tipado;
- eventos causais em vez de eventos inferidos do estado final;
- limites especializados no lugar de `maxDice`;
- pool ausente representado por `null`;
- replay com algoritmo e versão;
- planos compilados reutilizáveis e planos JSON-safe restauráveis com validação no engine de destino.

A retirada do legado não muda a API pública nem as regras da V3: o código antigo já não fazia parte do pacote publicado.

## Estado de entrega

A V3 está implementada no repositório com fachada, parser, compilador, runtime, DTOs e testes TypeScript. A linha 3.5 acrescenta projeções `details` e `compact`, entrypoints modulares, um `SystemRoller` vinculado ao engine e presets explícitos de segurança. O pipeline prepara ESM/CJS e declarações a partir de `dist/`, além de executar validações de tipos, lint, cobertura, replay cruzado, benchmark e integridade do pacote.

As migrações de código dos consumidores ERPG acompanham esta implementação. A publicação no npm, a criação da tag correspondente e a atualização dos lockfiles consumidores contra o artefato imutável continuam como passos de release separados e não são presumidos por este devlog. O roteiro dos consumidores está em [docs/MIGRATION_V3.md](docs/MIGRATION_V3.md).
