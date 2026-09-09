# Melhorias de desempenho aplicadas

Implementação baseada na investigação de 2026-09-09, comparada com a revisão `ac3febe` da versão 3.7.1. A API pública e os algoritmos de aleatoriedade permanecem os mesmos.

## Mudanças

- O engine reutiliza limites já resolvidos ao buscar strings e planos externos no cache. A parte da chave referente aos limites padrão é calculada uma vez por engine.
- O compilador determina uma vez a elegibilidade do resumo rápido. Pools que são a expressão raiz, com um único modificador `min`, `max`, `keep`, `drop` ou target, usam arrays numéricos em vez de dados, grupos e eventos completos. Também funciona com repetição `N#`. Expressões compostas e múltiplos modificadores continuam no executor geral.
- `kh1`, `kl1`, `dh1` e `dl1` usam busca linear no resumo. Selecionar o pool inteiro dispensa ordenação. Os demais casos ordenam valores numéricos.
- A seleção no executor geral usa diretamente intervalos da lista ordenada, dispensando o `Set` e a filtragem de pertencimento, com a mesma ordem de desempate e eventos.
- O replay é validado uma vez no contexto, que restaura descritor e seed juntos. Uma cópia captura os campos externos uma vez e impede alterações por getters entre a validação e a inicialização. Não há cache de descritores externos.
- O build de declarações conserva apenas os arquivos alcançáveis pelos pontos de entrada públicos. Dependências de tipos são identificadas pelo preprocessador do TypeScript; declarações ESM e CJS continuam disponíveis.

## Comparação alternada dos builds

Windows, Node 24.18.0, Intel Core i5-11400H. O build original foi reconstruído de `ac3febe` em um diretório temporário, usando as mesmas dependências instaladas. Os dois builds ESM minificados foram executados no mesmo processo, com aquecimento, sete amostras e ordem antes/depois alternada. O fator abaixo é a mediana das razões de tempo de cada par; maior é melhor.

| Cenário | Ganho |
| --- | ---: |
| `1d20`, summary, string em cache, MT19937 e seed fixa | 1,18× |
| `1d20`, summary, string em cache, Xoshiro e seed fixa | 1,25× |
| `1d20`, summary, replay MT19937 | 1,60× |
| `10000d20kh1`, summary | 3,66× |
| `10000d20kh5000`, summary | 2,06× |
| `10000d20>=10`, summary | 2,16× |

Nem todos os cenários ficaram mais rápidos: o resumo de `1d20` com plano compilado, MT19937 e seed fixa mediu **0,92×**, aproximadamente 9% mais tempo. Com seeds diferentes, o mesmo caminho mediu 1,04×. Esse custo no microcaso de repetição determinística é uma limitação observada, não uma melhoria. `details` com target ficou em 0,99×, enquanto `details` com `kh5000` mediu 1,12×. Não há promessa de ganho universal.

Os pools grandes usam 25 iterações por amostra no modo comparativo; casos pequenos usam 5.000 ou 10.000. A execução individual usa 100 iterações nos pools grandes. A tabela prioriza a comparação alternada por reduzir o efeito da variação temporal da máquina. Não são medições em browsers.

Dados brutos locais: `.artifacts/performance/paired-final.json` (comparação alternada final), `investigation.json` (diagnóstico original) e `benchmark-final.json` (suíte existente).

## Validação e tamanho

- 1.412 testes aprovados, incluindo 35 novos casos parametrizados e verificações diferenciais de seeds, algoritmos, empates, fallback, replays externos e limites simultâneos.
- 3.960 comparações diretas com o build original: JSON idêntico byte a byte em 22 fórmulas, 30 seeds, dois algoritmos e três modos de resultado. A ordem dos campos do resumo também foi preservada.
- 96,27% de cobertura de linhas na suíte completa.
- Build, typechecks e lint aprovados.
- Verificação do pacote aprovada, incluindo instalação do tarball, consumo ESM/CJS e resolução dos tipos públicos.
- Pacote final: **88.479 bytes compactados**, **336.071 bytes descompactados**.
- Grafos ESM em gzip: **30.465 bytes** na entrada principal e **23.551 bytes** no core, dentro dos limites de publicação (30 KiB e 23 KiB). O core está muito próximo desse limite.

O benchmark de desempenho ainda termina com exit code 1 exclusivamente por limites de bundle mais restritos (28 KiB e 21 KiB), que já falhavam antes. Os critérios de tempo passaram. Os grafos JavaScript cresceram aproximadamente 0,55 KiB com os caminhos especializados; a redução de declarações evita aumentar o pacote publicado. Nenhum limite foi elevado para acomodar a alteração. A meta de reduzir os grafos abaixo de 28/21 KiB permanece pendente.

## Reprodução

```powershell
npm run build
npm run test:coverage:run
npm run package:verify
node --expose-gc --import tsx scripts/investigate-performance.ts
# Opcional: alternar com um build independente anterior.
node --expose-gc --import tsx scripts/investigate-performance.ts C:/caminho/baseline/dist/core.js
node --expose-gc --import tsx scripts/benchmark.ts --json
```

O baseline deve ser construído com as mesmas dependências e versão de Node. Evite executar builds ou testes junto com os benchmarks.
