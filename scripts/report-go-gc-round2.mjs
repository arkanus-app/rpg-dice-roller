/** Render the optional second-round GC experiment; this script does not measure. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = JSON.parse(readFileSync(path.join(root, 'go/benchmarks/gc-round2-tuning.json'), 'utf8'));
const workloads = data.configuration.workloads;
const nf = value => value == null ? 'indisponível' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
const controls = data.runs.filter(run => run.gc === 100);
const selection = data.runs.filter(run => run.stage === 'selection');
const confirmed = data.status === 'complete' && data.confirmedGc
  ? data.runs.find(run => run.stage === 'confirmation' && run.gc === data.confirmedGc) : undefined;
const confirmationControl = controls.find(run => run.stage === 'confirmation');
const selected = data.runs.find(run => run.stage === 'selection' && run.gc === data.selectedGc);
const cell = (run, id) => {
  const row = run?.summary[id];
  if (!row) return 'não medido';
  return `${nf(row.opsPerSecond)} / ${nf(row.medianRssMiB)} / ${nf(row.maximumRssMiB)}${row.maximumRssMiB > 128 ? ' **>128**' : ''}`;
};
const selectionRows = workloads.map(workload => `| ${workload.label} | ${[100, 200, 500, 1000].map(gc => cell(selection.find(run => run.gc === gc), workload.id)).join(' | ')} |`).join('\n');
const confirmationCandidate = data.runs.find(run => run.stage === 'confirmation' && run.gc !== 100);
const confirmationRows = workloads.map(workload => {
  const candidate = confirmationCandidate?.summary[workload.id];
  const control = confirmationControl?.summary[workload.id];
  const ratio = candidate && control ? candidate.opsPerSecond / control.opsPerSecond : null;
  return `| ${workload.label} | ${cell(confirmationControl, workload.id)} | ${cell(confirmationCandidate, workload.id)} | ${nf(ratio)}${ratio == null ? '' : '×'} |`;
}).join('\n');
const losses = confirmationCandidate && confirmationControl ? workloads.filter(workload => confirmationCandidate.summary[workload.id].opsPerSecond < confirmationControl.summary[workload.id].opsPerSecond) : [];
const state = data.status !== 'complete'
  ? `O experimento não foi concluído: ${data.error ?? data.status}. Os dados disponíveis permanecem abaixo; não se promove uma configuração incompleta.`
  : confirmed
    ? `GOGC=${confirmed.gc} foi selecionado e confirmado no alvo 100d6/full, respeitando o teto experimental de 128 MiB para o maior snapshot RSS de cada uma das nove cargas. Isso é uma opção explícita de configuração do processo; a biblioteca e o benchmark padrão continuam usando a política GC padrão.`
    : `Nenhuma configuração alternativa ficou confirmada pelos critérios deste experimento. ${selected ? `GOGC=${selected.gc} foi escolhido na seleção, mas a confirmação não sustentou todos os critérios.` : 'A seleção não encontrou alternativa elegível que superasse o controle no alvo.'}`;
const target = confirmed && confirmationControl
  ? `Na confirmação, 100d6/full passou de ${nf(confirmationControl.summary['100d6-full'].opsPerSecond)} para ${nf(confirmed.summary['100d6-full'].opsPerSecond)} operações/s, razão ${nf(confirmed.summary['100d6-full'].opsPerSecond / confirmationControl.summary['100d6-full'].opsPerSecond)}×. A mediana RSS dessa carga foi ${nf(confirmed.summary['100d6-full'].medianRssMiB)} MiB; o maior snapshot da configuração entre todas as cargas foi ${nf(Math.max(...Object.values(confirmed.summary).map(row => row.maximumRssMiB)))} MiB.\n\n` : '';
const lossText = confirmationCandidate && confirmationControl
  ? losses.length ? `A candidata teve mediana de throughput menor que o controle fresco em ${losses.length} cargas: ${losses.map(workload => workload.label).join(', ')}. Diferenças pequenas exigem leitura dos lotes e dispersão; o critério de seleção não exige ganhar em todas as cargas.`
    : 'Nesta confirmação, a candidata teve mediana de throughput maior ou igual à do controle nas nove cargas. Isso descreve esta execução; não garante ganho em outras cargas ou máquinas.'
  : 'Não há par completo de confirmação para avaliar regressões contra um controle fresco.';
const text = `# Segunda rodada: configuração de GC para o backend\n\n${state}\n\n${target}` +
  `## Método\n\nMesmos binário Go, expressões, MT19937, seeds únicas, limites e modo de resultado do [benchmark padrão](BACKEND_ROUND2_BENCHMARK.md). Uma engine por worker, seis workers, ${data.configuration.samples} lotes de ${data.configuration.requests} chamadas por carga e aquecimento de ${data.configuration.warmup} chamadas por worker. Nenhuma configuração GC é definida dentro da biblioteca.\n\n` +
  `A seleção executa um controle fresco GOGC=100 e depois 200/500/1000. Entre as alternativas cujo **maior snapshot após lotes é ≤128 MiB em todas as nove cargas**, escolhe a maior mediana de throughput de 100d6/full. Se superar o controle, repete a candidata e depois GOGC=100, em ordem reversa. A confirmação exige superar o novo controle no alvo e manter o teto nas nove cargas. Esse teto é um critério experimental de snapshots; não é GOMEMLIMIT nem garantia de pico de RSS.\n\n` +
  `GOMAXPROCS herdado: ${data.environment.inheritedGOMAXPROCS ?? 'padrão'}; GOMEMLIMIT: ${data.environment.inheritedGOMEMLIMIT ?? 'não definido'}. ${data.environment.cpuModel.trim()} · ${data.environment.osVersion} · ${data.referenceEnvironment.go}. Binário SHA-256: \`${data.goWorkerBinary.sha256}\`. Duração do experimento: ${nf(data.wallMilliseconds / 1000)} s, orçamento próprio ${nf(data.configuration.wallBudgetMs / 1000)} s dentro do saldo reservado para backend e GC.\n\n` +
  `## Seleção: quatro configurações\n\nCada célula: **operações/s / RSS mediano MiB / maior snapshot RSS MiB**. Todas as cargas são publicadas, inclusive as que excederam o teto ou perderam throughput.\n\n| Carga | GOGC=100 | GOGC=200 | GOGC=500 | GOGC=1000 |\n|---|---:|---:|---:|---:|\n${selectionRows}\n\n` +
  `## Confirmação em ordem reversa\n\nA candidata é executada primeiro; o controle100 vem depois. A razão compara as medianas de throughput desta etapa, não com controles de outro experimento.\n\n| Carga | Controle fresco100: ops/s / RSS med. / maior | Candidata${confirmationCandidate ? ` GOGC=${confirmationCandidate.gc}` : ''}: ops/s / RSS med. / maior | Candidata/controle |\n|---|---:|---:|---:|\n${confirmationRows}\n\n${lossText}\n\n` +
  `## Leitura e limitações\n\nRSS é medido após os lotes, fora do cronômetro, com os workers e suas referências vivos. Inclui runtime e harness. O processo percorre cargas em sequência; memória retida ou reservada por cargas anteriores pode influenciar snapshots posteriores. O maior snapshot não é o pico entre medições, e RSS pode variar de forma não monotônica ao aumentar GOGC. Throughput é calculado pela mediana da duração dos lotes; não é latência individual nem capacidade de um servidor HTTP.\n\n` +
  `Os [gráficos do backend](BACKEND_ROUND2_BENCHMARK.md#gráficos) mantêm Node/Bun/Go padrão e só acrescentam a configuração Go confirmada, identificando essa medição separada. A [primeira rodada de GC](benchmarks/round2-baseline/go/GC_TUNING.md) e todos os seus dados continuam preservados.\n\n` +
  `## Reprodução e evidência\n\nExecute primeiro scripts/compare-backend-round2.mjs para construir e medir o binário de referência. Em seguida, com fontes e binário inalterados:\n\n\`\`\`powershell\n$env:DICECORE_GC_BUDGET_MS = '180000' # ou o saldo restante dos cinco minutos reservados\nnode scripts/compare-go-gc-round2.mjs\nnode scripts/report-go-gc-round2.mjs\npython scripts/plot-backend-round2.py\n\`\`\`\n\nO orquestrador verifica o hash do binário e de todas as fontes medidas, além dos contadores de entrega de cada lote. Os gráficos requerem matplotlib==3.10.8. [JSON integral, configurações, comandos e lotes](benchmarks/gc-round2-tuning.json) · [Orquestrador](../scripts/compare-go-gc-round2.mjs).\n`;
let rendered = text;
const capPath = path.join(root, 'go/benchmarks/gc-round2-memory-cap.json');
if (existsSync(capPath)) {
  const cap = JSON.parse(readFileSync(capPath, 'utf8'));
  const capCandidate = cap.runs.find(run => run.stage === 'confirmation' && run.gc === cap.confirmedGc && run.memoryLimit === cap.confirmedMemoryLimit);
  const capControl = cap.runs.find(run => run.stage === 'confirmation' && run.gc === 100);
  const capSelectionRows = workloads.map(workload => `| ${workload.label} | ${cell(cap.runs.find(run => run.stage === 'selection' && run.gc === 100), workload.id)} | ${cell(cap.runs.find(run => run.stage === 'selection' && run.memoryLimit === '64MiB'), workload.id)} | ${cell(cap.runs.find(run => run.stage === 'selection' && run.memoryLimit === '96MiB'), workload.id)} |`).join('\n');
  const capConfirmationRows = workloads.map(workload => {
    const candidate = capCandidate?.summary[workload.id];
    const control = capControl?.summary[workload.id];
    return `| ${workload.label} | ${cell(capControl, workload.id)} | ${cell(capCandidate, workload.id)} | ${candidate && control ? nf(candidate.opsPerSecond / control.opsPerSecond) + '×' : 'não confirmado'} |`;
  }).join('\n');
  const capLosses = capCandidate && capControl ? workloads.filter(workload => capCandidate.summary[workload.id].opsPerSecond < capControl.summary[workload.id].opsPerSecond) : [];
  const capConclusion = cap.status === 'complete' && capCandidate
    ? `A extensão confirmou **GOGC=${cap.confirmedGc} e GOMEMLIMIT=${cap.confirmedMemoryLimit}**. O maior snapshot RSS entre as nove cargas foi ${nf(Math.max(...Object.values(capCandidate.summary).map(row => row.maximumRssMiB)))} MiB. No alvo 100d6/full, a confirmação produziu ${nf(capCandidate.summary['100d6-full'].opsPerSecond)} operações/s contra ${nf(capControl.summary['100d6-full'].opsPerSecond)} do controle fresco, razão ${nf(capCandidate.summary['100d6-full'].opsPerSecond / capControl.summary['100d6-full'].opsPerSecond)}×. A configuração padrão e a tentativa sem cap reprovada permanecem integralmente publicadas.`
    : `A extensão não confirmou uma configuração com limite suave de memória. Estado: ${cap.status}; ${cap.error ?? 'os critérios de confirmação não foram satisfeitos'}.`;
  const capSection = `## Extensão explícita: GOGC500 com limite suave de memória\n\nApós a reprovação de GOGC500 sem cap por RSS, foi autorizada uma extensão limitada a duas candidatas: GOGC500/GOMEMLIMIT64MiB e GOGC500/GOMEMLIMIT96MiB. Um controle fresco100 sem cap veio antes da seleção; depois a candidata escolhida e outro controle100 foram executados nessa ordem. Mesmos binário, nove cargas, seeds, lotes, aquecimento e contadores. Orçamento adicional90s; duração${nf(cap.wallMilliseconds / 1000)}s.\n\n**GOMEMLIMIT é um limite suave para memória gerida pelo runtime Go, não um limite de RSS do processo.** O critério continuou sendo maior snapshot RSS≤128MiB em cada uma das nove cargas e maior throughput de100d6/full. A extensão não apaga nem reclassifica a tentativa anterior sem cap.\n\n${capConclusion}\n\nSeleção; cada célula: operações/s / RSS mediano MiB / maior snapshot MiB.\n\n| Carga | Controle100 sem cap | GOGC500 /64MiB | GOGC500 /96MiB |\n|---|---:|---:|---:|\n${capSelectionRows}\n\nConfirmação reversa: candidata primeiro e controle fresco depois.\n\n| Carga | Controle100 sem cap | Candidata confirmada | Candidata/controle |\n|---|---:|---:|---:|\n${capConfirmationRows}\n\n${capCandidate && capControl ? capLosses.length ? `A candidata teve throughput menor em: ${capLosses.map(workload => workload.label).join(', ')}. Todas as cargas permanecem na tabela.` : 'A candidata teve mediana de throughput maior ou igual ao controle fresco nas nove cargas nesta confirmação.' : 'Sem par confirmado para avaliar regressões.'}\n\n[Dados integrais da extensão](benchmarks/gc-round2-memory-cap.json) · [Orquestrador da extensão](../scripts/compare-go-gc-memory-cap.mjs). Para reproduzir a extensão após o experimento inicial, execute \`node scripts/compare-go-gc-memory-cap.mjs\`; depois gere este relatório e os gráficos.\n\n`;
  rendered = rendered.replace('# Segunda rodada: configuração de GC para o backend\n\n', `# Segunda rodada: configuração de GC para o backend\n\n${capConclusion}\n\n## Experimento inicial, sem GOMEMLIMIT\n\n`);
  rendered = rendered.replace('## Leitura e limitações\n\n', capSection + '## Leitura e limitações\n\n');
}
writeFileSync(path.join(root, 'go/GC_ROUND2_TUNING.md'), rendered);
console.log('Saved go/GC_ROUND2_TUNING.md');
