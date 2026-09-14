/** Serial A/B measurements of preserved executables; profiles and builds excluded. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const [before, after, label, filter = '^BenchmarkRollJSON$'] = process.argv.slice(2);
assert.ok(before && after && /^[a-z0-9-]+$/.test(label), 'Usage: before.exe after.exe label [filter]');
const directory = path.resolve('go/benchmarks/optimization-round6');
mkdirSync(directory, { recursive: true });
const variants = { before: path.resolve(before), after: path.resolve(after) };
const hash = value => createHash('sha256').update(value).digest('hex');
const files = Object.fromEntries(Object.keys(variants).map(key => [key, path.join(directory, `${label}-${key}.txt`)]));
for (const file of Object.values(files)) writeFileSync(file, '');
const started = Date.now(), budgetMs = 120000;
const metadata = { status: 'running', label, startedAt: new Date(started).toISOString(), budgetMs, filter, rounds: 10,
  cpu: os.cpus()[0].model, os: os.version(), arch: process.arch,
  invocation: process.argv.slice(1), env: { GOMAXPROCS: '1', GOGC: '100', GOMEMLIMIT: 'off', DICECORE_JSON_ENCODER: 'direct' },
  binaries: Object.fromEntries(Object.entries(variants).map(([key, file]) => [key, { file, sha256: hash(readFileSync(file)) }])),
  order: [], runs: [], methodology: 'Same benchmark and direct JSON encoder; only preserved implementation binary changes. Results escape. No startup or setup in b.Loop.' };
const persist = () => writeFileSync(path.join(directory, `${label}.json`), JSON.stringify(metadata, null, 2) + '\n');
persist();
try {
  for (let round = 0; round < metadata.rounds; round++) {
    const order = round % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
    metadata.order.push(order);
    for (const variant of order) {
      const timeout = started + budgetMs - Date.now();
      assert.ok(timeout > 0, '120-second budget exhausted');
      const env = { ...process.env };
      for (const name of Object.keys(env)) if (Object.keys(metadata.env).includes(name.toUpperCase())) delete env[name];
      Object.assign(env, metadata.env);
      const args = ['-test.run=^$', `-test.bench=${filter}`, '-test.benchtime=100ms', '-test.count=1', '-test.benchmem'];
      const runStarted = Date.now();
      const run = spawnSync(variants[variant], args, { env, cwd: path.resolve('go'), windowsHide: true, encoding: 'utf8', timeout });
      const stdout = (run.stdout ?? '').split(/\r?\n/).map(line => line.trimEnd()).join('\n').trimEnd() + '\n';
      appendFileSync(files[variant], stdout);
      metadata.runs.push({ variant, round, args, wallMs: Date.now() - runStarted, stdoutSha256: hash(stdout), stderr: run.stderr, status: run.status, error: run.error?.message ?? null });
      persist();
      if (run.error || run.status !== 0) throw new Error(run.error?.message ?? run.stderr ?? 'Microbenchmark failed');
      assert.match(stdout, /^Benchmark\S+\s+\d+\s+/m, 'No benchmark matched');
      assert.equal(hash(readFileSync(variants[variant])), metadata.binaries[variant].sha256, 'Executable changed');
    }
    console.log(`${label}: pair ${round + 1}/10`);
  }
  metadata.status = 'complete';
} catch (error) {
  metadata.status = 'failed'; metadata.error = error.message; throw error;
} finally {
  metadata.wallMs = Date.now() - started;
  metadata.outputs = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, { file, sha256: hash(readFileSync(file)) }]));
  persist();
}
