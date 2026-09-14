/** Explicit extension: GOGC=500 with 64/96 MiB soft runtime memory limits. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const reference = JSON.parse(readFileSync(path.join(root, 'go/benchmarks/backend-round2-final.json'), 'utf8'));
const originalFile = path.join(root, 'go/benchmarks/gc-round2-tuning.json');
const original = JSON.parse(readFileSync(originalFile, 'utf8'));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const binary = path.join(root, '.artifacts', `dicecore-backend${process.platform === 'win32' ? '.exe' : ''}`);
assert.equal(reference.status, 'complete');
assert.equal(hash(binary), reference.goWorkerBinary.sha256);
for (const source of reference.source.files) assert.equal(hash(path.join(root, source.path)), source.sha256, `Changed source: ${source.path}`);
assert.equal(process.env.GOMEMLIMIT ?? null, null);
assert.equal(process.env.GOMAXPROCS ?? null, reference.environment.runtimeEnvironment.GOMAXPROCS);
const request = { ...reference.configuration, wallBudgetMs: 90000, phase: 'measure', workers: 6, engineMode: 'pool', workloads: reference.workloads, validationIndices: [] };
const expected = reference.runs.find(run => run.runtime === 'go-pool' && run.workers === 6).output.cases;
const started = Date.now(), deadline = started + 90000;
const outputFile = path.join(root, 'go/benchmarks/gc-round2-memory-cap.json');
const raw = { status: 'running', startedAt: new Date(started).toISOString(), configuration: request, source: reference.source, goWorkerBinary: reference.goWorkerBinary,
  environment: original.environment, referenceEnvironment: reference.environment,
  extensionOf: { file: 'go/benchmarks/gc-round2-tuning.json', sha256: hash(originalFile), reason: 'The original GOGC=500 candidate exceeded 128 MiB RSS during confirmation. This explicitly authorized extension tries only 64MiB and 96MiB soft Go runtime memory limits with GOGC=500, without changing library code.' },
  selection: 'Fresh GOGC=100/no-cap control, GOGC=500/GOMEMLIMIT=64MiB, then GOGC=500/GOMEMLIMIT=96MiB. Select highest 100d6-full throughput among candidates whose maximum observed post-batch RSS is <=128MiB in all nine workloads. Confirm selected candidate, then a fresh GOGC=100/no-cap control. GOMEMLIMIT is a soft runtime memory limit, not an RSS cap.',
  experimentScript: { path: 'scripts/compare-go-gc-memory-cap.mjs', sha256: hash(path.join(root, 'scripts/compare-go-gc-memory-cap.mjs')) }, commands: [], runs: [] };
const save = () => writeFileSync(outputFile, JSON.stringify(raw, null, 2) + '\n');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function measure(gc, memoryLimit, stage) {
  const env = { ...process.env, DICECORE_BACKEND_WORKER: '1', GOGC: String(gc) };
  if (memoryLimit) env.GOMEMLIMIT = memoryLimit; else delete env.GOMEMLIMIT;
  const args = ['-test.run=^TestBackendBenchmarkWorker$'];
  raw.commands.push({ gc, memoryLimit, stage, executable: binary, args, cwd: 'go', env: { GOGC: String(gc), GOMEMLIMIT: memoryLimit, GOMAXPROCS: env.GOMAXPROCS ?? null } });
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Memory-cap extension exhausted its 90-second budget');
  const result = spawnSync(binary, args, { cwd: path.join(root, 'go'), env, input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: remaining, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? 'Worker failed');
  const line = result.stdout.split(/\r?\n/).find(line => line.startsWith('DICECORE_BACKEND '));
  assert.ok(line);
  const output = JSON.parse(line.slice('DICECORE_BACKEND '.length));
  const summary = Object.fromEntries(reference.workloads.map(workload => {
    const samples = output.cases[workload.id];
    assert.equal(samples.length, request.samples);
    for (const sample of samples) assert.deepStrictEqual(sample.digest, expected[workload.id][0].digest);
    const rss = output.memory[workload.id].afterBatches.filter(value => value.available).map(value => value.rssBytes / 2 ** 20);
    const duration = median(samples.map(sample => sample.durationNs));
    return [workload.id, { batchMs: duration / 1e6, opsPerSecond: request.requests * 1e9 / duration, medianRssMiB: rss.length ? median(rss) : null, maximumRssMiB: rss.length ? Math.max(...rss) : null }];
  }));
  const run = { gc, memoryLimit, stage, output, summary }; raw.runs.push(run); save();
  console.log(`GOGC=${gc} GOMEMLIMIT=${memoryLimit ?? 'unset'} ${stage}: 100d6/full ${Math.round(summary['100d6-full'].opsPerSecond)} ops/s, max RSS across workloads ${Math.max(...Object.values(summary).map(value => value.maximumRssMiB)).toFixed(1)} MiB`);
  return run;
}
save();
try {
  const control = measure(100, null, 'selection');
  const candidates = ['64MiB', '96MiB'].map(limit => measure(500, limit, 'selection'));
  const eligible = candidates.filter(run => Object.values(run.summary).every(row => row.maximumRssMiB !== null && row.maximumRssMiB <= 128));
  const best = eligible.sort((a, b) => b.summary['100d6-full'].opsPerSecond - a.summary['100d6-full'].opsPerSecond)[0];
  raw.selectedGc = best?.gc ?? null; raw.selectedMemoryLimit = best?.memoryLimit ?? null;
  if (best && best.summary['100d6-full'].opsPerSecond > control.summary['100d6-full'].opsPerSecond) {
    const candidate = measure(best.gc, best.memoryLimit, 'confirmation');
    const repeatedControl = measure(100, null, 'confirmation');
    const passed = candidate.summary['100d6-full'].opsPerSecond > repeatedControl.summary['100d6-full'].opsPerSecond && Object.values(candidate.summary).every(row => row.maximumRssMiB !== null && row.maximumRssMiB <= 128);
    raw.confirmedGc = passed ? best.gc : null; raw.confirmedMemoryLimit = passed ? best.memoryLimit : null;
  } else { raw.confirmedGc = null; raw.confirmedMemoryLimit = null; }
  for (const source of reference.source.files) assert.equal(hash(path.join(root, source.path)), source.sha256, `Changed source: ${source.path}`);
  raw.status = 'complete'; raw.finishedAt = new Date().toISOString(); raw.wallMilliseconds = Date.now() - started; save();
} catch (error) { raw.status = 'failed'; raw.error = error.message; raw.wallMilliseconds = Date.now() - started; save(); throw error; }
