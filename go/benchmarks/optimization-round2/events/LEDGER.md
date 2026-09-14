# Eventos Go tipados: variantes e confirmação

Baseline: commit `a1c4bbb`. Quatro hipóteses, com um refinamento H4b; nenhuma mudança no TypeScript de referência. O código executa todas as rolagens e materializa os eventos antes de retornar. Não há dados ou eventos calculados durante a serialização.

## Método

Go 1.26.2, Windows/amd64, Ryzen 5 5500, GOMAXPROCS padrão 12. Cinco amostras de 100 ms por carga. Cada variante usa um binário congelado sobre o mesmo pacote-base. Mudanças simultâneas de RNG/cache, IDs, slices do resultado e resumo compacto foram excluídas destes snapshots. A integração final mede a combinação separadamente.

Execução mede a API full, com engine/plano aquecidos fora do timer, resultados escapando e seed fixa ou ciclo de 128 seeds. Encoding mede `json.Marshal` de um resultado completo previamente calculado, com bytes escapando. Esses microbenchmarks não representam transporte HTTP, p95, RSS ou milhares de seeds novas; o benchmark de backend mede separadamente lotes de milhares de seeds distintas, paralelismo e RSS.

## Hipóteses

1. **H1: eventos concretos.** Substitui mapas por `ResolvedEvent`, preservando todos os campos discriminados. Remove boxing de valores e mapas na execução. A primeira representação plana reduziu alocações, mas ampliou bytes devido ao tamanho da struct e ao crescimento repetido da slice; não foi promovida sozinha.
2. **H2: capacidade inicial limitada.** Reserva um prefixo de até 256 eventos, estimado pelo programa e limitado por maxEvents/maxResultItems. A cauda de explosões continua crescendo conforme executada. Limites nativos negativos conservam seus erros de orçamento, sem panic de make(cap<0).
3. **H3: payload tipado opcional.** `ResolvedEvent.Details` guarda GroupID, ChildDieID, Reason, Outcome, From/To e FromIDs/ToIDs. Eventos comuns de roll/include não precisam desse payload. Modificadores e grupos têm seus valores completos capturados no momento do evento; o payload só é alocado quando eventos são materializados. ParentDieID/HasParent são capturados por valor, preservando o histórico quando o chamador modifica o ponteiro do dado retornado.
4. **H4: buffer único de JSON.** A primeira candidata escreveu todo o envelope por um MarshalJSON próprio e piorou as três cargas nas duas ordens; rejeitada. **H4b** restringe a mudança à slice `ResolvedEvents`: o envelope conserva encoding/json e cada evento é anexado ao mesmo buffer. Aceita após confirmação nas duas ordens, reduzindo 201 buffers de eventos para uma coleção no exemplo 100d6.

`DiceEvent = map[string]any` e a API pública ExecutionJournal.Record/Slice/ToArray continuam disponíveis. Record copia o mapa de entrada; leituras retornam slices independentes contendo os mesmos mapas, incluindo campos arbitrários e sobrescrita explícita de sequence. O executor usa a coleção tipada privada e transfere sua slice final.

## Correção de decoding descoberta na revisão

Os testes focados iniciais usaram por engano o padrão plural TestSystems, deixando TestSystemEngineContractFixtures de fora. A suíte completa encontrou perda de groupId em eventos dos motores injetados, porque o decoder padrão não preenchia o novo Details. Isso foi corrigido com UnmarshalJSON tipado antes da confirmação final H3/H4b. Ele restaura os campos planos, parent/null, números e arrays de transformação; testes cobrem roundtrip dos dez formatos, campos inválidos e atribuição atômica. Nenhum fixture foi alterado.

A suíte completa do snapshot H4b passou em 1,352 s, com 4.314/4.314 statements cobertos ([perfil integral](v4b-coverage.txt)). Os testes incluem erros de custom marshalers, NaN, infinidades, zero negativo, subnormais, escaping Unicode/HTML, arrays nil/vazios, mutações do chamador e orçamentos. Race e cobertura do módulo integrado pertencem à verificação final do coordenador e não são inferidos deste snapshot.

## Confirmação da execução

Ordem inversa: candidata H3 validada e depois o baseline. A serialização não faz parte desta tabela.

| Carga | Mediana µs antes → depois | Aceleração | Bytes/op | Alocações/op |
|---|---:|---:|---:|---:|
| `1d20+5/full/changing=false` | 13.226 → 8.124 | 1.63× | 8056 → 7296 | 82 → 48 |
| `1d20+5/full/changing=true` | 11.204 → 8.790 | 1.27× | 8063 → 7303 | 82 → 48 |
| `100d6/full/changing=false` | 125.759 → 60.402 | 2.08× | 136752 → 80488 | 1368 → 153 |
| `100d6/full/changing=true` | 139.128 → 58.473 | 2.38× | 136760 → 80495 | 1368 → 153 |
| `20d6!2ro=1kh10/full/changing=false` | 72.902 → 33.096 | 2.20× | 51944 → 42464 | 598 → 176 |
| `20d6!2ro=1kh10/full/changing=true` | 58.993 → 33.293 | 1.77× | 47523 → 40341 | 533 → 156 |

## Confirmação do encoding

H4b, depois baseline H3, depois H4b novamente. A tabela usa o baseline intermediário e a repetição final de H4b. O custo de executar a rolagem está fora do timer.

| Carga | Mediana µs antes → depois | Aceleração | Bytes/op | Alocações/op |
|---|---:|---:|---:|---:|
| `1d20+5` | 9.642 → 9.053 | 1.07× | 3972 → 3716 | 6 → 2 |
| `100d6` | 280.182 → 248.690 | 1.13× | 109229 → 98682 | 202 → 2 |
| `20d6!2ro=1kh10` | 108.814 → 88.394 | 1.23× | 36195 → 32060 | 70 → 2 |

Todos os resultados de H1/H2/H3, a rejeição H4 e o refinamento H4b estão nos logs e em [summary.json](summary.json). Amostras individuais, medianas e hashes dos sete binários estão preservados. Fontes relevantes de variantes ficam em [sources](sources/) com extensão .go.txt para não criar pacotes de produção duplicados. Binários permanecem apenas em .artifacts/optimization-round2/events e não são distribuídos.

## Comandos

A partir do snapshot correspondente, com Go 1.26.2:

```powershell
go test ./... '-count=1' '-coverprofile=../v4b-coverage.out'
go test -c -o ../candidate.exe
& ../candidate.exe '-test.run=^$' '-test.bench=^BenchmarkBackendOperation/.*/full/changing=(false|true)$' '-test.benchtime=100ms' '-test.count=5' '-test.benchmem'
& ../candidate.exe '-test.run=^$' '-test.bench=^BenchmarkResolvedEventsJSON$' '-test.benchtime=100ms' '-test.count=5' '-test.benchmem'
```

BenchmarkResolvedEventsJSON está em go/event_performance_test.go. Para reconstruir comparações isoladas, restaure o commit-base num checkout separado e aplique os arquivos de sources da variante desejada; H4b é o conjunto final completo, e H4 rejeitada substitui apenas os arquivos registrados sobre H3. Compile cada binário antes de medi-lo. Não execute benchmarks concorrentes.
