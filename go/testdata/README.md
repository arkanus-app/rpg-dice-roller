# Referências TypeScript

Os arquivos registram o comportamento de `@erpg/dicecore` 3.7.1, fonte
`1940044`. Os geradores usam o TypeScript e o corpus histórico, independentemente
da implementação Go. Sementes são fixas e os arquivos não têm timestamps.

Na raiz do repositório, com Node 24.18.0 e as dependências de desenvolvimento:

```sh
npm run build
node scripts/generate-go-fixtures.mjs --check
node scripts/generate-go-compiler-fixtures.mjs --check
node scripts/generate-go-executor-fixtures.mjs --check
node scripts/generate-go-engine-fixtures.mjs --check
node scripts/generate-go-system-fixtures.mjs --check
# Regeneração matemática: Windows, mesma versão Node/V8 da provenance.
node scripts/generate-go-math-conformance.mjs --check
```

`--check` recalcula e compara os bytes sem reescrever os arquivos. Para atualizar
deliberadamente uma referência, remova essa opção. Faça o build antes: alguns
geradores usam `dist` e outros importam internos TypeScript via `tsx/esm/api`.

| Arquivo | Contrato |
| --- | --- |
| `normalization.json` | Texto normalizado, comentários, contagem e parsing da entrada |
| `parser.json` | AST completa, IDs, modificadores, spans UTF-16 e erros |
| `math.json` | Decimal12, operadores, funções, comparações, arredondamento e não finitos |
| `math-transcendental.json` | Oito regressões trigonométricas obrigatórias, sem opt-in ou skips |
| `math-conformance.json` | Sin/cos/tan/exp/log/pow: fronteiras, subnormais, grandes argumentos e amostragem determinística; igualdade de bits |
| `rng.json`, `seeds.json` | MT19937/Xoshiro, rejeições, draws, material e hashing UTF-16 |
| `replay.json` | Descritores, validação e restauração de sementes |
| `limits.json`, `budget.json` | Presets, overrides, operações aceitas/rejeitadas e estado posterior |
| `compiler.json` | Planos, AST/IR, constantes, custos, semântica, inspeção e erros |
| `executor.json` | Execução de modificadores e projeções full/details/summary |
| `engine.json` | Sequências de chamadas, opções, caches, planos externos e replay |
| `systems-rolls.json` | Resultados/erros de sistemas e rolagens mistas |
| `systems-contracts.json` | Contratos dos adapters com a engine |
| `systems-selection.json` | Seleção de dados de Assimilação |
| `systems-names.json` | Unicode 17, NFD e aliases; o gerador também verifica `system_unicode.go` |
| `compatibility-corpus.json` | Corpus histórico V2/V3 preservado, incluindo divergências deliberadas da V3 |
| `full-roll-replay.json` | Vetores de replay genérico e misto da suíte TypeScript original |

JSON não representa NaN/infinito nem preserva zero negativo. Os fundamentos
codificam números especiais nas entradas como strings, distinguindo o tipo das
sementes; o corpus matemático maior usa bits IEEE 754 em hexadecimal. Resultados
JSON seguem JavaScript, inclusive a conversão de -0 para 0. `seedUTF16` permite
preservar as unidades originais de strings com surrogates.

O leitor Go compara resultados estruturados e erros completos. Testes específicos
também conferem o JSON bruto dos diagnósticos UTF-16, pois decodificar uma unidade
isolada em uma string Go poderia ocultar uma diferença. Alguns casos negativos
dos fundamentos são marcados como inaplicáveis: por exemplo, receber `NaN` onde
a assinatura exige `int64`, ou uma palavra negativa em `[]uint32`. Não são
falhas funcionais ignoradas. O worker de benchmark só executa no harness próprio.

## Auditoria matemática ampliada

```sh
node scripts/generate-go-math-conformance.mjs --audit
cd go
DICECORE_MATH_CONFORMANCE_FIXTURE=../.artifacts/math-conformance-audit.json go test -run '^TestMathConformance$' -v
```

No PowerShell, defina a variável com
`$env:DICECORE_MATH_CONFORMANCE_FIXTURE = '../.artifacts/math-conformance-audit.json'`
antes de executar `go test`, removendo-a ao terminar. A auditoria usa uma amostra
maior que a suíte regular e exige a mesma igualdade exata. O oráculo é a versão
Windows de Node 24.18.0; a biblioteca Go pode executar os vetores armazenados sem
Node em outros sistemas. Mudanças na libm de outra plataforma não devem
reescrever silenciosamente a referência.
