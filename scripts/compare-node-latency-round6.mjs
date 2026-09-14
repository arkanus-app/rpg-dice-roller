/** Fixed configuration experiment focused on p95; no production changes.
 * node scripts/compare-node-latency-round6.mjs --candidate node-qpc-final.exe [--go go.exe]
 * Uses one supplied Go executable for every Go configuration; never builds it.
 * Five series, eleven fixed workloads, six workers, two reverse orders, 540 s.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const workers = 6;
let go = process.env.GO_BINARY ?? 'go', candidate;
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  assert.ok(args[index + 1], `Incomplete argument: ${argument}`);
  if (argument === '--go') go = args[++index];
  else if (argument === '--candidate') candidate = path.resolve(args[++index]);
  else throw new Error(`Unknown argument: ${argument}`);
}
assert.ok(candidate, '--candidate is required');
assert.ok(!process.versions.bun, 'Invoke this Node-only orchestrator with Node');
const started = Date.now(), deadline = started + 540000;
const directory = path.join(root, 'go/benchmarks/optimization-round6');
const binary = candidate;
mkdirSync(directory, { recursive: true });
const runName = 'node-latency-round6', rawPath = path.join(directory, `${runName}.json`);
const preflightPath = path.join(directory, `${runName}-preflight.json.gz`);
const workloads = [
  ['d20', '1d20+5', 'main'], ['100d6', '100d6', 'main'], ['pool', '20d6!2ro=1kh10', 'main'],
  ['1000d6', '1000d6', 'round5-regression'], ['reroll-selection', '100d6ro=1kh60', 'round5-regression'],
  ['multi-group', '2#{4d6,3d8+2}kh1', 'round5-regression'], ['unicode-comment', '20d6!2ro=1kh10 # ação 🎲', 'round5-regression'],
  ['fudge', '100dF.2', 'round5-regression'], ['fractional-bounds', '50d6min2.125max4.875kh25', 'round5-regression'],
  // Same grammar as parser fixtures 6d10>=7f=1 and {1d4+1,1d6+2}dl1.
  ['target-pool', '40d10>=7f=1', 'new-holdout'], ['drop-group', '{6d6,4d8}dl1', 'new-holdout'],
].map(([id, input, category]) => ({ id, input, category, mode: 'full', label: `${input} · full` }));
const configurations = [
  { id: 'node', label: 'Node', runtime: 'node', executable: process.execPath, encoder: 'JSON.stringify' },
  { id: 'go-control', label: 'Go controle · P12 GC500/96MiB', runtime: 'go', executable: binary, encoder: 'dicecore.MarshalJSON', gomaxprocs: 12, gc: 500, memoryLimit: '96MiB' },
  { id: 'go-p6', label: 'Go P6 · GC500/96MiB', runtime: 'go', executable: binary, encoder: 'dicecore.MarshalJSON', gomaxprocs: 6, gc: 500, memoryLimit: '96MiB' },
  { id: 'go-p6-gc1500', label: 'Go P6 · GC1500/192MiB', runtime: 'go', executable: binary, encoder: 'dicecore.MarshalJSON', gomaxprocs: 6, gc: 1500, memoryLimit: '192MiB' },
  { id: 'go-p6-gc3000', label: 'Go P6 · GC3000/256MiB', runtime: 'go', executable: binary, encoder: 'dicecore.MarshalJSON', gomaxprocs: 6, gc: 3000, memoryLimit: '256MiB' },
];
const configuration = {
  primaryMetric: 'p95LatencyNs', reference: 'node', controlConfiguration: 'go-control',
  guardrails: ['opsPerSecond', 'aggregateCpuNsPerOp', 'medianSnapshotRssMiB'],
  successCriterion: 'p95 below Node and throughput above Node, CPU/op and median RSS below Node in all eleven fixed workloads; all configurations remain reported.',
  workers, requests: 4096, latencyRequests: 2048, samplesPerProcess: 3, rounds: 2, warmupPerWorker: 256,
  operation: 'build-and-encode', seedPrefix: 'dicecore-backend/v3.7.1/', randomAlgorithm: 'mt19937',
  engineMode: 'pool', freezeResults: 'never', cache: 'warm', wallBudgetMs: 540000,
  validationIndices: [0, 1, 5, 127, 511, 4095],
  orders: [configurations.map(value => value.id), configurations.map(value => value.id).reverse()],
  latencyMethod: 'Separate pass after throughput batches, two high-resolution monotonic counter reads per call; Windows Go uses QueryPerformanceCounter with frequency resolved before workers and delta ticks converted to ns, portable Go uses time.Now/time.Since, Node uses process.hrtime.bigint; per-worker closed loops, no queue/HTTP; digest updated after each individual timer.',
  cpuMethod: 'Whole-process cumulative user+system CPU surrounding each throughput batch, including all worker/runtime/GC threads and measurement-call overhead.',
};
const workerFiles = ['go/node_compare_bench_test.go', 'go/node_compare_cpu_windows_test.go', 'go/node_compare_cpu_linux_test.go', 'go/node_compare_cpu_other_test.go',
  'go/backend_benchmark_test.go', 'go/json_benchmark_test.go', 'go/backend_rss_windows_test.go', 'go/backend_rss_linux_test.go', 'go/backend_rss_other_test.go'];
const raw = {
  schemaVersion: 1, status: 'running', startedAt: new Date(started).toISOString(),
  invocation: { executable: process.execPath, args: ['scripts/compare-node-latency-round6.mjs', ...args] },
  configuration, configurations, workloads, runs: [], warnings: [],
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const persist = () => writeFileSync(rawPath, JSON.stringify(raw, null, 2) + '\n');
persist();
function command(executable, argv, options = {}) {
  const remaining = deadline - Date.now();
  assert.ok(remaining > 0, 'Round-six invocation exceeded its 540-second wall budget');
  const result = spawnSync(executable, argv, { cwd: root, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024, windowsHide: true, ...options, timeout: remaining });
  if (result.error || result.status !== 0) throw new Error(`${executable} ${argv.join(' ')}: ${result.error?.message ?? [result.stderr, result.stdout].filter(Boolean).join('\n')}`);
  return result.stdout.trim();
}
function sourceSnapshot(sourceRoot = root, full = true) {
  const files = [];
  function collect(directory, extension) {
    for (const entry of readdirSync(path.join(sourceRoot, directory), { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(file, extension);
      else if (file.endsWith(extension)) files.push(file.replaceAll('\\', '/'));
    }
  }
  for (const name of readdirSync(path.join(sourceRoot, 'go'))) if (name.endsWith('.go') || name === 'go.mod' || name === 'go.sum') files.push(`go/${name}`);
  if (full) {
    collect('src', '.ts'); collect('dist', '.js');
    files.push('scripts/compare-node-latency-round6.mjs', 'scripts/compare-node-round6.mjs', 'scripts/benchmark-node-reference-round6.mjs', 'package.json', 'package-lock.json', 'rollup.config.mjs', 'tsconfig.json', 'tsconfig.build.json');
  }
  const manifest = files.sort().map(file => ({ path: file, sha256: hash(readFileSync(path.join(sourceRoot, file))) }));
  return { sha256: hash(JSON.stringify(manifest)), files: manifest };
}
function goEnvironment(gc, memoryLimit, gomaxprocs) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (['GOGC', 'GOMEMLIMIT', 'GOMAXPROCS', 'DICECORE_NODE_COMPARE_WORKER'].includes(key.toUpperCase())) delete env[key];
  env.GOGC = String(gc); env.GOMAXPROCS = String(gomaxprocs); env.DICECORE_NODE_COMPARE_WORKER = '1';
  if (memoryLimit !== null) env.GOMEMLIMIT = memoryLimit;
  return env;
}
function worker(current, phase, round = null) {
  const request = {
    workers, requests: configuration.requests, samples: configuration.samplesPerProcess, warmup: configuration.warmupPerWorker,
    latencyRequests: configuration.latencyRequests, seedPrefix: configuration.seedPrefix, engineMode: configuration.engineMode,
    validationIndices: configuration.validationIndices, workloads, phase,
  };
  const env = current.runtime === 'go' ? goEnvironment(current.gc, current.memoryLimit, current.gomaxprocs) : { ...process.env };
  const before = Date.now();
  const output = current.runtime === 'go'
    ? command(current.executable, ['-test.run=^TestNodeCompareBenchmarkWorker$'], { cwd: path.join(root, 'go'), env, input: JSON.stringify(request) })
    : command(current.executable, [path.join(root, 'scripts/benchmark-node-reference-round6.mjs')], { env, input: JSON.stringify(request) });
  const lines = output.split(/\r?\n/).filter(line => line.startsWith('DICECORE_NODE_COMPARE '));
  assert.equal(lines.length, 1, `Expected one worker response: ${current.id}`);
  const result = {
    configuration: current.id, runtime: current.runtime, phase, round, wallMilliseconds: Date.now() - before,
    environment: Object.fromEntries(['GOGC', 'GOMEMLIMIT', 'GOMAXPROCS', 'NODE_OPTIONS', 'GODEBUG', 'GOEXPERIMENT'].map(key => [key, env[key] ?? null])),
    request, workerOutputSha256: hash(lines[0]), output: JSON.parse(lines[0].slice('DICECORE_NODE_COMPARE '.length)),
  };
  result.outputCanonicalSha256 = hash(JSON.stringify(result.output));
  assert.equal(result.output.encoder, current.encoder);
  if (current.runtime === 'go') {
    assert.equal(result.output.gomaxprocs, current.gomaxprocs);
    const expectedRuntime = /^go version (\S+)/.exec(raw.environment.go)?.[1];
    assert.ok(expectedRuntime, `Cannot read Go runtime version: ${raw.environment.go}`);
    assert.equal(result.output.runtime, expectedRuntime, `Go runtime differs from the declared toolchain: ${current.id}`);
    assert.equal(result.output.clock?.source, process.platform === 'win32' ? 'QueryPerformanceCounter' : 'time.Now/time.Since monotonic');
    if (process.platform === 'win32') assert.ok(Number.isSafeInteger(result.output.clock.frequencyHz) && result.output.clock.frequencyHz > 0, 'Invalid performance-counter frequency');
  } else {
    assert.equal(result.output.runtime, process.version);
    assert.equal(result.output.clock?.source, 'process.hrtime.bigint');
  }
  assert.deepEqual(Object.keys(result.output.cases).sort(), workloads.map(workload => workload.id).sort());
  return result;
}
function quantile(values, fraction) {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * fraction, lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}
function cpuValue(sample) {
  const cpu = sample.cpu;
  if (!cpu.available) return null;
  assert.ok([cpu.userNs, cpu.systemNs, cpu.totalNs].every(value => Number.isFinite(value) && value >= 0));
  assert.equal(cpu.totalNs, cpu.userNs + cpu.systemNs);
  assert.equal(cpu.userNs, cpu.after.userNs - cpu.before.userNs);
  assert.equal(cpu.systemNs, cpu.after.systemNs - cpu.before.systemNs);
  assert.equal(cpu.before.source, cpu.after.source);
  return cpu.totalNs / sample.requests;
}
function summarize(current, workload) {
  const runs = raw.runs.filter(run => run.configuration === current.id);
  assert.equal(runs.length, 2);
  const batches = runs.flatMap(run => run.output.cases[workload.id]), durations = batches.map(batch => batch.durationNs);
  const cpu = batches.map(cpuValue).filter(value => value !== null);
  const rss = runs.flatMap(run => run.output.memory[workload.id].afterBatches).filter(value => value.available).map(value => value.rssBytes / 2 ** 20);
  const latency = runs.flatMap(run => run.output.latency[workload.id].samplesByWorkerNs.flat());
  const cpuTotalNs = cpu.reduce((total, value) => total + value * configuration.requests, 0);
  assert.equal(durations.length, 6); assert.equal(latency.length, configuration.latencyRequests * 2);
  return {
    batchSamplesNs: durations, batchSamplesCount: durations.length,
    medianBatchMs: quantile(durations, .5) / 1e6, q1BatchMs: quantile(durations, .25) / 1e6, q3BatchMs: quantile(durations, .75) / 1e6,
    opsPerSecond: configuration.requests * 1e9 / quantile(durations, .5),
    cpuSamplesNsPerOp: cpu, cpuSamplesCount: cpu.length, medianCpuNsPerOp: cpu.length ? quantile(cpu, .5) : null,
    cpuMeasuredRequests: cpu.length * configuration.requests,
    measuredCpuTotalNs: cpuTotalNs,
    aggregateCpuNsPerOp: cpu.length === batches.length && cpuTotalNs > 0 ? cpuTotalNs / (batches.length * configuration.requests) : null,
    q1CpuNsPerOp: cpu.length ? quantile(cpu, .25) : null, q3CpuNsPerOp: cpu.length ? quantile(cpu, .75) : null,
    rssSamplesMiB: rss, medianSnapshotRssMiB: rss.length ? quantile(rss, .5) : null, maximumSnapshotRssMiB: rss.length ? Math.max(...rss) : null,
    latencySamplesCount: latency.length, p50LatencyNs: quantile(latency, .5), p95LatencyNs: quantile(latency, .95),
    encodedLengthPerResult: batches[0].digest.encodedLength / batches[0].digest.count,
    encodedLengthUnit: current.runtime === 'go' ? 'UTF-8 bytes' : 'UTF-16 code units',
  };
}
function buildReport(data) {
  const nf = value => value === null ? 'indisponível' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
  const table = render => `| Carga | ${configurations.map(current => current.label).join(' | ')} |\n|---|${configurations.map(() => '---:').join('|')}|\n` +
    data.summary.map(row => `| ${row.input} | ${configurations.map(current => render(row[current.id])).join(' | ')} |`).join('\n') + '\n';
  const winCount = (id, metric, larger) => data.summary.filter(row => row[id][metric] !== null && row.node[metric] !== null && (larger ? row[id][metric] > row.node[metric] : row[id][metric] < row.node[metric])).length;
  const counts = configurations.filter(current => current.runtime === 'go').map(({ id }) => {
    const values = ['p95LatencyNs', 'opsPerSecond', 'aggregateCpuNsPerOp', 'medianSnapshotRssMiB', 'p50LatencyNs'].map((metric, index) => winCount(id, metric, index === 1));
    return `| ${configurations.find(current => current.id === id).label} | ${values.map(value => `${value}/${workloads.length}`).join(' | ')} |`;
  }).join('\n');
  const assessment = data.assessment.map(value => {
    const label = configurations.find(current => current.id === value.configuration).label;
    return `- ${label}: critério completo ${value.allElevenPass ? 'atendido' : 'não atendido'}; cargas sem vitória em p95: ${value.failures.p95.join(', ') || 'nenhuma'}; vazão: ${value.failures.throughput.join(', ') || 'nenhuma'}; CPU/op: ${value.failures.cpu.join(', ') || 'nenhuma'}; RSS: ${value.failures.rss.join(', ') || 'nenhuma'}.`;
  }).join('\n');
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  return `# Rodada 6: configurações de processo para p95 · seis workers\n\n` +
    `Mesma API full seguida de JSON.stringify no Node e dicecore.MarshalJSON no Go. Todas as quatro séries Go usam o mesmo binário fornecido, sem alterar produção, caches ou resultados. ` +
    `O controle usa GOMAXPROCS=12, GOGC=500 e GOMEMLIMIT=96MiB. As três candidatas fixadas antecipadamente usam GOMAXPROCS=6 com GC500/96MiB, GC1500/192MiB e GC3000/256MiB. ` +
    `A métrica principal é p95; o objetivo exige p95 menor que Node nas onze cargas e preserva como critérios adicionais vazão maior, CPU/op menor e RSS mediano menor que Node nas mesmas onze cargas. ` +
    `Resultados de todas as configurações permanecem publicados. Aumentar GOGC e o orçamento de memória pode reduzir trabalho de GC e caudas, mas permite maior retenção; são opções do processo, não mudanças da biblioteca.\n\n` +
    `## Comparações observadas com Node\n\n` +
    `Contagem de cargas em que cada configuração Go teve melhor valor observado. Vazão usa a mediana dos lotes; CPU/op usa soma dos deltas / soma das chamadas; RSS usa mediana; p50/p95 são da passagem individual. ` +
    `Essas contagens não são testes de significância e não comprovam superioridade em toda carga ou uma capacidade HTTP.\n\n` +
    `| Série | p95 menor (principal) | Vazão maior | CPU/op menor | RSS menor | p50 menor |\n|---|---:|---:|---:|---:|---:|\n${counts}\n\n` +
    `Critério completo exige as quatro condições simultaneamente nas onze cargas; valores indisponíveis ou empates não contam como vitória:\n\n${assessment}\n\n` +
    `## Método e escopo\n\n` +
    `${workers} workers de aplicação, uma engine por worker, MT19937, freezeResults='never', limites padrão e cache aquecido. ` +
    `O harness cria explicitamente worker_threads no Node e goroutines no Go. A API Node não distribui as chamadas automaticamente: o backend precisa criar e coordenar seus workers. ` +
    `Os workers não recebem resultados pré-computados ou buffers JSON reutilizáveis. Cada chamada constrói um resultado completo e produz saída própria. ` +
    `Não há HTTP, rede, persistência ou conversão adicional da string JavaScript para bytes UTF-8. O teste inclui despacho/conclusão dos workers e digest por chamada.\n\n` +
    `Cada processo aquece 256 chamadas por worker e mede três lotes de 4096 chamadas por expressão. ` +
    `Duas rodadas em processos novos e ordem invertida produzem seis lotes por série/carga. ` +
    `Seeds são ${configuration.seedPrefix} + índice, distintas dentro do lote e repetidas nas séries. Setup, options, seeds textuais e aquecimento ficam fora do timer; ` +
    `validação/hash da seed e inicialização do gerador fazem parte da rolagem cronometrada.\n\n` +
    `Depois dos três lotes, cada expressão recebe uma passagem separada de 2048 chamadas com timer individual, totalizando 4096 amostras por série/carga. ` +
    `Os timers de lote e individuais usam duas leituras de contador monotônico: QueryPerformanceCounter no Go/Windows, time.Now/time.Since no Go portátil e process.hrtime.bigint no Node. ` +
    `A frequência do contador Windows é resolvida antes dos workers; somente a diferença de ticks é convertida para nanossegundos, com multiplicação intermediária de 128 bits. ` +
    `Cada worker e o coordenador Go possuem um campo de saída QPC próprio, criado antes das medições e reutilizado, sem alocar esse campo por leitura. ` +
    `Fonte e frequência disponíveis ficam registradas em cada resposta bruta. Durações individuais zero ou negativas continuam sendo rejeitadas, sem arredondá-las artificialmente. ` +
    `O timer individual cobre rolagem e serialização; atualização do digest ocorre após o timer. ` +
    `Os timers, armazenamento das amostras e digest perturbam a execução/GC, embora não sejam adicionados aos tempos dos lotes anteriores. ` +
    `São latências de serviço em loops fechados, sem espera em fila ou transporte; não são p95 de uma API HTTP sob tráfego aberto.\n\n` +
    `CPU/op soma tempo de usuário e sistema do processo inteiro, incluindo todos os threads de execução, runtime e GC. ` +
    `GetProcessTimes no Windows/getrusage no Linux e process.cpuUsage no Node são lidos em torno de cada lote, ligeiramente fora do timer de parede. ` +
    `Custo dos leitores e resolução dos contadores introduzem ruído; GetProcessTimes pode apresentar deltas quantizados em torno de 15,6 ms no Windows, apesar de expressar valores em unidades de 100 ns. ` +
    `CPU/op principal agrega soma dos deltas / soma das chamadas dos seis lotes. Se alguma leitura faltar ou todos os deltas forem zero, o agregado fica indisponível. ` +
    `Valores zero isolados em lotes curtos não significam trabalho gratuito. Não são CPU individual nem percentis de CPU. ` +
    `CPU/op pode exceder o tempo de parede por operação quando threads trabalham simultaneamente.\n\n` +
    `RSS usa snapshots após os lotes, antes da passagem de latência, com workers e últimos resultados/JSON vivos. ` +
    `Inclui runtime/harness e memória retida de expressões anteriores; não é pico, teto ou memória isolada por expressão. ` +
    `GOMEMLIMIT de 96, 192 ou 256 MiB é flexível e não limita rigidamente o RSS. O orçamento maior é um custo explícito da experiência; seu uso em um servidor depende da memória dos demais componentes e da carga real.\n\n` +
    `Ordem inicial: ${configuration.orders[0].join(' → ')}. Ordem final: ${configuration.orders[1].join(' → ')}. ` +
    `Ordem das cargas: ${workloads.map(workload => workload.input).join(' → ')}. ` +
    `As onze expressões do confronto anterior foram fixadas antes deste ensaio; seus rótulos de categoria conservam a origem histórica. Nenhuma é apresentada como holdout inédito desta seleção de configuração. ` +
    `Todas as séries usam seis workers. Este ensaio tem arquivos próprios e não agrega amostras dos confrontos anteriores.\n\n` +
    `## Ambiente, fontes e paridade\n\n${data.environment.cpuModel.trim()} · ${data.environment.osVersion} · ${data.environment.logicalCPUs} CPUs lógicas. ` +
    `Node ${data.environment.node} · ${data.environment.go}. Fontes atuais sobre ${data.git.commit}; manifesto ${data.source.sha256}. ` +
    `Mesmo binário Go em todas as configurações, SHA-256 ${data.binaries.current.sha256}. ` +
    `Manifestos identificam as fontes, workers, dist TypeScript e executável, com build info; eles não provam independentemente como o binário fornecido foi construído. O script não compila nem modifica código.\n\n` +
    `Preflight: ${data.preflight.uniqueOutputs} resultados completos em cada uma das ${configurations.length} séries. ` +
    `Cada Go compara bytes com encoding/json.Marshal; o orquestrador compara todos os bytes entre as quatro configurações Go e JSON decodificado integral entre Node/Go. ` +
    `Todos os lotes e passagens individuais devem ter contagem, totais, soma ponderada e chamadas aleatórias idênticas. ` +
    `Comprimentos Go são idênticos; Node mede unidades UTF-16, Go bytes UTF-8, portanto o comentário Unicode pode produzir comprimentos distintos. ` +
    `Os digests não substituem conformidade e testes de propriedade.\n\n` +
    `## Vazão e tempo dos lotes\n\nCada célula: operações/s / mediana em ms [Q1–Q3].\n\n` +
    table(value => `${nf(value.opsPerSecond)} / ${nf(value.medianBatchMs)} [${nf(value.q1BatchMs)}–${nf(value.q3BatchMs)}]`) +
    `\n## CPU por operação\n\nAgregado em µs de CPU/op / mediana dos lotes [Q1–Q3], processo inteiro; menor é melhor. Leituras brutas estão no JSON.\n\n` +
    table(value => value.aggregateCpuNsPerOp === null ? 'indisponível' : `${nf(value.aggregateCpuNsPerOp / 1000)} / ${nf(value.medianCpuNsPerOp / 1000)} [${nf(value.q1CpuNsPerOp / 1000)}–${nf(value.q3CpuNsPerOp / 1000)}]`) +
    `\n## Latências individuais\n\nCada célula: p50 / p95 em µs, passagem separada com ${configuration.latencyRequests * 2} amostras; menor é melhor.\n\n` +
    table(value => `${nf(value.p50LatencyNs / 1000)} / ${nf(value.p95LatencyNs / 1000)}`) +
    `\n## Memória residente\n\nCada célula: mediana / maior snapshot RSS em MiB.\n\n` +
    table(value => `${nf(value.medianSnapshotRssMiB)} / ${nf(value.maximumSnapshotRssMiB)}`) +
    `\n## Reprodução e arquivos\n\n\`\`\`powershell\nnode scripts/compare-node-latency-round6.mjs --go ${quote(go)} --candidate ${quote(binary)}\n\`\`\`\n\n` +
    `O executável fornecido deve conter os workers QPC já usados no confronto anterior. O script apenas o identifica e executa; não há compilação. Limite de 540 segundos por invocação, incluindo preflight; observado: ${nf(data.wallMilliseconds / 1000)} s. ` +
    `Uma série por vez, duas ordens inversas, sem modificar cargas ou repetir seletivamente casos após observar resultados. Falhas preservam os dados parciais; a máquina compartilhada, GC, frequência e escalonamento introduzem variação.\n\n` +
    `[Dados brutos e manifestos](benchmarks/optimization-round6/${runName}.json) · [Preflight integral](benchmarks/optimization-round6/${runName}-preflight.json.gz) · ` +
    `[Orquestrador](../scripts/compare-node-latency-round6.mjs) · [Worker Go](node_compare_bench_test.go) · [Worker Node](../scripts/benchmark-node-reference-round6.mjs).\n`;
}

try {
  assert.ok(existsSync(binary), `Missing supplied Go executable: ${binary}`);
  assert.ok(existsSync(path.join(root, 'dist/index.js')), 'Build the TypeScript dist before this comparison');
  assert.ok(configurations.filter(current => current.runtime === 'go').every(current => current.executable === binary));
  raw.environment = {
    cpuModel: os.cpus()[0].model, logicalCPUs: os.cpus().length, osVersion: os.version(), osRelease: os.release(), platform: process.platform, arch: process.arch,
    node: process.version, go: command(go, ['version']),
    inheritedEnvironment: Object.fromEntries(['NODE_OPTIONS', 'GOGC', 'GOMEMLIMIT', 'GOMAXPROCS', 'GODEBUG', 'GOEXPERIMENT', 'GOFLAGS'].map(key => [key, process.env[key] ?? null])),
  };
  raw.git = { commit: command('git', ['rev-parse', 'HEAD']), statusLines: command('git', ['status', '--porcelain=v1']).split(/\r?\n/).filter(Boolean) };
  const workerManifest = [...workerFiles, 'scripts/benchmark-node-reference-round6.mjs'].sort().map(file => ({ path: file, sha256: hash(readFileSync(path.join(root, file))) }));
  raw.workerSource = { sha256: hash(JSON.stringify(workerManifest)), files: workerManifest };
  raw.source = sourceSnapshot();
  raw.binaries = { current: { path: binary, sha256: hash(readFileSync(binary)), buildInfo: command(go, ['version', '-m', binary]), supplied: true } };
  raw.commands = [];
  persist();
  assert.equal(sourceSnapshot().sha256, raw.source.sha256, 'Source changed before preflight'); persist();
  const preflight = { validationIndices: configuration.validationIndices, runs: [] };
  let expectedValues, expectedGoBytes;
  for (const current of configurations) {
    const run = worker(current, 'preflight'); preflight.runs.push(run);
    writeFileSync(preflightPath, gzipSync(Buffer.from(JSON.stringify(preflight, null, 2) + '\n'), { level: 1 }));
    const values = {}, encoded = {};
    for (const workload of workloads) {
      const entries = run.output.cases[workload.id];
      assert.deepEqual(entries.map(entry => entry.index), configuration.validationIndices);
      values[workload.id] = entries.map(entry => {
        assert.equal(current.runtime === 'go' ? Buffer.byteLength(entry.json) : entry.json.length, entry.encodedLength);
        if (current.runtime === 'go') assert.equal(entry.stdlibEqual, true);
        return { index: entry.index, value: JSON.parse(entry.json) };
      });
      encoded[workload.id] = entries.map(entry => ({ index: entry.index, json: entry.json }));
    }
    if (expectedValues === undefined) expectedValues = values; else assert.deepStrictEqual(values, expectedValues, `Complete JSON values: ${current.id}`);
    if (current.runtime === 'go') {
      if (expectedGoBytes === undefined) expectedGoBytes = encoded; else assert.deepStrictEqual(encoded, expectedGoBytes, `Complete Go bytes: ${current.id}`);
    }
  }
  const preflightBytes = Buffer.from(JSON.stringify(preflight, null, 2) + '\n'), compressed = gzipSync(preflightBytes, { level: 9 });
  assert.deepEqual(gunzipSync(compressed), preflightBytes); writeFileSync(preflightPath, compressed);
  raw.preflight = { passed: true, goStdlibByteEquality: true, goConfigurationByteEquality: true, completeDecodedValueEquality: true,
    configurations: configurations.length, uniqueOutputs: workloads.length * configuration.validationIndices.length, file: path.relative(root, preflightPath).replaceAll('\\', '/'),
    compressedSha256: hash(compressed), uncompressedSha256: hash(preflightBytes), compressedBytes: compressed.length, uncompressedBytes: preflightBytes.length };
  persist();
  const expectedDigests = {}, goLengths = {}, seriesLengths = {};
  function verifyDigest(workload, current, digest, expectedCount) {
    assert.equal(digest.count, expectedCount);
    const { encodedLength, ...values } = digest;
    assert.deepEqual(Object.keys(values).sort(), ['count', 'randomCalls', 'total', 'weightedTotal']);
    assert.ok(Object.values(values).every(Number.isFinite)); assert.ok(Number.isFinite(encodedLength) && encodedLength > 0);
    const key = `${workload}/${expectedCount}`;
    if (expectedDigests[key] === undefined) expectedDigests[key] = values; else assert.deepStrictEqual(values, expectedDigests[key], `Delivery digest: ${workload}/${current.id}`);
    if (current.runtime === 'go') {
      if (goLengths[key] === undefined) goLengths[key] = encodedLength; else assert.equal(encodedLength, goLengths[key], `Go byte length: ${workload}`);
    }
    const seriesKey = `${current.id}/${key}`;
    if (seriesLengths[seriesKey] === undefined) seriesLengths[seriesKey] = encodedLength; else assert.equal(encodedLength, seriesLengths[seriesKey], `Stable encoded length: ${seriesKey}`);
  }
  for (let round = 0; round < 2; round++) for (const id of configuration.orders[round]) {
    const current = configurations.find(current => current.id === id);
    console.log(`Round 6 latency configuration · ${workers} workers · ${round + 1}/2 · ${id}`);
    const run = worker(current, 'measure', round + 1); raw.runs.push(run); persist();
    for (const workload of workloads) {
      const batches = run.output.cases[workload.id], snapshots = run.output.memory[workload.id].afterBatches;
      assert.equal(batches.length, 3); assert.equal(snapshots.length, 3);
      for (const batch of batches) {
        assert.equal(batch.workers, workers); assert.equal(batch.requests, configuration.requests);
        assert.ok(Number.isFinite(batch.durationNs) && batch.durationNs > 0);
        verifyDigest(workload.id, current, batch.digest, configuration.requests);
        const cpu = cpuValue(batch);
        if (cpu === null) raw.warnings.push(`CPU unavailable: ${id}/${workload.id}/round${round + 1}`);
        else if (cpu === 0) raw.warnings.push(`Zero CPU delta at counter resolution: ${id}/${workload.id}/round${round + 1}`);
      }
      for (const snapshot of snapshots) if (snapshot.available) assert.ok(Number.isFinite(snapshot.rssBytes) && snapshot.rssBytes > 0);
      const individual = run.output.latency[workload.id];
      assert.equal(individual.requests, configuration.latencyRequests); assert.equal(individual.samplesByWorkerNs.length, workers);
      individual.samplesByWorkerNs.forEach((samples, worker) => {
        assert.equal(samples.length, Math.floor((configuration.latencyRequests - 1 - worker) / workers) + 1);
        assert.ok(samples.every(value => Number.isFinite(value) && value > 0), `Individual durations: ${id}/${workload.id}`);
      });
      verifyDigest(workload.id, current, individual.digest, configuration.latencyRequests);
    }
    persist();
  }
  raw.summary = workloads.map(workload => ({ ...workload, workers,
    ...Object.fromEntries(configurations.map(current => [current.id, summarize(current, workload)])) }));
  raw.assessment = configurations.filter(current => current.runtime === 'go').map(current => {
    const fails = (metric, larger) => raw.summary.filter(row => {
      const value = row[current.id][metric], reference = row.node[metric];
      return !Number.isFinite(value) || !Number.isFinite(reference) || !(larger ? value > reference : value < reference);
    }).map(row => row.id);
    const failures = {
      p95: fails('p95LatencyNs', false), throughput: fails('opsPerSecond', true),
      cpu: fails('aggregateCpuNsPerOp', false), rss: fails('medianSnapshotRssMiB', false),
    };
    return { configuration: current.id, role: current.id === 'go-control' ? 'control' : 'candidate',
      allElevenPass: Object.values(failures).every(values => values.length === 0), failures };
  });
  assert.equal(sourceSnapshot().sha256, raw.source.sha256, 'Source changed during comparison');
  for (const [label, binary] of Object.entries(raw.binaries)) assert.equal(hash(readFileSync(binary.path)), binary.sha256, `Executable changed: ${label}`);
  assert.ok(Date.now() <= deadline, 'Round-six invocation exceeded its 540-second wall budget');
  raw.checks = { currentSourceStable: true, sameGoExecutable: true, gomaxprocsPerConfiguration: true, executableHashesStable: true,
    fullPreflightParity: true, deliveryDigests: true, perSeriesEncodedLengthsStable: true, individualSampleCounts: true, batchCounts: true };
  raw.status = 'complete'; raw.finishedAt = new Date().toISOString(); raw.wallMilliseconds = Date.now() - started; persist();
  writeFileSync(path.join(root, 'go', 'NODE_LATENCY_ROUND6.md'), buildReport(raw));
  console.log(`Saved ${path.relative(root, rawPath)} in ${(raw.wallMilliseconds / 1000).toFixed(1)} seconds.`);
} catch (error) {
  raw.status = 'failed'; raw.error = { message: error.message, stack: error.stack }; raw.finishedAt = new Date().toISOString(); raw.wallMilliseconds = Date.now() - started; persist();
  console.error(error.stack); process.exitCode = 1;
}
