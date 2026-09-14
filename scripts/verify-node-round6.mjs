/** Offline verification of completed round-six Node comparisons and charts.
 * node scripts/verify-node-round6.mjs
 * No subprocesses, builds, benchmarks or executable invocation. Generated dist,
 * original executables and temporary baseline worktrees are not required.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = 'go/benchmarks/optimization-round6';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(), checks: [], files: [], unavailable: [],
  limitations: [
    'No test, benchmark, build, renderer or executable is run. Checks operate on saved evidence.',
    'Generated dist files and historical executables are checked when present; absent generated files are explicitly recorded, never treated as verified.',
    'The temporary baseline worktree is not required or read. Its manifest is checked internally and its worker entries compared with the current worker manifest.',
    'Recorded executable hashes and source manifests do not prove the build process. Original stdout hashes are retained; canonical parsed-output hashes are recomputed.',
    'Artifact hashes and chart data are checked. Visual layout review and statistical significance are separate.',
  ],
};
const files = new Map(), datasets = new Map(), comparableDigests = new Map(), comparableGoLengths = new Map();
function resolve(file) {
  assert.equal(typeof file, 'string');
  const normalized = file.replaceAll('\\', '/'), marker = '/rpg-dice-roller/';
  const index = normalized.toLowerCase().lastIndexOf(marker);
  const relative = index >= 0 ? normalized.slice(index + marker.length) : normalized;
  assert.ok(!path.win32.isAbsolute(relative) && !path.posix.isAbsolute(relative), `Non-repository path: ${file}`);
  const absolute = path.resolve(root, relative);
  assert.ok(!path.relative(root, absolute).startsWith('..'), `Path outside checkout: ${file}`);
  return absolute;
}
function read(file) {
  const absolute = resolve(file), bytes = readFileSync(absolute), relative = path.relative(root, absolute).replaceAll('\\', '/');
  files.set(relative, { path: relative, sha256: hash(bytes), bytes: bytes.length });
  return bytes;
}
const json = file => JSON.parse(read(file).toString('utf8').replace(/^\uFEFF/, ''));
function verifyFile(record, optional = false) {
  const file = record.path ?? record.file;
  assert.match(record.sha256, /^[a-f\d]{64}$/);
  if (optional && !existsSync(resolve(file))) {
    report.unavailable.push({ path: file, sha256: record.sha256, status: 'not verified; optional local/generated artifact absent' });
    return false;
  }
  const bytes = read(file);
  assert.equal(hash(bytes), record.sha256, `File hash: ${file}`);
  if (record.bytes !== undefined) assert.equal(bytes.length, record.bytes, `File length: ${file}`);
  return true;
}
function checked(name, action) {
  try { report.checks.push({ name, status: 'passed', ...action() }); }
  catch (error) { report.checks.push({ name, status: 'failed', error: error.message }); }
}
function manifest(source, checkFiles) {
  assert.equal(hash(JSON.stringify(source.files)), source.sha256, 'Manifest aggregate hash');
  const names = source.files.map(entry => entry.path);
  assert.deepEqual(names, [...new Set(names)].sort(), 'Manifest paths must be unique and sorted');
  for (const entry of source.files) {
    assert.match(entry.sha256, /^[a-f\d]{64}$/);
    if (checkFiles) verifyFile(entry, entry.path.startsWith('dist/'));
  }
  return new Map(source.files.map(entry => [entry.path, entry.sha256]));
}
function positive(value, label) { assert.ok(Number.isFinite(value) && value > 0, `Nonpositive ${label}: ${value}`); }
function near(actual, expected, label) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-12,
    `${label}: ${actual} != ${expected}`);
}
function quantile(values, fraction) {
  assert.ok(values.length);
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * fraction, lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}
function nullable(actual, expected, label) { if (expected === null) assert.equal(actual, null, label); else near(actual, expected, label); }
const configurations = ['node', 'go-baseline-default', 'go-final-default', 'go-baseline-tuned', 'go-final-tuned'];
const workloads = [
  ['d20', '1d20+5'], ['100d6', '100d6'], ['pool', '20d6!2ro=1kh10'], ['1000d6', '1000d6'],
  ['reroll-selection', '100d6ro=1kh60'], ['multi-group', '2#{4d6,3d8+2}kh1'],
  ['unicode-comment', '20d6!2ro=1kh10 # ação 🎲'], ['fudge', '100dF.2'],
  ['fractional-bounds', '50d6min2.125max4.875kh25'], ['target-pool', '40d10>=7f=1'], ['drop-group', '{6d6,4d8}dl1'],
];
const workloadIDs = workloads.map(([id]) => id);
function digest(workload, run, value, count, seriesLengths) {
  const { encodedLength, ...fields } = value;
  assert.equal(fields.count, count); positive(encodedLength, 'encoded length');
  assert.deepEqual(Object.keys(fields).sort(), ['count', 'randomCalls', 'total', 'weightedTotal']);
  assert.ok(Object.values(fields).every(Number.isFinite));
  // Require exact delivery parity within each worker-count invocation. Different
  // worker partitions can change the order of floating-point accumulation.
  const key = `${run.request.workers}/${workload}/${count}`;
  if (!comparableDigests.has(key)) comparableDigests.set(key, fields);
  else assert.deepEqual(fields, comparableDigests.get(key), `Delivery digest: ${key}/${run.configuration}`);
  if (run.runtime === 'go') {
    if (!comparableGoLengths.has(key)) comparableGoLengths.set(key, encodedLength);
    else assert.equal(encodedLength, comparableGoLengths.get(key), `Go byte count: ${key}`);
  }
  const localKey = `${run.configuration}/${key}`;
  if (!seriesLengths.has(localKey)) seriesLengths.set(localKey, encodedLength);
  else assert.equal(encodedLength, seriesLengths.get(localKey), `Per-series length stability: ${localKey}`);
}
function verifyDataset(workers) {
  const data = json(`${directory}/node-round6-w${workers}.json`), config = data.configuration;
  assert.equal(data.schemaVersion, 1); assert.equal(data.status, 'complete');
  const expectedConfig = { workers, gomaxprocs: 12, requests: 4096, latencyRequests: 2048, samplesPerProcess: 3, rounds: 2,
    warmupPerWorker: 256, operation: 'build-and-encode', engineMode: 'pool', randomAlgorithm: 'mt19937', freezeResults: 'never', cache: 'warm', wallBudgetMs: 540000 };
  for (const [key, value] of Object.entries(expectedConfig)) assert.equal(config[key], value, `Configuration ${key}`);
  assert.equal(config.seedPrefix, 'dicecore-backend/v3.7.1/');
  assert.deepEqual(config.validationIndices, [0, 1, 5, 127, 511, 4095]);
  assert.deepEqual(config.orders, [configurations, [...configurations].reverse()]);
  assert.deepEqual(data.workloads.map(({ id, input }) => [id, input]), workloads);
  assert.deepEqual(data.workloads.map(value => value.category), [...Array(3).fill('main'), ...Array(6).fill('round5-regression'), ...Array(2).fill('new-holdout')]);
  assert.ok(data.workloads.every(value => value.mode === 'full'));
  positive(data.wallMilliseconds, 'invocation duration'); assert.ok(data.wallMilliseconds <= 540000);
  assert.deepEqual(data.configurations.map(value => value.id), configurations);
  for (const current of data.configurations) {
    const isGo = current.id !== 'node', tuned = current.id.endsWith('tuned');
    assert.equal(current.runtime, isGo ? 'go' : 'node'); assert.equal(current.encoder, isGo ? 'dicecore.MarshalJSON' : 'JSON.stringify');
    if (isGo) {
      assert.equal(current.gc, tuned ? 500 : 100); assert.equal(current.memoryLimit, tuned ? '96MiB' : null);
      assert.equal(current.executable, data.binaries[current.id.includes('baseline') ? 'baseline' : 'current'].path);
    }
  }
  const currentSources = manifest(data.source, true), workerSources = manifest(data.workerSource, true);
  for (const [file, sha256] of workerSources) assert.equal(currentSources.get(file), sha256, `Worker/source mismatch: ${file}`);
  for (const file of currentSources.keys()) if (/^go\/node_compare_.*\.go$/.test(file)) assert.ok(workerSources.has(file), `Unlisted comparison helper: ${file}`);
  assert.equal(data.baseline.reference, 'f107265'); assert.equal(data.baseline.commit, 'f1072657da80c837f8e3740c734a89d26619bf50');
  if (data.baseline.source) {
    const baselineSources = manifest(data.baseline.source, false);
    for (const [file, sha256] of workerSources) if (file.startsWith('go/')) assert.equal(baselineSources.get(file), sha256, `Baseline worker differs: ${file}`);
  }
  for (const binary of Object.values(data.binaries)) verifyFile(binary, true);
  for (const key of ['currentSourceStable', 'executableHashesStable', 'fullPreflightParity', 'deliveryDigests', 'perSeriesEncodedLengthsStable', 'individualSampleCounts', 'batchCounts']) assert.equal(data.checks[key], true);
  const expectedGo = /^go version (\S+)/.exec(data.environment.go)?.[1]; assert.ok(expectedGo);
  function runShape(run, phase) {
    assert.equal(run.phase, phase); assert.equal(run.request.phase, phase);
    assert.equal(run.outputCanonicalSha256, hash(JSON.stringify(run.output)), 'Canonical parsed worker-output hash');
    assert.match(run.workerOutputSha256, /^[a-f\d]{64}$/);
    const current = data.configurations.find(value => value.id === run.configuration); assert.ok(current);
    assert.equal(run.runtime, current.runtime); assert.equal(run.output.encoder, current.encoder);
    assert.equal(run.output.runtime, run.runtime === 'go' ? expectedGo : data.environment.node);
    assert.equal(run.output.clock?.source, run.runtime === 'node' ? 'process.hrtime.bigint'
      : data.environment.platform === 'win32' ? 'QueryPerformanceCounter' : 'time.Now/time.Since monotonic');
    if (run.runtime === 'go' && data.environment.platform === 'win32') {
      assert.ok(Number.isSafeInteger(run.output.clock.frequencyHz) && run.output.clock.frequencyHz > 0, 'Invalid QPC frequency');
    }
    if (run.runtime === 'go') {
      assert.equal(run.output.gomaxprocs, 12); assert.equal(run.environment.GOMAXPROCS, '12');
      assert.equal(run.environment.GOGC, String(current.gc)); assert.equal(run.environment.GOMEMLIMIT, current.memoryLimit);
    }
    assert.deepEqual(run.request.workloads, data.workloads);
    assert.deepEqual(run.request.validationIndices, config.validationIndices);
    for (const [key, value] of Object.entries({ workers, requests: 4096, samples: 3, warmup: 256, latencyRequests: 2048, engineMode: 'pool', seedPrefix: config.seedPrefix })) assert.equal(run.request[key], value);
    assert.deepEqual(Object.keys(run.output.cases).sort(), [...workloadIDs].sort());
  }
  const pre = data.preflight;
  for (const key of ['passed', 'goStdlibByteEquality', 'goBaselineByteEquality', 'completeDecodedValueEquality']) assert.equal(pre[key], true);
  assert.equal(pre.configurations, 5); assert.equal(pre.uniqueOutputs, 66);
  const compressed = read(pre.file), expanded = gunzipSync(compressed);
  assert.equal(hash(compressed), pre.compressedSha256); assert.equal(hash(expanded), pre.uncompressedSha256);
  assert.equal(compressed.length, pre.compressedBytes); assert.equal(expanded.length, pre.uncompressedBytes);
  const preflight = JSON.parse(expanded.toString('utf8'));
  assert.deepEqual(preflight.validationIndices, config.validationIndices);
  assert.deepEqual(preflight.runs.map(run => run.configuration), configurations);
  let expectedValues, expectedGoBytes;
  for (const run of preflight.runs) {
    runShape(run, 'preflight'); assert.equal(run.round, null);
    const values = {}, goBytes = {};
    for (const id of workloadIDs) {
      const entries = run.output.cases[id]; assert.deepEqual(entries.map(entry => entry.index), config.validationIndices);
      values[id] = entries.map(entry => {
        assert.equal(run.runtime === 'go' ? Buffer.byteLength(entry.json) : entry.json.length, entry.encodedLength);
        if (run.runtime === 'go') assert.equal(entry.stdlibEqual, true);
        return { index: entry.index, value: JSON.parse(entry.json) };
      });
      goBytes[id] = entries.map(entry => ({ index: entry.index, json: entry.json }));
    }
    if (expectedValues === undefined) expectedValues = values; else assert.deepEqual(values, expectedValues, 'Complete Node/Go preflight values');
    if (run.runtime === 'go') {
      if (expectedGoBytes === undefined) expectedGoBytes = goBytes; else assert.deepEqual(goBytes, expectedGoBytes, 'Complete Go preflight bytes');
    }
  }
  assert.equal(data.runs.length, 10);
  const seriesLengths = new Map(), series = new Map();
  data.runs.forEach((run, index) => {
    runShape(run, 'measure'); assert.equal(run.round, Math.floor(index / 5) + 1);
    assert.equal(run.configuration, config.orders[Math.floor(index / 5)][index % 5]);
    assert.deepEqual(Object.keys(run.output.latency).sort(), [...workloadIDs].sort());
    assert.deepEqual(Object.keys(run.output.memory).sort(), [...workloadIDs].sort());
    for (const id of workloadIDs) {
      const key = `${run.configuration}/${id}`;
      if (!series.has(key)) series.set(key, { durations: [], cpu: [], rss: [], latency: [], lengths: [] });
      const samples = series.get(key), batches = run.output.cases[id], rss = run.output.memory[id].afterBatches;
      assert.equal(batches.length, 3); assert.equal(rss.length, 3);
      for (const batch of batches) {
        assert.equal(batch.workers, workers); assert.equal(batch.requests, 4096); positive(batch.durationNs, 'batch duration');
        digest(id, run, batch.digest, 4096, seriesLengths); samples.durations.push(batch.durationNs); samples.lengths.push(batch.digest.encodedLength / 4096);
        if (batch.cpu.available) {
          const cpu = batch.cpu;
          assert.equal(cpu.before.available, true); assert.equal(cpu.after.available, true);
          assert.ok([cpu.userNs, cpu.systemNs, cpu.totalNs].every(value => Number.isFinite(value) && value >= 0));
          assert.equal(cpu.totalNs, cpu.userNs + cpu.systemNs); assert.equal(cpu.before.source, cpu.after.source);
          assert.equal(cpu.userNs, cpu.after.userNs - cpu.before.userNs); assert.equal(cpu.systemNs, cpu.after.systemNs - cpu.before.systemNs);
          samples.cpu.push(cpu.totalNs / 4096);
        }
      }
      for (const value of rss) if (value.available) { positive(value.rssBytes, 'RSS'); samples.rss.push(value.rssBytes / 2 ** 20); }
      const latency = run.output.latency[id]; assert.equal(latency.requests, 2048); assert.equal(latency.samplesByWorkerNs.length, workers);
      latency.samplesByWorkerNs.forEach((values, worker) => {
        assert.equal(values.length, Math.floor((2047 - worker) / workers) + 1);
        for (const value of values) positive(value, 'individual duration');
        samples.latency.push(...values);
      });
      digest(id, run, latency.digest, 2048, seriesLengths);
    }
  });
  assert.deepEqual(data.summary.map(row => row.id), workloadIDs);
  for (const row of data.summary) for (const id of configurations) {
    assert.equal(row.input, workloads.find(([key]) => key === row.id)[1]); assert.equal(row.workers, workers); assert.equal(row.mode, 'full');
    const stats = row[id], samples = series.get(`${id}/${row.id}`); assert.ok(stats);
    assert.equal(stats.batchSamplesCount, 6); assert.deepEqual(stats.batchSamplesNs, samples.durations);
    for (const [field, fraction] of [['q1BatchMs', .25], ['medianBatchMs', .5], ['q3BatchMs', .75]]) near(stats[field], quantile(samples.durations, fraction) / 1e6, field);
    near(stats.opsPerSecond, 4096e9 / quantile(samples.durations, .5), 'throughput');
    assert.deepEqual(stats.cpuSamplesNsPerOp, samples.cpu); assert.equal(stats.cpuSamplesCount, samples.cpu.length); assert.equal(stats.cpuMeasuredRequests, samples.cpu.length * 4096);
    const total = samples.cpu.reduce((sum, value) => sum + value * 4096, 0); near(stats.measuredCpuTotalNs, total, 'CPU sum');
    nullable(stats.aggregateCpuNsPerOp, samples.cpu.length === 6 && total > 0 ? total / (6 * 4096) : null, 'aggregate CPU/op');
    for (const [field, fraction] of [['q1CpuNsPerOp', .25], ['medianCpuNsPerOp', .5], ['q3CpuNsPerOp', .75]]) nullable(stats[field], samples.cpu.length ? quantile(samples.cpu, fraction) : null, field);
    assert.deepEqual(stats.rssSamplesMiB, samples.rss);
    nullable(stats.medianSnapshotRssMiB, samples.rss.length ? quantile(samples.rss, .5) : null, 'RSS median');
    nullable(stats.maximumSnapshotRssMiB, samples.rss.length ? Math.max(...samples.rss) : null, 'RSS maximum');
    assert.equal(stats.latencySamplesCount, 4096); assert.equal(samples.latency.length, 4096);
    near(stats.p50LatencyNs, quantile(samples.latency, .5), 'individual p50'); near(stats.p95LatencyNs, quantile(samples.latency, .95), 'individual p95');
    assert.equal(stats.encodedLengthPerResult, samples.lengths[0]);
    assert.equal(stats.encodedLengthUnit, id === 'node' ? 'UTF-16 code units' : 'UTF-8 bytes');
  }
  read(`go/NODE_ROUND6_W${workers}.md`);
  datasets.set(workers, data);
  return { workers, workloads: 11, series: 5, processes: 10, throughputBatches: 330, individualDurations: 225280, preflightOutputs: 330,
    sourceManifestSha256: data.source.sha256, workerManifestSha256: data.workerSource.sha256 };
}

checked('invocation', () => { assert.equal(process.argv.length, 2, 'Usage: node scripts/verify-node-round6.mjs'); read('scripts/verify-node-round6.mjs'); return {}; });
for (const workers of [1, 6]) checked(`${workers} worker(s): sources, complete preflight, digests and summaries`, () => verifyDataset(workers));
checked('same source/configuration across worker counts', () => {
  const one = datasets.get(1), six = datasets.get(6); assert.ok(one && six, 'Both datasets must pass first');
  assert.equal(one.source.sha256, six.source.sha256); assert.equal(one.workerSource.sha256, six.workerSource.sha256);
  assert.deepEqual({ ...one.configuration, workers: null }, { ...six.configuration, workers: null });
  assert.deepEqual(one.workloads, six.workloads);
  for (const field of ['cpuModel', 'osVersion', 'node', 'go']) assert.equal(one.environment[field], six.environment[field]);
  for (const binary of ['baseline', 'current']) assert.equal(one.binaries[binary].sha256, six.binaries[binary].sha256);
  return { distinctWorkerCounts: [1, 6], unchangedWorkloads: 11 };
});
checked('chart artifact manifest and hashes', () => {
  assert.equal(datasets.size, 2, 'Both datasets must pass first');
  const plotted = json(`${directory}/charts/plot-node-round6-manifest.json`);
  assert.equal(plotted.schemaVersion, 1); assert.deepEqual(plotted.workerCounts, [1, 6]);
  assert.equal(plotted.sourceManifestSha256, datasets.get(1).source.sha256);
  verifyFile(plotted.renderer);
  assert.deepEqual(plotted.inputs.map(value => value.path), [1, 6].map(workers => `${directory}/node-round6-w${workers}.json`));
  for (const input of plotted.inputs) verifyFile(input);
  assert.deepEqual(plotted.series, ['node', 'go-final-default', 'go-final-tuned']);
  assert.deepEqual(plotted.excludedSeries, ['go-baseline-default', 'go-baseline-tuned']);
  assert.deepEqual(Object.keys(plotted.charts).sort(), ['cpu-per-op', 'latency-p95', 'rss', 'throughput']);
  for (const [kind, chart] of Object.entries(plotted.charts)) {
    assert.equal(chart.metric, kind); assert.equal(chart.displayedValues.length, 66);
    assert.deepEqual(chart.outputs.map(output => path.extname(output.path)).sort(), ['.png', '.svg']);
    for (const output of chart.outputs) verifyFile(output);
    const seen = new Set();
    for (const point of chart.displayedValues) {
      const key = `${point.workers}/${point.workload}/${point.configuration}`; assert.ok(!seen.has(key)); seen.add(key);
      assert.ok(plotted.series.includes(point.configuration));
      const row = datasets.get(point.workers)?.summary.find(row => row.id === point.workload); assert.ok(row); assert.equal(point.input, row.input);
      const stats = row[point.configuration];
      const expected = kind === 'throughput' ? stats.opsPerSecond / 1000 : kind === 'latency-p95' ? stats.p95LatencyNs / 1000
        : kind === 'rss' ? stats.medianSnapshotRssMiB : stats.aggregateCpuNsPerOp === null ? null : stats.aggregateCpuNsPerOp / 1000;
      nullable(point.value, expected, `Chart value ${key}`);
    }
  }
  return { charts: 4, exports: 8, plottedValues: 264 };
});
checked('excluded coarse-clock attempt preserved', () => {
  const archived = json(`${directory}/failed-coarse-clock/node-round6-w1.json`);
  assert.equal(archived.status, 'failed'); assert.ok(archived.error?.message);
  const compressed = read(`${directory}/failed-coarse-clock/node-round6-w1-preflight.json.gz`);
  assert.equal(compressed.length, archived.preflight.compressedBytes);
  assert.equal(hash(compressed), archived.preflight.compressedSha256);
  const expanded = gunzipSync(compressed);
  assert.equal(expanded.length, archived.preflight.uncompressedBytes);
  assert.equal(hash(expanded), archived.preflight.uncompressedSha256);
  read(`${directory}/failed-coarse-clock/README.md`);
  return { includedInFinalDatasets: false };
});
checked('excluded wall-budget attempt preserved', () => {
  const archiveDirectory = `${directory}/failed-wall-budget`;
  const archived = json(`${archiveDirectory}/node-round6-w1.json`);
  assert.equal(archived.status, 'failed'); assert.match(archived.error?.message, /ETIMEDOUT/);
  assert.equal(archived.configuration.wallBudgetMs, 360000); assert.equal(archived.runs.length, 9);
  assert.equal(archived.preflight.passed, true);
  const compressed = read(`${archiveDirectory}/node-round6-w1-preflight.json.gz`);
  assert.equal(compressed.length, archived.preflight.compressedBytes);
  assert.equal(hash(compressed), archived.preflight.compressedSha256);
  const expanded = gunzipSync(compressed);
  assert.equal(expanded.length, archived.preflight.uncompressedBytes);
  assert.equal(hash(expanded), archived.preflight.uncompressedSha256);
  const oldSources = manifest(archived.source, false);
  verifyFile({ path: `${archiveDirectory}/compare-node-round6.mjs.txt`, sha256: oldSources.get('scripts/compare-node-round6.mjs') });
  for (const run of archived.runs) {
    assert.equal(run.outputCanonicalSha256, hash(JSON.stringify(run.output)));
    if (run.runtime === 'go') assert.equal(run.output.clock.source, 'QueryPerformanceCounter');
  }
  const final = datasets.get(1);
  if (final) {
    assert.deepEqual({ ...archived.configuration, wallBudgetMs: 540000 }, final.configuration);
    assert.equal(archived.workerSource.sha256, final.workerSource.sha256);
    for (const entry of final.source.files) if (entry.path !== 'scripts/compare-node-round6.mjs') {
      assert.equal(entry.sha256, oldSources.get(entry.path), `Source changed beyond wall-budget adjustment: ${entry.path}`);
    }
    for (const binary of ['baseline', 'current']) assert.equal(archived.binaries[binary].sha256, final.binaries[binary].sha256);
  }
  read(`${archiveDirectory}/README.md`);
  return { includedInFinalDatasets: false, completedProcesses: 9, originalWallBudgetMs: 360000 };
});
report.status = report.checks.every(check => check.status === 'passed') ? 'complete' : 'failed';
report.finishedAt = new Date().toISOString(); report.files = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
report.verifiedFileManifestSha256 = hash(JSON.stringify(report.files));
writeFileSync(resolve(`${directory}/node-round6-verification.json`), JSON.stringify(report, null, 2) + '\n');
for (const check of report.checks) console.log(`${check.status === 'passed' ? 'PASS' : 'FAIL'} ${check.name}${check.error ? `: ${check.error}` : ''}`);
console.log(`${report.status.toUpperCase()}: ${report.checks.filter(check => check.status === 'passed').length}/${report.checks.length} checks, ${report.files.length} files checked, ${report.unavailable.length} optional files unavailable.`);
console.log(`${directory}/node-round6-verification.json`);
if (report.status !== 'complete') process.exitCode = 1;
