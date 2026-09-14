/** One binary, serial alternating std/direct encoding measurements; no compilation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const [current, ...extra] = process.argv.slice(2);
assert.ok(current && extra.length === 0, 'Usage: node scripts/compare-go-round5-micro.mjs current.exe');
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'go/benchmarks/optimization-round5');
mkdirSync(directory, { recursive: true });
const started = Date.now(), budgetMs = 120000;
const binary = path.resolve(current), label = 'v1-encoder', filter = '^BenchmarkRollJSON$';
const variants = { before: 'std', after: 'direct' };
const files = Object.fromEntries(Object.keys(variants).map(key => [key, path.join(directory, `${label}-${key}.txt`)]));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function snapshot() {
  const names = readdirSync(path.join(root, 'go')).filter(name => name.endsWith('.go') || name === 'go.mod' || name === 'go.sum')
    .map(name => `go/${name}`);
  names.push('scripts/compare-go-round5-micro.mjs');
  const files = names.sort().map(file => ({ path: file, sha256: hash(readFileSync(path.join(root, file))) }));
  return { sha256: hash(JSON.stringify(files)), files };
}
const metadata = {
  status: 'running', label, startedAt: new Date(started).toISOString(), budgetMs, rounds: 10, order: [], filter,
  invocation: { executable: process.execPath, args: ['scripts/compare-go-round5-micro.mjs', ...process.argv.slice(2)] },
  cpu: os.cpus()[0].model.trim(), os: os.version(), arch: process.arch, logicalCPUs: os.cpus().length,
  env: { GOMAXPROCS: '1', GOGC: '100', GOMEMLIMIT: 'off' },
  inheritedEnvironment: Object.fromEntries(['GOMAXPROCS', 'GOGC', 'GOMEMLIMIT', 'DICECORE_JSON_ENCODER', 'GODEBUG', 'GOEXPERIMENT', 'GOFLAGS']
    .map(key => [key, process.env[key] ?? null])),
  variants, binary: { file: binary, sha256: hash(readFileSync(binary)) }, source: snapshot(), runs: [],
  methodology: {
    operation: 'encoding-only', benchtime: '100ms', samplesPerCasePerEncoder: 10, ownedBytes: true,
    preparedResultSeed: 'event-json-throughput', preparedResultAlgorithm: 'mt19937',
    workloadOrder: ['d20', '100d6', 'pool'], modeOrder: ['summary', 'details', 'full'],
    note: 'Each fresh process uses the same binary and benchmark function; only DICECORE_JSON_ENCODER changes. Rolling and stdlib byte equality run before b.Loop.',
  },
};
const persist = () => writeFileSync(path.join(directory, `${label}.json`), JSON.stringify(metadata, null, 2) + '\n');
function environment(encoder) {
  const env = { ...process.env };
  // Windows environment variable names are case-insensitive.
  for (const key of Object.keys(env)) {
    if (['GOMAXPROCS', 'GOGC', 'GOMEMLIMIT', 'DICECORE_JSON_ENCODER'].includes(key.toUpperCase())) delete env[key];
  }
  return { ...env, ...metadata.env, DICECORE_JSON_ENCODER: encoder };
}
function matchedCases(output) {
  const cases = [...output.matchAll(/^BenchmarkRollJSON\/(d20|100d6|pool)\/(summary|details|full)(?:-\d+)?\s+\d+\s+/gm)]
    .map(match => `${match[1]}/${match[2]}`).sort();
  const expected = metadata.methodology.workloadOrder.flatMap(workload => metadata.methodology.modeOrder.map(mode => `${workload}/${mode}`)).sort();
  assert.deepEqual(cases, expected, 'Expected exactly the nine JSON encoding benchmarks');
  return cases;
}
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
      const runStart = Date.now(), encoder = variants[variant];
      const result = spawnSync(binary, args, {
        cwd: path.join(root, 'go'), env: environment(encoder), windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024,
      });
      const stdout = (result.stdout ?? '').split(/\r?\n/).map(line => line.trimEnd()).join('\n').trimEnd() + '\n';
      const run = {
        round, variant, encoder, args, wallMs: Date.now() - runStart, exitCode: result.status,
        error: result.error?.message ?? null, stderr: result.stderr ?? '', stdoutSha256: hash(stdout),
      };
      metadata.runs.push(run);
      appendFileSync(files[variant], stdout);
      persist();
      if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? 'Benchmark failed');
      run.cases = matchedCases(stdout);
      assert.equal(hash(readFileSync(binary)), metadata.binary.sha256, 'Current executable changed during measurements');
      assert.equal(snapshot().sha256, metadata.source.sha256, 'Source changed during measurements');
      persist();
    }
    console.log(`${label}: pair ${round + 1}/${metadata.rounds}`);
  }
  assert.ok(Date.now() <= started + budgetMs, 'Microbenchmark wall-clock budget exhausted');
  metadata.status = 'complete';
} catch (error) {
  metadata.status = 'failed'; metadata.error = error.message; throw error;
} finally {
  metadata.wallMs = Date.now() - started;
  metadata.finishedAt = new Date().toISOString();
  metadata.outputs = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, { file, sha256: hash(readFileSync(file)) }]));
  persist();
}
