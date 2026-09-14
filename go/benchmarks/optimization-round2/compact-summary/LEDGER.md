# Resumo compacto de pools — rodada 2

**Decisão: promover V3**, que combina o executor compacto, ranking com valor/posição contíguos e buffers locais limitados. Foram avaliadas três hipóteses; a segunda teve um refinamento. Nenhuma alteração foi feita nos corpos TypeScript, na notação, no RNG, no replay ou nos limites para favorecer o resultado.

## Contrato preservado

O novo caminho atende ASTs cuja raiz é um dado, incluindo os modificadores compilados de mínimo, máximo, explosão simples/composta/penetrante, reroll, unique, keep/drop, target, critical-success/failure e sort. O compilador já resolve modificadores estruturais e mantém um único modificador por tipo em ordem definida. O resumo guarda apenas valor, contribuição, atividade, inclusão e classificação de target; não cria IDs, grupos, listas de estados ou mapas de eventos que não serão retornados.

Os eventos e os itens de resultado continuam sendo consumidos individualmente e na ordem do executor geral, inclusive antes de cada falha de orçamento. Explosões usam índices que sobrevivem ao crescimento do slice. Keep/drop usam valor e posição original como chave, preservando os desempates. Sort altera apenas a ordem de apresentação no executor geral, por isso não muda o resumo nem seus contadores. As somas e chamadas de `RoundResult` mantêm a ordem original.

O hook deve executar depois do caminho existente `SupportsFastSummary`. As formas de AST não suportadas e os modificadores desconhecidos continuam no executor geral. Os dois helpers internos são `canExecuteCompactSummary(program)` e `executeCompactSummaryPlan(plan, program, options)`.

## Controle da medição

Todos os binários foram construídos no mesmo snapshot de `a1c4bbb`, extraído em `.artifacts/compact-summary-check/go`. Somente os dois arquivos novos de resumo compacto foram acrescentados/alterados. Assim, as mudanças simultâneas de eventos tipados, cache e IDs não entram nestes deltas. O benchmark usa a mesma API de plano/contexto nos dois caminhos, três cargas de backend e um ciclo de 128 seeds numéricas. Preparação do plano fica fora da medição; o resultado escapa pelo mesmo sink.

Ambiente: Go 1.26.2, Windows/amd64, AMD Ryzen 5 5500, 12 CPUs lógicas informadas pelo Go. Cada série tem cinco amostras com `-test.benchtime=200ms`. São medianas de microssegundos, bytes e alocações por operação; não são p95 nem medições de rede/servidor. O confronto integrado posterior mede a biblioteca com todas as otimizações combinadas.

Os logs `v3.txt`, `v2b.txt` e `v1-final.txt` foram marcados provisórios porque outro agente informou 1,4 s de ESLint possivelmente sobrepostos ao início dessa janela. Seus dados foram preservados, mas não fundamentam a confirmação final. `v1-clean-final.txt` e `v3-clean-final.txt` repetem o confronto em janela exclusiva; terminaram às 02:09:32 e 02:09:37 UTC de 14/09/2026, antes da compilação/medição posterior do root.

## Três hipóteses

1. **H1 / V1 — estado compacto.** Substituir a materialização interna do executor geral por um vetor numérico e flags no resumo. Promovida: a redução de alocações e latência aparece nas três cargas e foi repetida na confirmação limpa.
2. **H2 / V2 — ranking direto.** Eliminar os vetores intermediários de valores e índices usando posições diretamente sobre os dados. V2 foi descartada: embora retirasse duas alocações por seleção, regrediu na mediana do pool prioritário de 20 dados e da carga de 100 dados na comparação com V1 repetida. **V2b** mantém o valor junto à posição em um único vetor de ranking, evitando indireções no comparador. Esse refinamento compõe a candidata final V3. A medição individual de V2b permanece provisória; a promoção do conjunto usa a confirmação limpa V1→V3.
3. **H3 / V3 — buffers locais limitados.** Usar espaço local para até 32 dados e 32 elementos de ranking; pools maiores e explosões que excedam o espaço crescem normalmente. Não há pool global nem estado mutável compartilhado. Promovida no conjunto V3: a confirmação limpa ganha nas três cargas, com menos bytes/alocações. O compilador confirmou que os buffers locais não escapam.

## Confirmação limpa

