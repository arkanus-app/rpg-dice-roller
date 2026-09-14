/** Compare complete full results plus standard JSON encoding, without networking. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let go = process.env.GO_BINARY ?? 'go', bun = process.env.BUN_BINARY ?? 'bun', quick = false, preflightOnly = false, withConfirmedGc = false;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--go' && args[index + 1]) go = args[++index];
  else if (args[index] === '--bun' && args[index + 1]) bun = args[++index];
  else if (args[index] === '--quick') quick = true;
  else if (args[index] === '--preflight-only') preflightOnly = true;
  else if (args[index] === '--with-confirmed-gc') withConfirmedGc = true;
  else throw new Error(`Unknown argument ${args[index]}`);
}
const started = Date.now(), deadline = started + 300000;
const mode = preflightOnly ? 'preflight' : quick ? 'quick' : 'final';
const directory = path.join(root, quick || preflightOnly ? '.artifacts/optimization-round2/json-calibration' : 'go/benchmarks');
mkdirSync(directory, { recursive: true });
const rawPath = path.join(directory, `json-${mode}.json`);
const preflightPath = path.join(directory, `json-preflight-${mode}.json.gz`);
const binary = path.join(root, '.artifacts', `dicecore-json${process.platform === 'win32' ? '.exe' : ''}`);
const runtimes = ['node', 'bun', 'go-pool', 'go-shared'];
const workloads = [['d20', '1d20+5'], ['100d6', '100d6'], ['pool', '20d6!2ro=1kh10']].map(([id, input]) => ({ id, input, mode: 'full', label: `${input} · full` }));
const config = { workers: [1, 6], seedPrefix: 'dicecore-backend/v3.7.1/', algorithm: 'mt19937', freezeResults: 'never', cache: 'warm', wallBudgetMs: 300000,
  operations: {
    'build-and-encode': { requests: quick ? 512 : 10000, samples: quick ? 3 : 5, warmup: quick ? 16 : 5000 },
    'encoding-only': { requests: 512, samples: 3, warmup: quick ? 16 : 256, wallBudgetMs: 20000 },
  } };
const raw = { schemaVersion: 1, status: 'running', mode, startedAt: new Date(started).toISOString(), invocation: { executable: process.execPath, args: ['scripts/compare-json-runtimes.mjs', ...args] }, configuration: config, runtimes, workloads, runs: [] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const persist = () => writeFileSync(rawPath, JSON.stringify(raw, null, 2) + '\n');
persist();
function command(executable, argv, options = {}, localDeadline = deadline) {
  const remaining = Math.min(deadline, localDeadline) - Date.now();
  if (remaining <= 0) throw Object.assign(new Error('JSON benchmark exceeded its wall-clock budget'), { code: 'BENCHMARK_BUDGET' });
  const result = spawnSync(executable, argv, { cwd: root, encoding: 'utf8', timeout: remaining, maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...options });
  if (result.error || result.status !== 0) throw Object.assign(new Error(`${executable} ${argv.join(' ')} failed: ${result.error?.message ?? [result.stderr, result.stdout].filter(Boolean).join('\n')}`), { code: result.error?.code });
  return result.stdout.trim();
}
function snapshot() {
  const files = [];
  const collect = (directory, include) => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(file, include);
      else if (include(file)) files.push(file);
    }
  };
  collect('src', file => file.endsWith('.ts') && !file.endsWith('.test.ts'));
  collect('dist', file => file.endsWith('.js'));
  for (const file of readdirSync(path.join(root, 'go'))) if (file.endsWith('.go') && !file.endsWith('_test.go')) files.push(path.join('go', file));
  files.push('go/json_benchmark_test.go', 'go/backend_benchmark_test.go', 'go/backend_rss_windows_test.go', 'go/backend_rss_linux_test.go', 'go/backend_rss_other_test.go', 'scripts/benchmark-json-reference.mjs', 'scripts/compare-json-runtimes.mjs', 'package.json', 'package-lock.json', 'go/go.mod', 'rollup.config.mjs', 'tsconfig.json', 'tsconfig.build.json');
  const manifest = files.sort().map(file => ({ path: file.replaceAll('\\', '/'), sha256: hash(readFileSync(path.join(root, file))) }));
  return { sha256: hash(JSON.stringify(manifest)), files: manifest };
}
function worker(runtime, workers, phase, operation, localDeadline = deadline, gc = null, memoryLimit = null) {
  const operationConfig = config.operations[operation];
  const request = { ...operationConfig, workers, phase, operation, seedPrefix: config.seedPrefix, workloads, engineMode: runtime === 'go-shared' ? 'shared' : 'pool',
    validationIndices: [0, 1, 2, 3, 4, 5, 127, 255, 511, 1023, 4095, operationConfig.requests - 1].filter((value, index, array) => value < operationConfig.requests && array.indexOf(value) === index) };
  const before = Date.now();
  const output = runtime.startsWith('go-')
    ? command(binary, ['-test.run=^TestJSONBenchmarkWorker$'], { cwd: path.join(root, 'go'), env: { ...process.env, DICECORE_JSON_WORKER: '1', ...(gc === null ? {} : { GOGC: String(gc) }), ...(memoryLimit === null ? {} : { GOMEMLIMIT: memoryLimit }) }, input: JSON.stringify(request) }, localDeadline)
    : command(runtime === 'bun' ? bun : process.execPath, [path.join(root, 'scripts/benchmark-json-reference.mjs')], { input: JSON.stringify(request) }, localDeadline);
  const line = output.split(/\r?\n/).find(line => line.startsWith('DICECORE_JSON '));
  if (!line) throw new Error(`Missing worker output: ${output.slice(0, 500)}`);
  return { runtime, workers, operation, gc, memoryLimit, wallMilliseconds: Date.now() - before, output: JSON.parse(line.slice('DICECORE_JSON '.length)) };
}
function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b), at = (sorted.length - 1) * q, lower = Math.floor(at);
  return sorted[lower] + (sorted[Math.ceil(at)] - sorted[lower]) * (at - lower);
}
function summarize(measurements, memory, operation) {
  const times = measurements.map(value => value.durationNs), median = quantile(times, 0.5);
  const rss = memory.afterBatches.filter(value => value.available).map(value => value.rssBytes / 2 ** 20);
  return { medianBatchMs: median / 1e6, q1BatchMs: quantile(times, 0.25) / 1e6, q3BatchMs: quantile(times, 0.75) / 1e6, opsPerSecond: config.operations[operation].requests * 1e9 / median, samples: times,
    encodedLengthPerResult: measurements[0].digest.encodedLength / measurements[0].digest.count, medianSnapshotRssMiB: rss.length ? quantile(rss, 0.5) : null, maximumSnapshotRssMiB: rss.length ? Math.max(...rss) : null };
}
function report(data) {
  const nf = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
  const table = operation => {
    const rows = data.summary.filter(row => row.operation === operation);
    if (!rows.length) return `Diagnóstico não concluído (${data.operationStatus?.[operation]?.status ?? 'indisponível'}); ver o motivo e os lotes preservados nos dados brutos.\n`;
    return '| Carga | Workers | Node | Bun | Go pool | Go compartilhada |\n|---|---:|---:|---:|---:|---:|\n' + rows.map(row => `| ${row.label} | ${row.workers} | ${runtimes.map(runtime => { const s = row[runtime]; return `${nf(s.opsPerSecond)} / ${nf(s.medianBatchMs)} [${nf(s.q1BatchMs)}–${nf(s.q3BatchMs)}]`; }).join(' | ')} |`).join('\n') + '\n';
  };
  const lengths = data.summary.filter(row => row.operation === 'build-and-encode' && row.workers === 6).map(row => `| ${row.label} | ${runtimes.map(runtime => nf(row[runtime].encodedLengthPerResult)).join(' | ')} |`).join('\n');
  const gcTable = data.gcSummary ? `## Go com GC confirmado no experimento da API\n\nSérie adicional: Go pool, seis workers, GOGC=${data.confirmedGc.gc}, GOMEMLIMIT=${data.confirmedGc.memoryLimit ?? 'não definido'}, mesmas cargas e binário JSON. Essa configuração foi selecionada e confirmada no experimento da API sem JSON; aqui ela é apenas reaplicada, sem nova seleção. Os resultados padrão acima permanecem completos. O RSS observado com JSON pode diferir daquele experimento. Para reproduzir essa série, acrescente --with-confirmed-gc ao comando JSON após executar a seleção e confirmação do GC.\n\n| Carga | Go padrão ops/s | Go GOGC=${data.confirmedGc.gc} ops/s | Configurado/padrão | RSS configurado: mediana / maior snapshot MiB |\n|---|---:|---:|---:|---:|\n${data.gcSummary.map(row => {
    const standard = data.summary.find(item => item.id === row.id && item.workers === 6 && item.operation === 'build-and-encode')['go-pool'];
    return `| ${row.label} | ${nf(standard.opsPerSecond)} | ${nf(row.stats.opsPerSecond)} | ${nf(row.stats.opsPerSecond / standard.opsPerSecond)}× | ${nf(row.stats.medianSnapshotRssMiB)} / ${nf(row.stats.maximumSnapshotRssMiB)} |`;
  }).join('\n')}\n\n` : '';
  return `# Construção do resultado completo e serialização JSON\n\nEste experimento mede a chamada full seguida por JSON.stringify (Node/Bun) ou encoding/json.Marshal (Go), usando a mesma biblioteca e os mesmos valores. Não há HTTP, sockets, envio do payload ou codificação adicional de strings JavaScript para buffers UTF-8. O resultado full e seu JSON são construídos em cada chamada do alvo principal. [Chamadas sem JSON](BACKEND_BENCHMARK.md) e [baseline anterior](benchmarks/round2-baseline/README.md) continuam separados.\n\n` +
    `## Método e ambiente\n\n${data.environment.cpuModel.trim()} · ${data.environment.osVersion} · ${data.environment.logicalCPUs} CPUs lógicas. Node ${data.environment.node}, Bun ${data.environment.bun}, ${data.environment.go}. Commit-base \`${data.git.commit}\`, árvore com ${data.git.statusLines.length} entradas modificadas. Manifesto estável \`${data.source.sha256}\`.\n\n` +
    `As três expressões usam MT19937, limites padrão, full, cache aquecido, freezeResults='never' e seeds únicas \`${config.seedPrefix}\` + índice. Workers de aplicação: 1 e 6; GOMAXPROCS permanece no padrão/configuração do processo e está registrado por execução. Node/Bun têm uma engine por isolate; Go pool usa uma por goroutine e Go compartilhada usa uma engine para todas. Os processos são sequenciais; a ordem dos runtimes gira entre configurações. Workers, engines e options persistem nos lotes.\n\n` +
    `Cada carga principal aquece ${config.operations['build-and-encode'].warmup} chamadas por worker e mede ${config.operations['build-and-encode'].samples} lotes de ${config.operations['build-and-encode'].requests} chamadas. Build, imports, startup, options e aquecimento ficam fora do cronômetro. O tempo real do lote inclui despacho e conclusão de todos os workers, construção dos resultados e JSON; só contadores agregados retornam ao coordenador. Os contadores usam len(bytes) em Go e string.length em JavaScript; o corpus usa somente texto ASCII, confirmado no preflight, portanto representam o comprimento UTF-8 dessas saídas. Não há normalização ou reordenação das chaves no caminho cronometrado.\n\n` +
    `O preflight decodifica cada JSON e exige igualdade integral dos valores e números, sem tolerância numérica. Diferenças textuais de ordem de chaves, escapes e representação numérica não são tratadas como divergência semântica; os comprimentos individuais ficam preservados no preflight. Cada lote confirma quantidade de chamadas, soma dos totais, soma ponderada pelo índice e chamadas aleatórias; o comprimento codificado é validado entre lotes do mesmo runtime, sem forçar igualdade entre serializadores.\n\n` +
    `## API completa: construir + codificar\n\nCada célula: **operações/s / mediana do lote em ms [Q1–Q3]**. Os quartis são entre lotes, não percentis de latência de requisições individuais.\n\n${table('build-and-encode')}\n` +
    gcTable + `## Tamanho médio do JSON por resultado\n\nComprimento emitido no corpus ASCII, com seis workers; diferença de tamanho não implica diferença dos valores JSON.\n\n| Carga | Node | Bun | Go pool | Go compartilhada |\n|---|---:|---:|---:|---:|\n${lengths}\n\n` +
    `## Codificação isolada, resultados pré-construídos\n\nDiagnóstico auxiliar: ${config.operations['encoding-only'].requests} resultados distintos pré-construídos por carga, ${config.operations['encoding-only'].samples} lotes, warmup ${config.operations['encoding-only'].warmup} por worker. Construir os resultados fica fora do timer apenas nesta seção. Este ensaio tem teto próprio de 20 segundos e não representa o desempenho da API inteira.\n\n${table('encoding-only')}\n` +
    `## Reprodução e limites\n\n\`\`\`powershell\nnode scripts/compare-json-runtimes.mjs --go '${go.replaceAll("'", "''")}' --bun '${bun.replaceAll("'", "''")}'\n\`\`\`\n\nRequer dependências npm instaladas, Node, Bun e Go. --quick usa lotes pequenos; --preflight-only valida apenas saídas. Os modos de desenvolvimento gravam em .artifacts/optimization-round2/json-calibration. Teto total de cinco minutos.\n\nRSS bruto é registrado fora do cronômetro, com workers, último resultado e último JSON vivos. Inclui runtime e harness; o processo percorre cargas sucessivas, podendo reter memória das anteriores. Não é pico de memória, nem custo isolado de uma expressão. Frequência da CPU, JIT, GC e escalonamento afetam estes resultados locais; não há inferência de capacidade de um servidor HTTP.\n\n[Dados e manifesto](benchmarks/json-final.json) · [Preflight integral gzip](benchmarks/json-preflight-final.json.gz) · [Orquestrador](../scripts/compare-json-runtimes.mjs).\n`;
}
try {
  raw.environment = { cpuModel: os.cpus()[0].model, logicalCPUs: os.cpus().length, osVersion: os.version(), osRelease: os.release(), arch: process.arch, node: process.version, bun: command(bun, ['--version']), go: command(go, ['version']), runtimeEnvironment: Object.fromEntries(['NODE_OPTIONS', 'GOMAXPROCS', 'GOGC', 'GOMEMLIMIT'].map(key => [key, process.env[key] ?? null])) };
  raw.git = { commit: command('git', ['rev-parse', 'HEAD']), statusLines: command('git', ['status', '--porcelain=v1']).split(/\r?\n/).filter(Boolean) };
  raw.commands = [{ executable: process.execPath, args: ['node_modules/rollup/dist/bin/rollup', '--config=./rollup.config.mjs'] }, { executable: go, args: ['test', '-c', '-o', binary], cwd: 'go' }];
  persist();
  command(process.execPath, raw.commands[0].args);
  command(go, raw.commands[1].args, { cwd: path.join(root, 'go') });
  raw.source = snapshot(); raw.goWorkerBinary = { sha256: hash(readFileSync(binary)) };
  let confirmedGc = null, confirmedMemoryLimit = null;
  const gcFiles = ['go/benchmarks/gc-round2-memory-cap.json', 'go/benchmarks/gc-round2-tuning.json'];
  for (const relativeGcFile of withConfirmedGc ? gcFiles : []) {
    const gcFile = path.join(root, relativeGcFile);
    if (!existsSync(gcFile)) continue;
    const gcData = JSON.parse(readFileSync(gcFile, 'utf8'));
    if (gcData.status === 'complete' && gcData.confirmedGc) {
      assert.equal(process.env.GOMEMLIMIT ?? null, gcData.environment.inheritedGOMEMLIMIT, 'Reuse the GC experiment memory-cap setting');
      assert.equal(process.env.GOMAXPROCS ?? null, gcData.environment.inheritedGOMAXPROCS, 'Reuse the GC experiment GOMAXPROCS setting');
      for (const source of gcData.source.files.filter(source => source.path.startsWith('go/') && source.path.endsWith('.go') && !source.path.endsWith('_test.go'))) assert.equal(hash(readFileSync(path.join(root, source.path))), source.sha256, `GC selection used different Go source: ${source.path}`);
      const confirmation = gcData.runs.find(run => run.stage === 'confirmation' && run.gc === gcData.confirmedGc);
      assert.ok(Object.values(confirmation.summary).every(row => row.maximumRssMiB !== null && row.maximumRssMiB <= 128), 'GC selection must satisfy its API RSS ceiling');
      confirmedGc = gcData.confirmedGc;
      confirmedMemoryLimit = gcData.confirmedMemoryLimit ?? null;
      raw.confirmedGc = { gc: confirmedGc, memoryLimit: confirmedMemoryLimit, selectionFile: relativeGcFile, selectionSha256: hash(readFileSync(gcFile)), workers: 6, engineMode: 'pool', operation: 'build-and-encode', env: { GOGC: String(confirmedGc), GOMAXPROCS: process.env.GOMAXPROCS ?? null, GOMEMLIMIT: confirmedMemoryLimit ?? process.env.GOMEMLIMIT ?? null } };
      break;
    }
  }
  const preflight = { runs: [] }; let expected;
  const preflightConfigs = config.workers.flatMap(workers => runtimes.map(runtime => [runtime, workers, null]));
  if (confirmedGc !== null) preflightConfigs.push(['go-pool-gc', 6, confirmedGc, confirmedMemoryLimit]);
  for (const [runtime, workers, gc, memoryLimit] of preflightConfigs) {
    const run = worker(runtime, workers, 'preflight', 'build-and-encode', deadline, gc, memoryLimit ?? null);
    preflight.runs.push(run);
    writeFileSync(preflightPath, gzipSync(Buffer.from(JSON.stringify(preflight, null, 2) + '\n'), { level: 1 }));
    const values = Object.fromEntries(Object.entries(run.output.cases).map(([id, cases]) => [id, cases.map(value => {
      assert.ok([...value.json].every(char => char.charCodeAt(0) <= 127), 'Timed length accounting requires this ASCII corpus');
      assert.equal(Buffer.byteLength(value.json), value.encodedLength);
      return { index: value.index, value: JSON.parse(value.json) };
    })]));
    if (!expected) expected = values;
    else assert.deepStrictEqual(values, expected, `Full JSON values ${runtime}/${workers}`);
  }
  const preflightBytes = Buffer.from(JSON.stringify(preflight, null, 2) + '\n');
  const archive = gzipSync(preflightBytes, { level: 9 });
  assert.deepEqual(gunzipSync(archive), preflightBytes);
  writeFileSync(preflightPath, archive);
  raw.preflight = { passed: true, file: path.relative(root, preflightPath).replaceAll('\\', '/'), configurations: preflight.runs.length, uniqueOutputs: Object.values(expected).reduce((sum, values) => sum + values.length, 0), uncompressedSha256: hash(preflightBytes), compressedSha256: hash(archive), uncompressedBytes: preflightBytes.length, compressedBytes: archive.length };
  persist();
  if (!preflightOnly) {
    for (const operation of Object.keys(config.operations)) {
      const operationStarted = Date.now();
      const operationDeadline = operation === 'encoding-only' ? Math.min(deadline, operationStarted + config.operations[operation].wallBudgetMs) : deadline;
      const expectedDigests = {}, expectedLengths = {};
      try {
        for (let index = 0; index < config.workers.length; index++) {
          const workers = config.workers[index], order = [...runtimes.slice(index), ...runtimes.slice(0, index)];
          for (const runtime of order) {
            console.log(`JSON ${operation}: ${runtime}, ${workers} workers`);
            const run = worker(runtime, workers, 'measure', operation, operationDeadline);
            raw.runs.push(run); persist();
            for (const [id, measurements] of Object.entries(run.output.cases)) {
              assert.equal(measurements.length, config.operations[operation].samples);
              for (const measured of measurements) {
                assert.equal(measured.digest.count, config.operations[operation].requests);
                assert.ok(measured.durationNs > 0 && measured.digest.encodedLength > 0);
                const { encodedLength, ...digest } = measured.digest;
                if (!expectedDigests[id]) expectedDigests[id] = digest;
                else assert.deepStrictEqual(digest, expectedDigests[id], `Delivery ${operation}/${id}/${runtime}/${workers}`);
                const key = `${runtime}/${id}`;
                if (expectedLengths[key] === undefined) expectedLengths[key] = encodedLength;
                else assert.equal(encodedLength, expectedLengths[key], `Encoded length stability ${key}`);
              }
            }
          }
        }
        if (operation === 'build-and-encode' && confirmedGc !== null) {
          console.log(`JSON build-and-encode: Go pool GOGC=${confirmedGc}, GOMEMLIMIT=${confirmedMemoryLimit ?? 'unset'}, 6 workers`);
          const run = worker('go-pool-gc', 6, 'measure', operation, operationDeadline, confirmedGc, confirmedMemoryLimit);
          raw.runs.push(run); persist();
          const standard = raw.runs.find(item => item.runtime === 'go-pool' && item.workers === 6 && item.operation === operation);
          for (const [id, measurements] of Object.entries(run.output.cases)) {
            assert.equal(measurements.length, config.operations[operation].samples);
            for (const measured of measurements) {
              assert.ok(measured.durationNs > 0);
              assert.deepStrictEqual(measured.digest, standard.output.cases[id][0].digest, `GC result delivery ${id}`);
            }
          }
          raw.gcSummary = workloads.map(workload => ({ id: workload.id, label: workload.label, gc: confirmedGc, workers: 6, stats: summarize(run.output.cases[workload.id], run.output.memory[workload.id], operation) }));
        }
        (raw.operationStatus ??= {})[operation] = { status: 'complete', wallMilliseconds: Date.now() - operationStarted };
      } catch (error) {
        const insufficientResolution = error.message.includes('non-positive measured duration:');
        if (operation !== 'encoding-only' || (!insufficientResolution && !['ETIMEDOUT', 'BENCHMARK_BUDGET'].includes(error.code))) throw error;
        (raw.operationStatus ??= {})[operation] = { status: insufficientResolution ? 'clock-resolution-insufficient' : 'budget-exceeded', wallMilliseconds: Date.now() - operationStarted, error: error.message };
      }
    }
    raw.summary = Object.keys(config.operations).filter(operation => raw.operationStatus[operation].status === 'complete').flatMap(operation => workloads.flatMap(workload => config.workers.map(workers => ({ id: workload.id, label: workload.label, workers, operation, ...Object.fromEntries(runtimes.map(runtime => {
      const run = raw.runs.find(run => run.runtime === runtime && run.workers === workers && run.operation === operation);
      return [runtime, summarize(run.output.cases[workload.id], run.output.memory[workload.id], operation)];
    })) }))));
  }
  assert.equal(snapshot().sha256, raw.source.sha256, 'Source changed while benchmarking');
  raw.status = 'complete'; raw.finishedAt = new Date().toISOString(); raw.wallMilliseconds = Date.now() - started; persist();
  if (!quick && !preflightOnly) writeFileSync(path.join(root, 'go/JSON_BENCHMARK.md'), report(raw));
  console.log(`Saved ${path.relative(root, rawPath)} in ${Math.round(raw.wallMilliseconds / 1000)} seconds.`);
} catch (error) {
  raw.status = 'failed'; raw.error = { message: error.message, stack: error.stack }; raw.finishedAt = new Date().toISOString(); raw.wallMilliseconds = Date.now() - started; persist(); console.error(error.stack); process.exitCode = 1;
}
