/** Serial, bounded comparison of full results + JSON against the round-two binary. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
let go = process.env.GO_BINARY ?? 'go', bun = process.env.BUN_BINARY ?? 'bun';
let baseline = path.join(root, '.artifacts/optimization-round3/baseline.exe');
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--go' && args[index + 1]) go = args[++index];
  else if (args[index] === '--baseline' && args[index + 1]) baseline = path.resolve(args[++index]);
  else if (args[index] === '--bun' && args[index + 1]) bun = args[++index];
  else throw new Error(`Unknown or incomplete argument ${args[index]}`);
}
const started = Date.now(), deadline = started + 300000;
const directory = path.join(root, 'go/benchmarks/optimization-round3');
const binary = path.join(root, `.artifacts/optimization-round3/json-final${process.platform === 'win32' ? '.exe' : ''}`);
mkdirSync(directory, { recursive: true });
mkdirSync(path.dirname(binary), { recursive: true });
const rawPath = path.join(directory, 'json-round3.json');
const preflightPath = path.join(directory, 'json-round3-preflight.json.gz');
const baselineRef = 'ca34ff9';
const workloads = [['d20', '1d20+5'], ['100d6', '100d6'], ['pool', '20d6!2ro=1kh10']]
  .map(([id, input]) => ({ id, input, mode: 'full', label: `${input} · full` }));
const configurations = [
  { id: 'node', label: 'Node', runtime: 'node', executable: process.execPath },
  { id: 'bun', label: 'Bun', runtime: 'bun', executable: bun },
  { id: 'go-baseline-default', label: 'Go anterior padrão', runtime: 'go', executable: baseline, gc: 100, memoryLimit: null },
  { id: 'go-final-default', label: 'Go atual padrão', runtime: 'go', executable: binary, gc: 100, memoryLimit: null },
  { id: 'go-baseline-tuned', label: 'Go anterior configurado', runtime: 'go', executable: baseline, gc: 500, memoryLimit: '96MiB' },
  { id: 'go-final-tuned', label: 'Go atual configurado', runtime: 'go', executable: binary, gc: 500, memoryLimit: '96MiB' },
];
const configuration = {
  workers: 6, gomaxprocs: 12, requests: 5000, samplesPerProcess: 3, rounds: 2, warmupPerWorker: 1000,
  operation: 'build-and-encode', seedPrefix: 'dicecore-backend/v3.7.1/', algorithm: 'mt19937',
  engineMode: 'pool', freezeResults: 'never', cache: 'warm', wallBudgetMs: 300000,
  validationIndices: [0, 1, 5, 127, 511, 4999],
  orders: [configurations.map(value => value.id), configurations.map(value => value.id).reverse()],
};
const raw = {
  schemaVersion: 1, status: 'running', startedAt: new Date(started).toISOString(),
  invocation: { executable: process.execPath, args: ['scripts/compare-json-round3.mjs', ...args] },
  configuration, configurations, workloads, runs: [],
};
const hash = value => createHash('sha256').update(value).digest('hex');
const persist = () => writeFileSync(rawPath, JSON.stringify(raw, null, 2) + '\n');
persist();
function command(executable, argv, options = {}) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('JSON round-three benchmark exceeded its 300-second wall-clock budget');
  const result = spawnSync(executable, argv, {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...options, timeout: remaining,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} ${argv.join(' ')} failed: ${result.error?.message ?? [result.stderr, result.stdout].filter(Boolean).join('\n')}`);
  }
  return result.stdout.trim();
}
function snapshot() {
  const files = [];
  function collect(directory, include) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(file, include);
      else if (include(file)) files.push(file.replaceAll('\\', '/'));
    }
  }
  collect('src', file => file.endsWith('.ts') && !file.endsWith('.test.ts'));
  collect('dist', file => file.endsWith('.js'));
  for (const file of readdirSync(path.join(root, 'go'))) if (file.endsWith('.go')) files.push(`go/${file}`);
  files.push('scripts/benchmark-json-reference.mjs', 'scripts/compare-json-round3.mjs',
    'package.json', 'package-lock.json', 'go/go.mod', 'rollup.config.mjs', 'tsconfig.json', 'tsconfig.build.json');
  const manifest = files.sort().map(file => ({ path: file, sha256: hash(readFileSync(path.join(root, file))) }));
  return { sha256: hash(JSON.stringify(manifest)), files: manifest };
}
function cleanGoEnvironment(gc, memoryLimit) {
  const env = { ...process.env };
  // Windows environment names are case-insensitive; remove every inherited spelling.
  for (const key of Object.keys(env)) if (['GOGC', 'GOMEMLIMIT', 'GOMAXPROCS'].includes(key.toUpperCase())) delete env[key];
  env.GOGC = String(gc);
  env.GOMAXPROCS = String(configuration.gomaxprocs);
  if (memoryLimit !== null) env.GOMEMLIMIT = memoryLimit;
  return env;
}
function worker(current, phase, round = null) {
  const request = {
    workers: configuration.workers, requests: configuration.requests, samples: configuration.samplesPerProcess,
    warmup: configuration.warmupPerWorker, operation: configuration.operation, seedPrefix: configuration.seedPrefix,
    engineMode: configuration.engineMode, validationIndices: configuration.validationIndices, workloads, phase,
  };
  const before = Date.now();
  const env = current.runtime === 'go'
    ? { ...cleanGoEnvironment(current.gc, current.memoryLimit), DICECORE_JSON_WORKER: '1' }
    : { ...process.env };
  const output = current.runtime === 'go'
    ? command(current.executable, ['-test.run=^TestJSONBenchmarkWorker$'], { cwd: path.join(root, 'go'), env, input: JSON.stringify(request) })
    : command(current.executable, [path.join(root, 'scripts/benchmark-json-reference.mjs')], { env, input: JSON.stringify(request) });
  const line = output.split(/\r?\n/).find(value => value.startsWith('DICECORE_JSON '));
  assert.ok(line, `Missing JSON worker output: ${output.slice(0, 500)}`);
  const result = {
    configuration: current.id, runtime: current.runtime, phase, round, wallMilliseconds: Date.now() - before,
    environment: Object.fromEntries(['GOGC', 'GOMEMLIMIT', 'GOMAXPROCS', 'NODE_OPTIONS', 'GODEBUG', 'GOEXPERIMENT'].map(key => [key, env[key] ?? null])),
    request, output: JSON.parse(line.slice('DICECORE_JSON '.length)),
  };
  if (current.runtime === 'go') assert.equal(result.output.gomaxprocs, configuration.gomaxprocs, `GOMAXPROCS ${current.id}`);
  assert.deepEqual(Object.keys(result.output.cases).sort(), workloads.map(value => value.id).sort());
  return result;
}
function quantile(values, q) {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * q, lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}
function summarize(current, workload) {
  const runs = raw.runs.filter(run => run.configuration === current.id);
  assert.equal(runs.length, configuration.rounds);
  const measurements = runs.flatMap(run => run.output.cases[workload.id]);
  const samples = measurements.map(value => value.durationNs), median = quantile(samples, 0.5);
  const rss = runs.flatMap(run => run.output.memory[workload.id].afterBatches)
    .filter(value => value.available).map(value => value.rssBytes / 2 ** 20);
  assert.equal(samples.length, configuration.rounds * configuration.samplesPerProcess);
  return {
    samples, samplesCount: samples.length, medianBatchMs: median / 1e6,
    q1BatchMs: quantile(samples, 0.25) / 1e6, q3BatchMs: quantile(samples, 0.75) / 1e6,
    opsPerSecond: configuration.requests * 1e9 / median,
    encodedLengthPerResult: measurements[0].digest.encodedLength / measurements[0].digest.count,
    rssSamplesMiB: rss, medianSnapshotRssMiB: rss.length ? quantile(rss, 0.5) : null,
    maximumSnapshotRssMiB: rss.length ? Math.max(...rss) : null,
  };
}
function report(data) {
  const nf = value => value === null ? 'indisponível' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
  const columns = configurations.map(value => value.label);
  const table = render => `| Carga | ${columns.join(' | ')} |\n|---|${columns.map(() => '---:').join('|')}|\n` +
    data.summary.map(row => `| ${row.label} | ${configurations.map(current => render(row[current.id])).join(' | ')} |`).join('\n') + '\n';
  const comparisons = data.summary.map(row => {
    const defaults = row['go-final-default'].opsPerSecond / row['go-baseline-default'].opsPerSecond;
    const tuned = row['go-final-tuned'].opsPerSecond / row['go-baseline-tuned'].opsPerSecond;
    const node = row['go-final-tuned'].opsPerSecond / row.node.opsPerSecond;
    const bun = row['go-final-tuned'].opsPerSecond / row.bun.opsPerSecond;
    return `| ${row.label} | ${nf(defaults)}× | ${nf(tuned)}× | ${nf(node)}× | ${nf(bun)}× |`;
  }).join('\n');
  const defaultWins = data.summary.filter(row => row['go-final-default'].opsPerSecond > Math.max(row.node.opsPerSecond, row.bun.opsPerSecond)).length;
  const tunedWins = data.summary.filter(row => row['go-final-tuned'].opsPerSecond > Math.max(row.node.opsPerSecond, row.bun.opsPerSecond)).length;
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  return `# Rodada 3: resultado completo + JSON\n\n` +
    `Comparação local da API full seguida por JSON.stringify em Node/Bun e encoding/json.Marshal em Go. ` +
    `Go atual teve a maior mediana de vazão em **${defaultWins}/3 cargas com GC padrão** e **${tunedWins}/3 com GC configurado**, comparado aos dois runtimes JavaScript. ` +
    `Essas contagens descrevem esta amostra; não são um teste de significância ou uma garantia de capacidade HTTP.\n\n` +
    `## Ambiente e origem\n\n${data.environment.cpuModel.trim()} · ${data.environment.osVersion} · ${data.environment.logicalCPUs} CPUs lógicas. ` +
    `Node ${data.environment.node}, Bun ${data.environment.bun}, ${data.environment.go}. ` +
    `Baseline declarado: commit \`${data.baseline.commit}\` (\`${baselineRef}\`), executável preservado antes das alterações. ` +
    `Atual: árvore sobre \`${data.git.commit}\`, ${data.git.statusLines.length} entradas modificadas; o manifesto registra os bytes efetivamente compilados e executados.\n\n` +
    `O executável baseline é fornecido pelo chamador; o script registra seu SHA-256 e build info, mas não recompila nem prova por si só sua origem. ` +
    `Os arquivos dos workers Go e JavaScript foram comparados ao commit baseline e permaneceram iguais (desconsiderando apenas CRLF/LF). ` +
    `O dist TypeScript existente é usado sem rebuild e possui hashes próprios no manifesto. ` +
    `Baseline SHA-256: \`${data.binaries.baseline.sha256}\`. Atual SHA-256: \`${data.binaries.final.sha256}\`. ` +
    `Fontes estáveis: \`${data.source.sha256}\`.\n\n` +
    `## Método\n\n` +
    `Três cargas full, seis workers de aplicação e uma engine por worker. MT19937, limites padrão, freezeResults='never', cache aquecido, ` +
    `seeds únicas no lote (prefixo \`${configuration.seedPrefix}\` + índice), repetidas entre configurações para permitir a comparação exata. ` +
    `Todos os processos Go usam GOMAXPROCS=${configuration.gomaxprocs}. Controles: GOGC=100 e GOMEMLIMIT removido do ambiente. ` +
    `Configurados: GOGC=500 e GOMEMLIMIT=96MiB, parâmetros reutilizados da rodada 2, sem nova seleção. ` +
    `GOMEMLIMIT é um limite flexível da memória gerenciada pelo runtime, não um teto rígido de RSS. A biblioteca não altera o GC global.\n\n` +
    `Cada processo aquece ${configuration.warmupPerWorker} chamadas por worker por carga e mede ${configuration.samplesPerProcess} lotes de ${configuration.requests} chamadas. ` +
    `São duas rodadas com novos processos e ordem invertida, totalizando seis lotes por configuração/carga. ` +
    `Primeira ordem: ${configuration.orders[0].join(' → ')}. Segunda ordem: ${configuration.orders[1].join(' → ')}. ` +
    `As cargas seguem a mesma ordem em cada processo: ${workloads.map(value => value.input).join(' → ')}. ` +
    `Não há processos de medição simultâneos dentro deste script. Compilação única, imports, startup, criação de options e aquecimento ficam fora do cronômetro dos lotes.\n\n` +
    `O tempo de lote inclui despacho, rolagem, construção do resultado, serialização e espera pelos seis workers. ` +
    `Não inclui HTTP, rede ou conversão adicional da string JavaScript para Buffer UTF-8. ` +
    `Preflight: igualdade integral do JSON decodificado nas seeds de índices ${configuration.validationIndices.join(', ')} em todas as seis configurações, sem tolerância numérica. ` +
    `Todos os lotes devem concordar em contagem, totais, totais ponderados e chamadas aleatórias; o comprimento codificado é validado entre lotes da mesma configuração. ` +
    `O corpus é ASCII, confirmado no preflight; len(bytes) e string.length medem os comprimentos correspondentes nesse corpus. Ordem das chaves e diferenças textuais de codificação não são forçadas a coincidir.\n\n` +
    `## Vazão e dispersão\n\nCada célula: **operações/s / mediana do lote em ms [Q1–Q3]**. ` +
    `Quartis calculados sobre seis lotes; não são p95 nem percentis da latência de chamadas individuais.\n\n` +
    table(value => `${nf(value.opsPerSecond)} / ${nf(value.medianBatchMs)} [${nf(value.q1BatchMs)}–${nf(value.q3BatchMs)}]`) +
    `\n## Comparação das medianas\n\nValores maiores que 1 indicam vantagem do numerador; ganhos próximos do ruído exigem confirmação adicional antes de conclusões fortes.\n\n` +
    `| Carga | Go atual/anterior padrão | Go atual/anterior configurado | Go atual configurado/Node | Go atual configurado/Bun |\n|---|---:|---:|---:|---:|\n${comparisons}\n\n` +
    `## Memória observada\n\nCada célula: **mediana / maior snapshot RSS em MiB**. ` +
    `Snapshots após os lotes, com workers e últimos resultados vivos, incluindo runtime e harness. ` +
    `Não representam pico, limite ou custo isolado da expressão: o processo percorre cargas sucessivas e pode reter memória anterior.\n\n` +
    table(value => `${nf(value.medianSnapshotRssMiB)} / ${nf(value.maximumSnapshotRssMiB)}`) +
    `\n## Comprimento médio emitido\n\nBytes por resultado neste corpus ASCII; diferença de tamanho não implica diferença dos valores JSON.\n\n` +
    table(value => nf(value.encodedLengthPerResult)) +
    `\n## Reprodução e evidência\n\n\`\`\`powershell\nnode scripts/compare-json-round3.mjs --go ${quote(go)} --baseline ${quote(baseline)} --bun ${quote(bun)}\n\`\`\`\n\n` +
    `Requer o executável de testes salvo do baseline, Go, Node, Bun e dist já construído. ` +
    `Teto total de 300 segundos, incluindo preparação, compilação e preflight; duração observada: ${nf(data.wallMilliseconds / 1000)} segundos. ` +
    `O script persiste medições parciais em caso de falha. Os resultados e relatórios das rodadas anteriores permanecem preservados. ` +
    `Este ensaio usa lotes e aquecimento diferentes da rodada 2; a comparação causal é atual/anterior medidos nesta mesma rodada. ` +
    `CPU, JIT, GC, escalonamento e outras tarefas da máquina podem afetar medições locais.\n\n` +
    `[Dados brutos e manifestos](benchmarks/optimization-round3/json-round3.json) · ` +
    `[Preflight integral gzip](benchmarks/optimization-round3/json-round3-preflight.json.gz) · ` +
    `[Orquestrador](../scripts/compare-json-round3.mjs) · [Rodada anterior](JSON_BENCHMARK.md).\n`;
}
try {
  assert.ok(existsSync(baseline), `Missing preserved baseline executable: ${baseline}`);
  assert.notEqual(path.resolve(baseline).toLowerCase(), path.resolve(binary).toLowerCase(), 'Baseline and candidate binaries must differ');
  assert.ok(existsSync(path.join(root, 'dist/index.js')), 'Build TypeScript dist before invoking this experiment');
  raw.environment = {
    cpuModel: os.cpus()[0].model, logicalCPUs: os.cpus().length, osVersion: os.version(), osRelease: os.release(),
    platform: process.platform, arch: process.arch, node: process.version, bun: command(bun, ['--version']), go: command(go, ['version']),
    inheritedEnvironment: Object.fromEntries(['NODE_OPTIONS', 'GOGC', 'GOMEMLIMIT', 'GOMAXPROCS', 'GODEBUG', 'GOEXPERIMENT', 'GOFLAGS'].map(key => [key, process.env[key] ?? null])),
  };
  raw.git = { commit: command('git', ['rev-parse', 'HEAD']), statusLines: command('git', ['status', '--porcelain=v1']).split(/\r?\n/).filter(Boolean) };
  raw.baseline = {
    commit: command('git', ['rev-parse', `${baselineRef}^{commit}`]), reference: baselineRef, suppliedExecutable: baseline, workers: [],
    // Git object IDs identify every preserved source blob without rebuilding the baseline.
    sourceTree: command('git', ['ls-tree', '-r', '--full-tree', baselineRef, 'go', 'src']).split(/\r?\n/)
      .filter(line => /\t(?:go\/[^/]+\.go|go\/go\.mod|src\/.*\.ts)$/.test(line)),
  };
  const workerFiles = ['go/json_benchmark_test.go', 'go/backend_benchmark_test.go', 'go/backend_rss_windows_test.go',
    'go/backend_rss_linux_test.go', 'go/backend_rss_other_test.go', 'scripts/benchmark-json-reference.mjs'];
  for (const file of workerFiles) {
    const committed = command('git', ['show', `${baselineRef}:${file}`]).replaceAll('\r\n', '\n').trim();
    const current = readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n').trim();
    assert.equal(current, committed, `Worker must remain unchanged from baseline: ${file}`);
    raw.baseline.workers.push({ path: file, normalizedSha256: hash(committed) });
  }
  raw.source = snapshot();
  raw.binaries = { baseline: { path: baseline, sha256: hash(readFileSync(baseline)), buildInfo: command(go, ['version', '-m', baseline]) } };
  raw.commands = [{ executable: go, args: ['test', '-c', '-o', binary], cwd: path.join(root, 'go') }];
  persist();
  command(go, raw.commands[0].args, { cwd: path.join(root, 'go'), env: cleanGoEnvironment(100, null) });
  assert.equal(snapshot().sha256, raw.source.sha256, 'Source changed during candidate compilation');
  raw.binaries.final = { path: binary, sha256: hash(readFileSync(binary)), buildInfo: command(go, ['version', '-m', binary]) };
  persist();
  const preflight = { validationIndices: configuration.validationIndices, runs: [] };
  let expectedValues;
  for (const current of configurations) {
    const run = worker(current, 'preflight');
    preflight.runs.push(run);
    writeFileSync(preflightPath, gzipSync(Buffer.from(JSON.stringify(preflight, null, 2) + '\n'), { level: 1 }));
    const values = Object.fromEntries(Object.entries(run.output.cases).map(([id, cases]) => {
      assert.deepEqual(cases.map(value => value.index), configuration.validationIndices);
      return [id, cases.map(value => {
        assert.ok([...value.json].every(char => char.charCodeAt(0) <= 127), 'Length accounting requires an ASCII corpus');
        assert.equal(Buffer.byteLength(value.json), value.encodedLength);
        return { index: value.index, value: JSON.parse(value.json) };
      })];
    }));
    if (expectedValues === undefined) expectedValues = values;
    else assert.deepStrictEqual(values, expectedValues, `Full parsed JSON values: ${current.id}`);
  }
  const preflightBytes = Buffer.from(JSON.stringify(preflight, null, 2) + '\n'), archive = gzipSync(preflightBytes, { level: 9 });
  assert.deepEqual(gunzipSync(archive), preflightBytes);
  writeFileSync(preflightPath, archive);
  raw.preflight = {
    passed: true, configurations: preflight.runs.length, uniqueOutputs: workloads.length * configuration.validationIndices.length,
    file: path.relative(root, preflightPath).replaceAll('\\', '/'), uncompressedSha256: hash(preflightBytes), compressedSha256: hash(archive),
    uncompressedBytes: preflightBytes.length, compressedBytes: archive.length,
  };
  persist();
  const expectedDigests = {}, expectedLengths = {};
  for (let round = 0; round < configuration.rounds; round++) {
    for (const id of configuration.orders[round]) {
      const current = configurations.find(value => value.id === id);
      console.log(`JSON round 3: round ${round + 1}/${configuration.rounds}, ${current.id}`);
      const run = worker(current, 'measure', round + 1);
      raw.runs.push(run); persist();
      for (const [workload, measurements] of Object.entries(run.output.cases)) {
        assert.equal(measurements.length, configuration.samplesPerProcess);
        assert.equal(run.output.memory[workload].afterBatches.length, configuration.samplesPerProcess);
        for (const measured of measurements) {
          assert.equal(measured.requests, configuration.requests);
          assert.equal(measured.workers, configuration.workers);
          assert.equal(measured.digest.count, configuration.requests);
          assert.ok(Number.isFinite(measured.durationNs) && measured.durationNs > 0 && measured.digest.encodedLength > 0);
          const { encodedLength, ...digest } = measured.digest;
          if (expectedDigests[workload] === undefined) expectedDigests[workload] = digest;
          else assert.deepStrictEqual(digest, expectedDigests[workload], `Delivery digest: ${workload}/${current.id}/round${round + 1}`);
          const key = `${current.id}/${workload}`;
          if (expectedLengths[key] === undefined) expectedLengths[key] = encodedLength;
          else assert.equal(encodedLength, expectedLengths[key], `Encoded length stability: ${key}`);
        }
      }
    }
  }
  raw.summary = workloads.map(workload => ({ id: workload.id, label: workload.label, workers: configuration.workers,
    ...Object.fromEntries(configurations.map(current => [current.id, summarize(current, workload)])) }));
  assert.equal(snapshot().sha256, raw.source.sha256, 'Source changed during measurement');
  assert.equal(hash(readFileSync(baseline)), raw.binaries.baseline.sha256, 'Baseline executable changed during measurement');
  assert.equal(hash(readFileSync(binary)), raw.binaries.final.sha256, 'Candidate executable changed during measurement');
  assert.ok(Date.now() <= deadline, 'JSON round-three benchmark exceeded its 300-second wall-clock budget');
  raw.status = 'complete'; raw.finishedAt = new Date().toISOString(); raw.wallMilliseconds = Date.now() - started; persist();
  writeFileSync(path.join(root, 'go/JSON_ROUND3_BENCHMARK.md'), report(raw));
  console.log(`Saved ${path.relative(root, rawPath)} in ${Math.round(raw.wallMilliseconds / 1000)} seconds.`);
} catch (error) {
  raw.status = 'failed'; raw.error = { message: error.message, stack: error.stack };
  raw.finishedAt = new Date().toISOString(); raw.wallMilliseconds = Date.now() - started; persist();
  console.error(error.stack); process.exitCode = 1;
}
