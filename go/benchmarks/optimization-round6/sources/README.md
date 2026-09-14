# Fontes exatas das quatro hipóteses

Os arquivos `.go.txt` são cópias binárias dos arquivos de cada hipótese. Não
passaram por conversão de quebras de linha, formatação ou aplicação de patch.
A extensão evita que `go test ./...` tente compilá-los como pacotes incompletos.

[manifest.json](manifest.json) identifica o commit-base, cada origem, destino de
restauração, tamanho, SHA-256, binários preservados e medições correspondentes.
O arquivamento confere cada binário e saída contra os hashes do ensaio original.

| Hipótese | Composição sobre `f107265` | Decisão |
|---|---|---|
| H1 — arena | Os quatro arquivos de `h1-arena` | Rejeitada: regressão na carga com modificadores |
| H2 — strings | Os três arquivos de `h2-strings` | Aceita |
| H3 — envelope | O arquivo de `h3-envelope` | Aceita |
| H4 — arena com estado na stack | Os quatro arquivos de `h4-arena-stack` | Rejeitada: regressão na carga com modificadores |

Cada hipótese foi medida separadamente contra o mesmo baseline. H4 contém os
quatro arquivos completos e não depende de aplicar H1 antes. Para reconstruir
a composição final aceita, aplique H2 e H3 sobre o baseline; essa composição
nunca inclui H1 ou H4.

Para verificar o arquivo histórico, sem compilar ou executar a biblioteca:

```powershell
node go/benchmarks/optimization-round6/sources/verify.mjs
```

Para reproduzir uma hipótese, crie um checkout separado no commit completo
registrado em `base.commit`. Copie cada `files[].archive` para o correspondente
`files[].target` desse checkout como bytes, sem ferramentas de patch ou
conversão de texto. Por exemplo, a partir da raiz deste repositório, usando
um checkout já criado em `.artifacts/replay-h1`:

```powershell
$sourceRepo = (Get-Location).Path
$targetCheckout = (Resolve-Path -LiteralPath '.artifacts/replay-h1').Path
$manifestPath = Join-Path $sourceRepo 'go/benchmarks/optimization-round6/sources/manifest.json'
$sourceManifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($targetCheckout -eq $sourceRepo) { throw 'Use um checkout separado.' }
if ((git -C $targetCheckout rev-parse HEAD) -ne $sourceManifest.base.commit) {
    throw 'O checkout de destino deve estar no commit-base exato.'
}
foreach ($entry in $sourceManifest.variants.'h1-arena'.files) {
    $from = Join-Path $sourceRepo $entry.archive
    $to = Join-Path $targetCheckout $entry.target
    [IO.File]::WriteAllBytes($to, [IO.File]::ReadAllBytes($from))
}
```

Use Go **1.26.2**, `CGO_ENABLED=0`, diretório `go`, e `go test -c -o <binário>`
para compilar o executável de testes. Os ensaios originais foram executados em
Windows/amd64. O filtro e os argumentos exatos de benchmark estão nos JSONs
referenciados por `measurement`; as medições devem ser seriais. O helper não
compila nem executa esses comandos.

A versão da ferramenta e `CGO_ENABLED` são a proveniência declarada pelo
coordenador da rodada. Fontes e hashes permitem auditoria, mas não constituem
prova criptográfica do processo de compilação. Um rebuild pode ter hash de
binário diferente por caminhos, build IDs ou metadados; isso não deve ser
tratado como falha de paridade de resultados. Os binários locais em `.artifacts`
são opcionais em outro clone; as fontes e medições permanecem no repositório.
