// Run after npm run build: node --expose-gc --import tsx scripts/investigate-performance.ts
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DiceEngine, DiceEngineOptions } from '../src/v3/types.js';

const { createDiceEngine }: {
  createDiceEngine(options?: DiceEngineOptions): DiceEngine;
} = await import(new URL('../dist/core.js', import.meta.url).href);
// Optional first argument: an independently built baseline dist/core.js.
const comparePath = process.argv[2];
let checksum = 0;

interface BenchmarkCase {
  readonly name: string;
  readonly iterations: number;
  readonly run: () => { readonly total: number };
  readonly durations: number[];
}

function createCases(factory: typeof createDiceEngine): BenchmarkCase[] {
  const engine = factory();
  const xoshiro = factory({ randomAlgorithm: 'xoshiro128ss' });
  const seed = { seed: 123456 };
  const simple = engine.compile('1d20');
  const replay = { replay: engine.roll(simple, seed).replay };
  let sequence = 0;
  const cases: BenchmarkCase[] = [];
  function add(name: string, iterations: number, run: BenchmarkCase['run']): void {
    cases.push({ name, iterations, run, durations: [] });
  }
  for (const [name, selectedEngine] of [['mt', engine], ['xoshiro', xoshiro]] as const) {
    const plan = selectedEngine.compile('1d20');
    add(`${name}-summary-plan-fixed`, 10000, () => selectedEngine.rollSummary(plan, seed));
    add(`${name}-summary-string-fixed`, 10000, () => selectedEngine.rollSummary('1d20', seed));
    add(`${name}-summary-plan-changing`, 10000, () => selectedEngine.rollSummary(plan, { seed: ++sequence }));
    add(`${name}-summary-plan-auto`, 5000, () => selectedEngine.rollSummary(plan));
  }
  add('mt-summary-plan-replay', 10000, () => engine.rollSummary(simple, replay));
  for (const notation of ['10000d20', '10000d20kh1', '10000d20kh5000', '10000d20>=10']) {
    const plan = engine.compile(notation);
    const full = engine.roll(plan, seed);
    const summary = engine.rollSummary(plan, seed);
    const details = engine.rollDetails(plan, seed);
    for (const result of [summary, details]) {
      assert.equal(result.total, full.total);
      assert.deepEqual(result.stats, full.stats);
      assert.deepEqual(result.pool, full.pool);
      assert.deepEqual(result.replay, full.replay);
    }
    for (const [mode, method] of [['full', 'roll'], ['details', 'rollDetails'], ['summary', 'rollSummary']] as const) {
      add(`${notation}-${mode}`, comparePath === undefined ? 100 : 25, () => engine[method](plan, seed));
    }
  }
  return cases;
}

const cases = createCases(createDiceEngine);
const baselineApi: { createDiceEngine: typeof createDiceEngine } | undefined = comparePath === undefined
  ? undefined : await import(pathToFileURL(resolve(comparePath)).href);
const baselineCases = baselineApi === undefined ? [] : createCases(baselineApi.createDiceEngine);
const baselineByName = new Map(baselineCases.map((benchmark) => [benchmark.name, benchmark]));
function run(benchmark: BenchmarkCase, iterations: number): number {
  const start = performance.now();
  for (let index = 0; index < iterations; index++) checksum += benchmark.run().total;
  return performance.now() - start;
}
for (const benchmark of [...cases, ...baselineCases]) run(benchmark, Math.max(20, benchmark.iterations / 5));
for (let sample = 0; sample < 7; sample++) {
  const ordered = sample % 2 === 0 ? cases : [...cases].reverse();
  for (const benchmark of ordered) {
    const baseline = baselineByName.get(benchmark.name);
    const pair = baseline === undefined ? [benchmark]
      : sample % 2 === 0 ? [baseline, benchmark] : [benchmark, baseline];
    for (const entry of pair) {
      globalThis.gc?.();
      entry.durations.push(run(entry, entry.iterations));
    }
  }
}
const results = cases.map(({ name, iterations, durations }) => {
  const sorted = [...durations].sort((left, right) => left - right);
  const median = sorted[3];
  if (median === undefined) throw new Error('Missing benchmark samples');
  return {
    name,
    iterations,
    samples: durations.length,
    medianUsPerRoll: median * 1000 / iterations,
    medianOpsPerSecond: iterations * 1000 / median,
    durationsMs: durations,
    ...(baselineByName.has(name) ? {
      baselineDurationsMs: baselineByName.get(name)?.durations,
      medianPairedSpeedup: [...durations.map((duration, index) => (
        (baselineByName.get(name)?.durations[index] ?? duration) / duration
      ))].sort((left, right) => left - right)[3],
    } : {}),
  };
});
process.stdout.write(`${JSON.stringify({
  runtime: { node: process.version, platform: process.platform, cpu: cpus()[0]?.model },
  correctness: 'total, stats, pool and replay matched across all three result modes for each large-pool case',
  checksum,
  results,
}, null, 2)}\n`);
