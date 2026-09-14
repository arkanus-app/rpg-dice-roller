/** Verify saved round-five evidence without running Go, benchmarks or renderers.
 * Run after measurements, final coverage and chart rendering have completed:
 *   node scripts/verify-go-round5.mjs
 * Missing optional executables are reported; missing or changed evidence fails.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = 'go/benchmarks/optimization-round5';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(),
  invocation: { executable: process.execPath, args: ['scripts/verify-go-round5.mjs', ...process.argv.slice(2)] },
  checks: [], inputs: [], binaries: [], warnings: [],
  limitations: [
    'This verifies saved evidence and current or explicitly archived sources; it does not rerun tests, benchmarks, Go builds or plots.',
    'A source manifest and executable hash do not independently prove how the executable was built.',
    'Historical v1/v2 source substitutions are explicit. Optional local executables may be absent in another checkout.',
    'Chart hashes and displayed values are checked; visual layout review remains separate.',
  ],
};
const inputPaths = new Set();
function localPath(recorded) {
  assert.equal(typeof recorded, 'string', 'Missing recorded path');
  const normalized = recorded.replaceAll('\\', '/');
  const marker = '/rpg-dice-roller/';
  const offset = normalized.toLowerCase().lastIndexOf(marker);
  const relative = offset >= 0 ? normalized.slice(offset + marker.length) : normalized;
  assert.ok(!path.win32.isAbsolute(relative) && !path.posix.isAbsolute(relative), `Path outside this checkout: ${recorded}`);
  const absolute = path.resolve(root, relative);
  assert.ok(!path.relative(root, absolute).startsWith('..'), `Path escapes this checkout: ${recorded}`);
  return absolute;
}
function read(file) {
  const absolute = localPath(file), bytes = readFileSync(absolute);
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  if (!inputPaths.has(relative)) {
    inputPaths.add(relative);
    report.inputs.push({ path: relative, sha256: hash(bytes), bytes: bytes.length });
  }
  return bytes;
}
const readJSON = file => JSON.parse(read(file).toString('utf8').replace(/^\uFEFF/, ''));
function checked(name, action) {
  try { report.checks.push({ name, status: 'passed', ...action() }); }
  catch (error) { report.checks.push({ name, status: 'failed', error: error.message }); }
}
function recordHash(record) {
  const bytes = read(record.path ?? record.file);
  assert.equal(hash(bytes), record.sha256, `Changed artifact: ${record.path ?? record.file}`);
  if (record.bytes !== undefined) assert.equal(bytes.length, record.bytes);
  return bytes;
}
function verifyBinary(record, label) {
  const file = record.file ?? record.path;
  assert.match(record.sha256, /^[a-f0-9]{64}$/, `Invalid executable hash: ${label}`);
  if (!existsSync(localPath(file))) {
    report.binaries.push({ label, file, sha256: record.sha256, status: 'unavailable' });
    report.warnings.push(`Optional local executable is unavailable: ${label} (${file})`);
    return;
  }
  recordHash(record);
  report.binaries.push({ label, file, sha256: record.sha256, status: 'verified' });
}
function verifySource(source, substitutions = {}) {
  assert.equal(hash(JSON.stringify(source.files)), source.sha256, 'Source manifest aggregate hash');
  const names = source.files.map(entry => entry.path);
  assert.deepEqual(names, [...new Set(names)].sort(), 'Source manifest paths must be unique and sorted');
  for (const entry of source.files) {
    const file = substitutions[entry.path] ?? entry.path;
    assert.equal(hash(read(file)), entry.sha256, `Source differs: ${entry.path} (read ${file})`);
  }
  for (const original of Object.keys(substitutions)) assert.ok(names.includes(original), `Unused historical substitution: ${original}`);
  const currentGo = readdirSync(path.join(root, 'go')).filter(name => name.endsWith('.go')).map(name => `go/${name}`).sort();
  assert.deepEqual(names.filter(name => /^go\/[^/]+\.go$/.test(name)).sort(), currentGo, 'Go source inventory differs');
  return { sha256: source.sha256, files: names.length, substitutions };
}
function positive(value, label) {
  assert.ok(Number.isFinite(value) && value > 0, `Expected positive finite ${label}: ${value}`);
  return value;
}
function near(actual, expected, label) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-12,
    `${label}: ${actual} != ${expected}`);
}
function quantile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * fraction, lower = Math.floor(position);
  assert.ok(sorted.length);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}
const workloads = ['d20', '100d6', 'pool'], modes = ['summary', 'details', 'full'];
const microCases = workloads.flatMap(workload => modes.map(mode => `${workload}/${mode}`)).sort();
const microData = new Map(), runtimeData = new Map();
function parseMicroChunk(chunk) {
  const environment = Object.fromEntries([...chunk.matchAll(/^(goos|goarch|pkg|cpu):\s*(.*)$/gm)].map(match => [match[1], match[2]]));
  assert.deepEqual(Object.keys(environment).sort(), ['cpu', 'goarch', 'goos', 'pkg']);
  assert.match(chunk, /\nPASS\n$/);
  assert.doesNotMatch(chunk, /^FAIL/m);
  const cases = {};
  for (const match of chunk.matchAll(/^BenchmarkRollJSON\/([^\s]+?)(?:-\d+)?\s+(\d+)\s+([\d.eE+-]+) ns\/op\s+([\d.eE+-]+) B\/op\s+([\d.eE+-]+) allocs\/op\s*$/gm)) {
    const [, name, iterations, ns, bytes, allocs] = match;
    assert.ok(!cases[name], `Duplicate benchmark: ${name}`);
    positive(Number(iterations), 'iteration count');
    cases[name] = { nsPerOp: positive(Number(ns), 'ns/op'), bytesPerOp: Number(bytes), allocsPerOp: Number(allocs) };
    assert.ok(Number.isFinite(Number(bytes)) && Number(bytes) >= 0 && Number.isFinite(Number(allocs)) && Number(allocs) >= 0);
  }
  assert.deepEqual(Object.keys(cases).sort(), microCases);
  return { environment, cases };
}
function verifyMicro(label, substitutions) {
  const data = readJSON(`${directory}/${label}.json`);
  assert.equal(data.status, 'complete'); assert.equal(data.label, label); assert.equal(data.rounds, 10);
  assert.equal(data.runs.length, 20); assert.equal(data.budgetMs, 120000); assert.ok(data.wallMs <= data.budgetMs);
  assert.deepEqual(data.env, { GOMAXPROCS: '1', GOGC: '100', GOMEMLIMIT: 'off' });
  assert.equal(data.methodology.operation, 'encoding-only'); assert.equal(data.methodology.ownedBytes, true);
  const encoders = label === 'v1-encoder' ? data.variants : data.encoders;
  assert.deepEqual(encoders, { before: label.includes('capacity') ? 'direct' : 'std', after: 'direct' });
  const source = verifySource(data.source, substitutions);
  const binaries = data.binaries ?? { both: data.binary };
  for (const [variant, binary] of Object.entries(binaries)) verifyBinary(binary, `${label}/${variant}`);
  if (label === 'final-encoder') {
    assert.equal(data.mode, 'std-direct-confirmation');
    assert.equal(binaries.before.sha256, binaries.after.sha256);
    assert.equal(data.variants.before, data.variants.after);
  }
  const samples = { before: {}, after: {} }; let expectedEnvironment;
  for (let round = 0; round < 10; round++) {
    const order = round % 2 ? ['after', 'before'] : ['before', 'after'];
    assert.deepEqual(data.order[round], order);
    assert.deepEqual(data.runs.slice(round * 2, round * 2 + 2).map(run => [run.round, run.variant]), order.map(variant => [round, variant]));
  }
  for (const variant of ['before', 'after']) {
    const text = recordHash(data.outputs[variant]).toString('utf8');
    assert.ok(text.startsWith('goos:'));
    const chunks = text.split(/(?=^goos:)/m).filter(Boolean), runs = data.runs.filter(run => run.variant === variant);
    assert.equal(chunks.length, 10); assert.equal(runs.length, 10);
    chunks.forEach((chunk, index) => {
      const run = runs[index];
      assert.equal(run.exitCode, 0); assert.equal(run.error, null); assert.equal(run.encoder, encoders[variant]);
      assert.equal(hash(chunk), run.stdoutSha256, `Per-process stdout hash: ${label}/${variant}/${index}`);
      assert.deepEqual(run.cases, microCases);
      assert.deepEqual(run.args, ['-test.run=^$', '-test.bench=^BenchmarkRollJSON$', '-test.benchtime=100ms', '-test.count=1', '-test.benchmem']);
      const parsed = parseMicroChunk(chunk);
      if (expectedEnvironment === undefined) expectedEnvironment = parsed.environment;
      else assert.deepEqual(parsed.environment, expectedEnvironment);
      for (const [name, values] of Object.entries(parsed.cases)) (samples[variant][name] ??= []).push(values);
    });
  }
  microData.set(label, { data, samples });
  return { processes: 20, cases: 9, samplesPerCasePerVariant: 10, source, disposition: label === 'v2-capacity' ? 'rejected experiment, evidence retained' : 'measured experiment' };
}

const configurations = ['node', 'bun', 'go-std-default', 'go-direct-default', 'go-std-tuned', 'go-direct-tuned'];
function verifyRuntime(name, holdout) {
  const data = readJSON(`${directory}/${name}.json`), config = data.configuration;
  assert.equal(data.status, 'complete'); assert.equal(data.mode, holdout ? 'holdout' : 'main'); assert.equal(data.schemaVersion, 1);
  const expected = { workers: 6, gomaxprocs: 12, requests: holdout ? 512 : 5000, samplesPerProcess: 3, rounds: 2,
    warmupPerWorker: holdout ? 64 : 1000, operation: 'build-and-encode', engineMode: 'pool', algorithm: 'mt19937', freezeResults: 'never', cache: 'warm' };
  for (const [key, value] of Object.entries(expected)) assert.equal(config[key], value, `Configuration: ${key}`);
  assert.deepEqual(config.orders, [configurations, [...configurations].reverse()]);
  assert.equal(data.runs.length, 12); assert.ok(data.wallMilliseconds <= 300000);
  assert.deepEqual(data.configurations.map(entry => entry.id), configurations);
  const goExecutables = new Set();
  for (const current of data.configurations) {
    if (current.id.startsWith('go-')) {
      assert.equal(current.runtime, 'go');
      assert.equal(current.encoder, current.id.includes('direct') ? 'direct' : 'std');
      assert.equal(current.gc, current.id.endsWith('tuned') ? 500 : 100);
      assert.equal(current.memoryLimit, current.id.endsWith('tuned') ? '96MiB' : null);
      goExecutables.add(current.executable);
    } else assert.equal(current.runtime, current.id);
  }
  assert.equal(goExecutables.size, 1, 'Measured Go series must share one executable');
  const source = verifySource(data.source);
  assert.equal(data.baseline.reference, 'cecb59b'); assert.ok(data.baseline.commit.startsWith('cecb59b'));
  for (const worker of data.baseline.workers) {
    const text = read(worker.path).toString('utf8').replaceAll('\r\n', '\n').trim();
    assert.equal(hash(text), worker.normalizedSha256, `Original worker changed: ${worker.path}`);
  }
  for (const [variant, binary] of Object.entries(data.binaries)) verifyBinary(binary, `${name}/${variant}`);
  const cases = data.workloads.map(entry => entry.id);
  const expectedWorkloads = holdout ? [
    ['1000d6', '1000d6'], ['reroll-selection', '100d6ro=1kh60'], ['multi-group', '2#{4d6,3d8+2}kh1'],
    ['unicode-comment', '20d6!2ro=1kh10 # ação 🎲'], ['fudge', '100dF.2'], ['fractional-bounds', '50d6min2.125max4.875kh25'],
  ] : [['d20', '1d20+5'], ['100d6', '100d6'], ['pool', '20d6!2ro=1kh10']];
  assert.deepEqual(data.workloads.map(({ id, input }) => [id, input]), expectedWorkloads);
  for (const workload of data.workloads) assert.equal(workload.mode, 'full');
  const pre = data.preflight, compressed = read(pre.file), uncompressed = gunzipSync(compressed);
  assert.equal(pre.passed, true); assert.equal(pre.goStdlibByteEquality, true);
  assert.equal(hash(compressed), pre.compressedSha256); assert.equal(hash(uncompressed), pre.uncompressedSha256);
  assert.equal(compressed.length, pre.compressedBytes); assert.equal(uncompressed.length, pre.uncompressedBytes);
  const preflight = JSON.parse(uncompressed.toString('utf8'));
  assert.deepEqual(preflight.validationIndices, config.validationIndices);
  assert.equal(preflight.runs.length, 7); assert.equal(pre.totalConfigurations, 7);
  assert.equal(pre.uniqueOutputs, cases.length * config.validationIndices.length);
  assert.deepEqual(preflight.runs.map(run => run.configuration), ['go-baseline-preflight', ...configurations]);
  let expectedValues, expectedGoBytes, asciiCorpus = true;
  function verifyRun(run, phase) {
    assert.equal(run.phase, phase); assert.equal(run.request.phase, phase);
    const current = data.configurations.find(current => current.id === run.configuration);
    if (run.originalWorker) {
      assert.equal(phase, 'preflight'); assert.equal(run.configuration, 'go-baseline-preflight'); assert.equal(run.runtime, 'go');
    } else { assert.ok(current); assert.equal(run.runtime, current.runtime); }
    assert.deepEqual(run.request.workloads, data.workloads);
    for (const [key, value] of Object.entries({ workers: config.workers, requests: config.requests, samples: config.samplesPerProcess,
      warmup: config.warmupPerWorker, operation: config.operation, engineMode: config.engineMode, seedPrefix: config.seedPrefix })) assert.equal(run.request[key], value);
    assert.deepEqual(run.request.validationIndices, config.validationIndices);
    assert.deepEqual(Object.keys(run.output.cases).sort(), [...cases].sort());
    if (run.runtime === 'go') {
      assert.equal(run.output.gomaxprocs, 12); assert.ok(data.environment.go.includes(run.output.runtime));
      const tuned = run.configuration.endsWith('tuned'), direct = run.configuration.includes('direct');
      assert.equal(run.environment.GOMAXPROCS, '12'); assert.equal(run.environment.GOGC, tuned ? '500' : '100');
      assert.equal(run.environment.GOMEMLIMIT, tuned ? '96MiB' : null);
      if (!run.originalWorker) {
        assert.equal(run.encoder, direct ? 'direct' : 'std'); assert.equal(run.output.encoder, run.encoder);
        assert.equal(run.request.encoder, run.encoder); assert.equal(run.output.preflightStdlibByteEquality, phase === 'preflight');
      }
    } else assert.equal(run.output.runtime, run.runtime === 'node' ? data.environment.node : `Bun ${data.environment.bun}`);
  }
  for (const run of preflight.runs) {
    verifyRun(run, 'preflight');
    const values = {}, encoded = {};
    for (const id of cases) {
      assert.deepEqual(run.output.cases[id].map(value => value.index), config.validationIndices);
      values[id] = run.output.cases[id].map(value => {
        assert.equal(run.runtime === 'go' ? Buffer.byteLength(value.json) : value.json.length, value.encodedLength);
        if (run.runtime === 'go' && !run.originalWorker) assert.equal(value.stdlibEqual, true);
        asciiCorpus &&= [...value.json].every(character => character.charCodeAt(0) <= 127);
        return { index: value.index, value: JSON.parse(value.json) };
      });
      encoded[id] = run.output.cases[id].map(value => ({ index: value.index, json: value.json }));
    }
    if (expectedValues === undefined) expectedValues = values; else assert.deepEqual(values, expectedValues, 'Complete preflight JSON values');
    if (run.runtime === 'go') {
      if (expectedGoBytes === undefined) expectedGoBytes = encoded; else assert.deepEqual(encoded, expectedGoBytes, 'Complete Go preflight bytes');
    }
  }
  assert.equal(pre.asciiCorpus, asciiCorpus); if (!holdout) assert.equal(asciiCorpus, true);
  const expectedDigests = {}, goLengths = {}, series = {};
  data.runs.forEach((run, index) => {
    const round = Math.floor(index / 6);
    assert.equal(run.round, round + 1); assert.equal(run.configuration, config.orders[round][index % 6]);
    verifyRun(run, 'measure');
    for (const id of cases) {
      const measurements = run.output.cases[id], rss = run.output.memory[id].afterBatches;
      assert.equal(measurements.length, 3); assert.equal(rss.length, 3);
      const key = `${run.configuration}/${id}`, entry = series[key] ??= { durations: [], rss: [], lengths: [] };
      for (const measured of measurements) {
        assert.equal(measured.requests, config.requests); assert.equal(measured.workers, 6); assert.equal(measured.digest.count, config.requests);
        entry.durations.push(positive(measured.durationNs, 'batch duration'));
        near(measured.opsPerSecond, config.requests * 1e9 / measured.durationNs, 'Worker throughput');
        const { encodedLength, ...digest } = measured.digest;
        positive(encodedLength, 'encoded length'); entry.lengths.push(encodedLength / digest.count);
        assert.deepEqual(Object.keys(digest).sort(), ['count', 'randomCalls', 'total', 'weightedTotal']);
        assert.ok(Object.values(digest).every(Number.isFinite));
        if (expectedDigests[id] === undefined) expectedDigests[id] = digest; else assert.deepEqual(digest, expectedDigests[id]);
        if (run.runtime === 'go') {
          if (goLengths[id] === undefined) goLengths[id] = encodedLength; else assert.equal(encodedLength, goLengths[id]);
        }
      }
      for (const snapshot of rss) if (snapshot.available) entry.rss.push(positive(snapshot.rssBytes, 'RSS') / 2 ** 20);
    }
  });
  assert.deepEqual(data.summary.map(row => row.id), cases);
  for (const row of data.summary) for (const id of configurations) {
    assert.equal(row.input, data.workloads.find(workload => workload.id === row.id).input);
    const summary = row[id], entry = series[`${id}/${row.id}`];
    assert.equal(summary.samplesCount, 6); assert.deepEqual(summary.samples, entry.durations);
    for (const [field, fraction] of [['q1BatchMs', .25], ['medianBatchMs', .5], ['q3BatchMs', .75]]) near(summary[field], quantile(entry.durations, fraction) / 1e6, field);
    near(summary.opsPerSecond, config.requests * 1e9 / quantile(entry.durations, .5), 'Summary throughput');
    assert.ok(entry.lengths.every(value => value === entry.lengths[0]));
    assert.equal(summary.encodedLengthPerResult, entry.lengths[0]);
    assert.equal(summary.encodedLengthUnit, id.startsWith('go-') ? 'UTF-8 bytes' : 'UTF-16 code units');
    assert.deepEqual(summary.rssSamplesMiB, entry.rss);
    assert.equal(summary.medianSnapshotRssMiB, entry.rss.length ? quantile(entry.rss, .5) : null);
    assert.equal(summary.maximumSnapshotRssMiB, entry.rss.length ? Math.max(...entry.rss) : null);
  }
  runtimeData.set(name, data);
  return { source, processes: 12, workloads: cases.length, series: 6, samplesPerSeriesPerWorkload: 6, preflightOutputs: pre.uniqueOutputs, preflightConfigurations: 7 };
}

function verifyCoverage() {
  const profile = read(`${directory}/final-coverage.out`).toString('utf8').trim().split(/\r?\n/);
  assert.match(profile.shift(), /^mode: (atomic|count|set)$/);
  let statements = 0, covered = 0; const files = new Set(), blocks = new Set();
  for (const line of profile) {
    const match = /^github\.com\/arkanus-app\/rpg-dice-roller\/go\/([^:]+):(\d+)\.(\d+),(\d+)\.(\d+) (\d+) (\d+)$/.exec(line);
    assert.ok(match, `Invalid coverage block: ${line}`);
    assert.ok(!match[1].endsWith('_test.go'), 'Test source included in production coverage');
    const block = line.slice(0, line.lastIndexOf(' ')); assert.ok(!blocks.has(block), 'Duplicate coverage block'); blocks.add(block);
    files.add(match[1]); const count = Number(match[6]); statements += count; if (BigInt(match[7]) > 0n) covered += count;
    assert.ok(BigInt(match[7]) > 0n || count === 0, `Uncovered production block: ${line}`);
  }
  assert.ok(files.has('json.go'), 'New encoder missing from coverage');
  assert.equal(statements, 4802, 'Expected final production statement count'); assert.equal(covered, statements);
  return { statements, coveredStatements: covered, coveragePercent: 100, files: files.size, blocks: blocks.size };
}
function verifyCharts() {
  const manifest = readJSON(`${directory}/plot-round5-manifest.json`);
  assert.equal(manifest.schemaVersion, 1); recordHash(manifest.renderer); recordHash(manifest.helpers);
  assert.deepEqual(Object.keys(manifest.charts).sort(), ['holdoutThroughput', 'mainRSS', 'mainThroughput', 'serialization']);
  let outputs = 0;
  for (const [name, chart] of Object.entries(manifest.charts)) {
    for (const input of chart.inputs) recordHash(input);
    assert.deepEqual(chart.outputs.map(output => path.extname(output.path)).sort(), ['.png', '.svg']);
    for (const output of chart.outputs) { recordHash(output); outputs++; }
    if (name === 'serialization') {
      const samples = microData.get('final-encoder')?.samples; assert.ok(samples, 'Final microbenchmark must verify first');
      assert.equal(chart.displayedValues.length, 9);
      assert.deepEqual(chart.displayedValues.map(row => row.benchmark.replace('BenchmarkRollJSON/', '')).sort(), microCases);
      for (const row of chart.displayedValues) for (const [label, variant] of [['std', 'before'], ['direct', 'after']]) {
        const values = samples[variant][row.benchmark.replace('BenchmarkRollJSON/', '')];
        for (const field of ['nsPerOp', 'bytesPerOp', 'allocsPerOp']) near(row[label][field], quantile(values.map(value => value[field]), .5), `Chart micro ${field}`);
      }
    } else {
      const data = runtimeData.get(name === 'holdoutThroughput' ? 'json-round5-holdout' : 'json-round5');
      assert.ok(data, 'Runtime evidence must verify before charts');
      assert.equal(chart.displayedValues.length, data.workloads.length * 6);
      const seen = new Set();
      for (const point of chart.displayedValues) {
        const key = `${point.workload}/${point.configuration}`; assert.ok(!seen.has(key)); seen.add(key);
        const row = data.summary.find(row => row.id === point.workload), stats = row?.[point.configuration]; assert.ok(stats, `Unexpected chart series: ${key}`);
        if (name === 'mainRSS') {
          assert.deepEqual(point.snapshotsMiB, stats.rssSamplesMiB); assert.equal(point.medianMiB, stats.medianSnapshotRssMiB); assert.equal(point.maximumMiB, stats.maximumSnapshotRssMiB);
        } else {
          assert.equal(point.input, row.input); near(point.thousandsPerSecond, stats.opsPerSecond / 1000, 'Chart throughput');
          near(point.lower, data.configuration.requests / stats.q3BatchMs, 'Chart lower quartile'); near(point.upper, data.configuration.requests / stats.q1BatchMs, 'Chart upper quartile');
        }
      }
    }
  }
  return { charts: 4, outputs, renderer: manifest.renderer.sha256 };
}

checked('invocation', () => { assert.equal(process.argv.length, 2, 'Usage: node scripts/verify-go-round5.mjs'); read('scripts/verify-go-round5.mjs'); return {}; });
checked('v1-encoder', () => verifyMicro('v1-encoder', { 'go/json.go': `${directory}/v1-json.go.txt` }));
checked('v2-capacity (rejected)', () => verifyMicro('v2-capacity', {
  'go/json.go': `${directory}/v2-json.go.txt`, 'scripts/compare-go-round5-capacity.mjs': `${directory}/v2-capacity-script.mjs.txt`,
}));
checked('v3-capacity', () => verifyMicro('v3-capacity', {}));
checked('final-encoder', () => verifyMicro('final-encoder', {}));
checked('json-round5', () => verifyRuntime('json-round5', false));
checked('json-round5-holdout', () => verifyRuntime('json-round5-holdout', true));
checked('final production coverage', verifyCoverage);
checked('chart manifest, files and displayed values', verifyCharts);
report.status = report.checks.every(check => check.status === 'passed') ? 'complete' : 'failed';
report.finishedAt = new Date().toISOString();
report.inputs.sort((a, b) => a.path.localeCompare(b.path));
report.inputManifestSha256 = hash(JSON.stringify(report.inputs));
const output = path.join(root, directory, 'verification.json');
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
for (const check of report.checks) console.log(`${check.status === 'passed' ? 'PASS' : 'FAIL'} ${check.name}${check.error ? `: ${check.error}` : ''}`);
for (const warning of report.warnings) console.log(`NOTE ${warning}`);
console.log(`${report.status.toUpperCase()}: ${report.checks.filter(check => check.status === 'passed').length}/${report.checks.length} checks; ${report.inputs.length} source/evidence files; ${report.binaries.filter(binary => binary.status === 'verified').length} executable checks.`);
console.log(path.relative(root, output));
if (report.status !== 'complete') process.exitCode = 1;