| Carga | Geral µs | V1 compacta µs | V3 final µs | Geral → V3: bytes/op | Geral → V3: allocs/op |
|---|---:|---:|---:|---:|---:|
| `20d6!2ro=1kh10` | 14.952 | 8.863 | 6.787 | 12085 → 3752 | 137 → 10 |
| `100d6min2max5kh80` | 42.913 | 18.680 | 15.108 | 34720 → 8232 | 320 → 12 |
| `12d6!!p2ro<2uo=2kh7dl2>=5f=1cs>=6cf<=1sa` | 17.690 | 8.850 | 7.098 | 11278 → 3835 | 158 → 13 |

## Séries intermediárias preservadas

Valores: µs / bytes por operação / alocações por operação. As amostras individuais de todas as séries estão em `summary.json` e nos arquivos `.txt` de mesmo nome.

| Série | Pool20 | 100 dados | Pool com todos os modificadores |
|---|---:|---:|---:|
| v1 | 10.117 / 5826 / 15 | 17.453 / 9128 / 14 | 9.268 / 5316 / 21 |
| v2-compact | 7.917 / 5435 / 13 | 16.674 / 7336 / 12 | 8.496 / 4885 / 17 |
| v1-repeat | 7.361 / 5826 / 15 | 15.281 / 9128 / 14 | 9.271 / 5316 / 21 |
| v2b (provisória) | 7.202 / 5630 / 13 | 15.349 / 8232 / 12 | 7.826 / 5111 / 17 |
| v3 (provisória) | 6.746 / 3752 / 10 | 16.318 / 8232 / 12 | 7.164 / 3835 / 13 |
| v1-final (provisória) | 7.170 / 5826 / 15 | 15.742 / 9128 / 14 | 8.517 / 5316 / 21 |

## Validação

- O perfil focado da V3 cobre **191/191 statements** de `executor_compact_summary.go`, sem exclusões nem expectativas ajustadas para o Go.
- Fixtures TypeScript existentes são executados diretamente no novo caminho para os casos elegíveis que anteriormente usavam o executor geral.
- O teste diferencial compara resultados completos e erros com o executor geral, usando duas famílias de RNG, 16 seeds por expressão e replay em cada caso. Inclui valores decimais, totais grandes, modificadores estruturais, pools vazios, Fudge, percentuais e 1.200 dados entre explosões e múltiplas rolagens.
- A varredura de limites compara 48 valores de cada um dos oito limites de execução, três seeds e limites concorrentes. O diagnóstico completo da primeira falha deve coincidir.
- O teste de concorrência compartilha um plano entre oito workers e compara 256 execuções com os resultados determinísticos previamente calculados. O root executa a validação integrada final com race; este registro não antecipa seu resultado.

## Comandos

PowerShell; `GO` representa o executável Go 1.26.2 e `PYTHON` o Python da sessão. Os executáveis congelados e seus SHA-256 estão registrados em `summary.json`.

```powershell
# Na raiz do repositório, preparar o snapshot da baseline:
git archive --format=zip --output=.artifacts/compact-summary-base.zip a1c4bbb go
Expand-Archive -LiteralPath '.artifacts/compact-summary-base.zip' -DestinationPath '.artifacts/compact-summary-check' -Force
Copy-Item -LiteralPath 'go/executor_compact_summary.go','go/executor_compact_summary_test.go' -Destination '.artifacts/compact-summary-check/go'

# Dentro do go/ do snapshot, repetir em cada variante:
& $GO test -run TestCompactSummary -coverprofile='../../compact-summary-cover.out' .
& $GO test -c -o '../../optimization/compact-summary/v1.exe' .
# Mesma compilação, nomes v2.exe / v2b.exe / v3.exe, após trocar só os arquivos novos.

# Dentro de .artifacts/optimization/compact-summary:
& './v1.exe' '-test.run=^$' '-test.bench=^BenchmarkCompactSummary$' '-test.benchtime=200ms' '-test.count=5' '-test.benchmem' | Out-File 'v1.txt' -Encoding utf8
# V2/V2b/V3 e repetições compactas usam o filtro abaixo, mantendo os demais flags:
# -test.bench=^BenchmarkCompactSummary/.*/compact=true$

# Confirmação limpa, nesta ordem, sem recompilar entre as duas séries:
& './v1.exe' '-test.run=^$' '-test.bench=^BenchmarkCompactSummary$' '-test.benchtime=200ms' '-test.count=5' '-test.benchmem' | Out-File 'v1-clean-final.txt' -Encoding utf8
& './v3.exe' '-test.run=^$' '-test.bench=^BenchmarkCompactSummary/.*/compact=true$' '-test.benchtime=200ms' '-test.count=5' '-test.benchmem' | Out-File 'v3-clean-final.txt' -Encoding utf8

# Reconstruir os resumos e este relatório a partir dos logs preservados:
& $PYTHON './summarize.py'
& $PYTHON './write_ledger.py'
```
