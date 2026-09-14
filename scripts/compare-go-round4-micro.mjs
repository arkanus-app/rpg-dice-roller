/** Serial, alternating A/B measurements; profiles and compilation stay outside timing. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const [baseline, candidate, label, filter = '^(BenchmarkEventNumber|BenchmarkResolvedEventsJSON)$'] = process.argv.slice(2);
assert.ok(baseline && candidate && /^[a-z0-9-]+$/.test(label), 'Usage: node scripts/compare-go-round4-micro.mjs baseline.exe candidate.exe label [benchmark-regexp]');
const directory = path.resolve('go/benchmarks/optimization-round4');
mkdirSync(directory, { recursive: true });
const started = Date.now(), budgetMs = 120000;
const variants = { before: path.resolve(baseline), after: path.resolve(candidate) };
const files = Object.fromEntries(Object.keys(variants).map(key => [key, path.join(directory, `${label}-${key}.txt`)]));
const metadata = { status: 'running', label, startedAt: new Date(started).toISOString(), budgetMs, rounds: 10, order: [], filter,
  cpu: os.cpus()[0].model.trim(), os: os.version(), env: { GOMAXPROCS: '1', GOGC: '100', GOMEMLIMIT: 'off' },
  binaries: Object.fromEntries(Object.entries(variants).map(([key, file]) => [key, { file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }])), runs: [] };
const persist = () => writeFileSync(path.join(directory, `${label}.json`), JSON.stringify(metadata, null, 2) + '\n');
for (const file of Object.values(files)) writeFileSync(file, '');
persist();
try {
  for (let round = 0; round < metadata.rounds; round++) {
    const order = round % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
    metadata.order.push(order);
    for (const variant of order) {
      const timeout = started + budgetMs - Date.now();
      assert.ok(timeout > 0, 'Microbenchmark wall-clock budget exhausted');
      const args = ['-test.run=^$', `-test.bench=${filter}`, '-test.benchtime=100ms', '-test.count=1', '-test.benchmem'];
      const runStart = Date.now();
      const result = spawnSync(variants[variant], args, { cwd: path.resolve('go'), env: { ...process.env, ...metadata.env }, windowsHide: true, encoding: 'utf8', timeout });
      metadata.runs.push({ round, variant, args, wallMs: Date.now() - runStart, exitCode: result.status, error: result.error?.message ?? null });
      appendFileSync(files[variant], (result.stdout ?? '').split(/\r?\n/).map(line => line.trimEnd()).join('\n'));
      persist();
      if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? 'Benchmark failed');
      assert.match(result.stdout, /^Benchmark\S+\s+\d+\s+/m, 'No benchmark matched the requested filter');
    }
    console.log(`${label}: pair ${round + 1}/${metadata.rounds}`);
  }
  metadata.status = 'complete';
} catch (error) {
  metadata.status = 'failed'; metadata.error = error.message; throw error;
} finally {
  metadata.wallMs = Date.now() - started;
  persist();
}
