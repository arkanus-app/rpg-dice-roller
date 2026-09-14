/** Optional backend GC experiment using the same frozen worker as the default comparison. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const reference = JSON.parse(readFileSync(path.join(root, 'go/benchmarks/backend-round2-final.json'), 'utf8'));
assert.equal(reference.status, 'complete');
const binary = path.join(root, '.artifacts', `dicecore-backend${process.platform === 'win32' ? '.exe' : ''}`);
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(hash(binary), reference.goWorkerBinary.sha256, 'Rebuild the default benchmark before changing the worker');
for (const source of reference.source.files) assert.equal(hash(path.join(root, source.path)), source.sha256, `Source changed: ${source.path}`);
assert.equal(process.env.GOMEMLIMIT ?? null, null, 'Run this experiment without an inherited Go memory cap');
assert.equal(reference.environment.runtimeEnvironment.GOMEMLIMIT, null, 'The default reference must not use a memory cap');
assert.equal(process.env.GOMAXPROCS ?? null, reference.environment.runtimeEnvironment.GOMAXPROCS, 'Use the same GOMAXPROCS as the reference');
const gcBudgetMs = Math.min(180000, Number(process.env.DICECORE_GC_BUDGET_MS ?? 180000));
assert.ok(Number.isSafeInteger(gcBudgetMs) && gcBudgetMs > 0, 'Positive remaining GC experiment budget required');
const request = { ...reference.configuration, wallBudgetMs: gcBudgetMs, phase: 'measure', workers: 6, engineMode: 'pool', workloads: reference.workloads, validationIndices: [] };
const expected = reference.runs.find(run => run.runtime === 'go-pool' && run.workers === 6).output.cases;
const outputPath = path.join(root, 'go/benchmarks/gc-round2-tuning.json');
const started = Date.now(), deadline = started + gcBudgetMs;
const raw = {
  status: 'running', startedAt: new Date(started).toISOString(),
  experimentScript: { path: 'scripts/compare-go-gc-round2.mjs', sha256: hash(path.join(root, 'scripts/compare-go-gc-round2.mjs')) },
  hypothesis: 'A larger Go GC target may recover throughput for allocation-heavy backend results while using less RSS than the JavaScript processes. This is an explicit backend process setting, never a library-global change.',
  configuration: request, referenceEnvironment: reference.environment,
  environment: { cpuModel: os.cpus()[0].model, logicalCPUs: os.cpus().length, osVersion: os.version(), arch: process.arch, inheritedGOMAXPROCS: process.env.GOMAXPROCS ?? null, inheritedGOMEMLIMIT: process.env.GOMEMLIMIT ?? null },
  source: reference.source,
  goWorkerBinary: reference.goWorkerBinary,
  selection: 'Try GOGC=200,500,1000 against a fresh GOGC=100 control. Choose highest 100d6-full throughput with all observed post-batch RSS <=128 MiB. Repeat that candidate, then GOGC=100 in reverse order. Publish all workloads and regressions; do not replace default results.',
  commands: [], runs: [],
};
const save = () => writeFileSync(outputPath, JSON.stringify(raw, null, 2) + '\n');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function measure(gc, stage) {
  const env = { ...process.env, DICECORE_BACKEND_WORKER: '1', GOGC: String(gc) };
  // Clear an inherited memory cap so GOGC is the only changed runtime setting.
  delete env.GOMEMLIMIT;
  const args = ['-test.run=^TestBackendBenchmarkWorker$'];
  raw.commands.push({ gc, stage, executable: binary, args, cwd: 'go', env: { GOGC: env.GOGC, GOMEMLIMIT: null, GOMAXPROCS: env.GOMAXPROCS ?? null } });
  const result = spawnSync(binary, args, { cwd: path.join(root, 'go'), env, input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: Math.max(1, deadline - Date.now()), maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? 'Worker failed');
  const line = result.stdout.split(/\r?\n/).find(line => line.startsWith('DICECORE_BACKEND '));
  assert.ok(line, 'Missing worker result');
  const output = JSON.parse(line.slice('DICECORE_BACKEND '.length));
  const summary = Object.fromEntries(reference.workloads.map(workload => {
    const measurements = output.cases[workload.id];
    assert.equal(measurements.length, request.samples);
    for (const sample of measurements) assert.deepEqual(sample.digest, expected[workload.id][0].digest, `Different results at GOGC=${gc}, ${workload.id}`);
    const rss = output.memory[workload.id].afterBatches.filter(x => x.available).map(x => x.rssBytes / 2 ** 20);
    const ns = median(measurements.map(x => x.durationNs));
    return [workload.id, { batchMs: ns / 1e6, opsPerSecond: request.requests * 1e9 / ns, medianRssMiB: rss.length ? median(rss) : null, maximumRssMiB: rss.length ? Math.max(...rss) : null }];
  }));
  const run = { gc, stage, output, summary };
  raw.runs.push(run); save();
  console.log(`GOGC=${gc} ${stage}: 100d6 full ${Math.round(summary['100d6-full'].opsPerSecond)} ops/s, RSS ${summary['100d6-full'].medianRssMiB?.toFixed(1)} MiB`);
  return run;
}
save();
try {
  const control = measure(100, 'selection');
  const candidates = [200, 500, 1000].map(gc => measure(gc, 'selection'));
  const eligible = candidates.filter(run => Object.values(run.summary).every(row => row.maximumRssMiB !== null && row.maximumRssMiB <= 128));
  const best = eligible.sort((a, b) => b.summary['100d6-full'].opsPerSecond - a.summary['100d6-full'].opsPerSecond)[0];
  if (best && best.summary['100d6-full'].opsPerSecond > control.summary['100d6-full'].opsPerSecond) {
    raw.selectedGc = best.gc;
    const confirmed = measure(best.gc, 'confirmation');
    const repeatedControl = measure(100, 'confirmation');
    raw.confirmedGc = confirmed.summary['100d6-full'].opsPerSecond > repeatedControl.summary['100d6-full'].opsPerSecond
      && Object.values(confirmed.summary).every(row => row.maximumRssMiB !== null && row.maximumRssMiB <= 128)
      ? best.gc : null;
  } else raw.selectedGc = null;
  for (const source of reference.source.files) assert.equal(hash(path.join(root, source.path)), source.sha256, `Source changed: ${source.path}`);
  raw.status = 'complete'; raw.finishedAt = new Date().toISOString(); raw.wallMilliseconds = Date.now() - started; save();
} catch (error) {
  raw.status = 'failed'; raw.error = error.message; raw.wallMilliseconds = Date.now() - started; save(); throw error;
}
