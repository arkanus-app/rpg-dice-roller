import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_COUNT = 5;
const REGRESSION_TOLERANCE = 0.15;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gateFailures: string[] = [];

interface BenchmarkRollResult extends Readonly<Record<string, unknown>> {
  readonly total: number;
}

interface BenchmarkEngine {
  clearCache(): void;
  compile(input: string): object;
  roll(input: string | object, options?: object): BenchmarkRollResult;
  rollSummary(input: string | object, options?: object): BenchmarkRollResult;
}

interface BenchmarkApi {
  createDiceEngine(options?: object): BenchmarkEngine;
  rollRpgDice(input: string | object, options?: object): BenchmarkRollResult;
  rollRpgDiceSummary(input: string | object, options?: object): BenchmarkRollResult;
}

interface BenchmarkCase {
  readonly iterations: number;
  readonly name: string;
  readonly run: () => unknown;
}

interface BenchmarkMeasurement {
  readonly heapDeltaBytes: number;
  readonly iterations: number;
  readonly medianDurationMs: number;
  readonly medianOpsPerSecond: number;
  readonly name: string;
  readonly p95DurationMs: number;
  readonly samples: number;
}

interface RelativeMeasurement {
  readonly denominator: string;
  readonly medianDurationRatio: number;
  readonly name: string;
  readonly numerator: string;
  readonly samples: number;
}

interface BenchmarkBaselineEntry {
  readonly referenceMedianOpsPerSecond: number;
}

interface BenchmarkBaseline {
  readonly benchmarks: Readonly<Record<string, BenchmarkBaselineEntry>>;
  readonly nodeMajor: number;
  readonly platform: 'linux';
  readonly schemaVersion: 1;
  readonly tolerancePercent: 15;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFunction(value: unknown): value is (...arguments_: readonly unknown[]) => unknown {
  return typeof value === 'function';
}

function loadApi(value: unknown): BenchmarkApi {
  if (
    !isObject(value)
    || !isFunction(value['createDiceEngine'])
    || !isFunction(value['rollRpgDice'])
    || !isFunction(value['rollRpgDiceSummary'])
  ) {
    throw new TypeError('dist does not expose the V3 benchmark API');
  }

  const createDiceEngine = value['createDiceEngine'];
  const rollRpgDice = value['rollRpgDice'];
  const rollRpgDiceSummary = value['rollRpgDiceSummary'];

  return {
    createDiceEngine(options) {
      const engine: unknown = createDiceEngine(options);
      if (
        !isObject(engine)
        || !isFunction(engine['clearCache'])
        || !isFunction(engine['compile'])
        || !isFunction(engine['roll'])
        || !isFunction(engine['rollSummary'])
      ) {
        throw new TypeError('createDiceEngine returned an invalid V3 engine');
      }
      const clearCache = engine['clearCache'];
      const compile = engine['compile'];
      const roll = engine['roll'];
      const rollSummary = engine['rollSummary'];
      return {
        clearCache: () => {
          clearCache.call(engine);
        },
        compile: (input) => {
          const plan: unknown = compile.call(engine, input);
          if (!isObject(plan)) {
            throw new TypeError('compile returned an invalid plan');
          }
          return plan;
        },
        roll: (input, options) => readRollResult(roll.call(engine, input, options)),
        rollSummary: (input, options) => readRollResult(
          rollSummary.call(engine, input, options),
        ),
      };
    },
    rollRpgDice: (input, options) => readRollResult(rollRpgDice(input, options)),
    rollRpgDiceSummary: (input, options) => readRollResult(
      rollRpgDiceSummary(input, options),
    ),
  };
}

function isBenchmarkRollResult(value: unknown): value is BenchmarkRollResult {
  return isObject(value) && typeof value['total'] === 'number';
}

function readRollResult(value: unknown): BenchmarkRollResult {
  if (!isBenchmarkRollResult(value)) {
    throw new TypeError('roll returned an invalid result');
  }
  return value;
}

function readBaseline(value: unknown): BenchmarkBaseline {
  if (
    !isObject(value)
    || value['schemaVersion'] !== 1
    || value['platform'] !== 'linux'
    || value['nodeMajor'] !== 22
    || value['tolerancePercent'] !== 15
    || !isObject(value['benchmarks'])
  ) {
    throw new TypeError('Benchmark baseline has an invalid schema');
  }

  const benchmarks: Record<string, BenchmarkBaselineEntry> = {};
  for (const [name, entry] of Object.entries(value['benchmarks'])) {
    if (
      !isObject(entry)
      || typeof entry['referenceMedianOpsPerSecond'] !== 'number'
      || !Number.isFinite(entry['referenceMedianOpsPerSecond'])
      || entry['referenceMedianOpsPerSecond'] <= 0
    ) {
      throw new TypeError(`Benchmark baseline entry ${name} is invalid`);
    }
    benchmarks[name] = {
      referenceMedianOpsPerSecond: entry['referenceMedianOpsPerSecond'],
    };
  }

  return {
    benchmarks,
    nodeMajor: 22,
    platform: 'linux',
    schemaVersion: 1,
    tolerancePercent: 15,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) {
    throw new RangeError('Cannot calculate the median of an empty sample');
  }
  return value;
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const value = sorted[index];
  if (value === undefined) {
    throw new RangeError('Cannot calculate p95 of an empty sample');
  }
  return value;
}

function runIterations(benchmark: BenchmarkCase, iterations: number): void {
  for (let index = 0; index < iterations; index += 1) {
    benchmark.run();
  }
}

function collectGarbage(): void {
  const collector: unknown = Reflect.get(globalThis, 'gc');
  if (isFunction(collector)) {
    collector();
  }
}

function measure(benchmark: BenchmarkCase): BenchmarkMeasurement {
  const warmupIterations = Math.max(3, Math.ceil(benchmark.iterations / 10));
  runIterations(benchmark, warmupIterations);

  const durations: number[] = [];
  const heapDeltas: number[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    collectGarbage();
    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    runIterations(benchmark, benchmark.iterations);
    durations.push(performance.now() - startedAt);
    heapDeltas.push(Math.max(0, process.memoryUsage().heapUsed - heapBefore));
  }

  const medianDurationMs = median(durations);
  return {
    heapDeltaBytes: Math.round(median(heapDeltas)),
    iterations: benchmark.iterations,
    medianDurationMs: Number(medianDurationMs.toFixed(3)),
    medianOpsPerSecond: Math.round((benchmark.iterations / medianDurationMs) * 1_000),
    name: benchmark.name,
    p95DurationMs: Number(percentile95(durations).toFixed(3)),
    samples: SAMPLE_COUNT,
  };
}

function measureDuration(benchmark: BenchmarkCase, iterations = benchmark.iterations): number {
  const startedAt = performance.now();
  runIterations(benchmark, iterations);
  return performance.now() - startedAt;
}

function blockIterations(total: number, block: number, blockCount: number): number {
  const base = Math.floor(total / blockCount);
  return base + (block < total % blockCount ? 1 : 0);
}

function measureRelativeDuration(
  name: string,
  numerator: BenchmarkCase,
  denominator: BenchmarkCase,
): RelativeMeasurement {
  const numeratorWarmup = Math.max(3, Math.ceil(numerator.iterations / 10));
  const denominatorWarmup = Math.max(3, Math.ceil(denominator.iterations / 10));
  runIterations(numerator, numeratorWarmup);
  runIterations(denominator, denominatorWarmup);

  const ratios: number[] = [];
  const blockCount = 5;
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    collectGarbage();
    let numeratorDuration = 0;
    let denominatorDuration = 0;
    for (let block = 0; block < blockCount; block += 1) {
      const numeratorIterations = blockIterations(
        numerator.iterations,
        block,
        blockCount,
      );
      const denominatorIterations = blockIterations(
        denominator.iterations,
        block,
        blockCount,
      );
      if ((sample + block) % 2 === 0) {
        numeratorDuration += measureDuration(numerator, numeratorIterations);
        denominatorDuration += measureDuration(denominator, denominatorIterations);
      } else {
        denominatorDuration += measureDuration(denominator, denominatorIterations);
        numeratorDuration += measureDuration(numerator, numeratorIterations);
      }
    }
    ratios.push(
      (numeratorDuration / numerator.iterations)
      / (denominatorDuration / denominator.iterations),
    );
  }

  return {
    denominator: denominator.name,
    medianDurationRatio: Number(median(ratios).toFixed(3)),
    name,
    numerator: numerator.name,
    samples: SAMPLE_COUNT,
  };
}

function requireFailure(run: () => unknown): void {
  try {
    run();
  } catch {
    return;
  }
  throw new Error('Expected operation to fail');
}

function assertAtMost(actual: number, maximum: number, message: string): void {
  if (actual > maximum) {
    gateFailures.push(`${message}: ${actual.toFixed(3)} > ${maximum.toFixed(3)}`);
  }
}

function assertAtLeast(actual: number, minimum: number, message: string): void {
  if (actual < minimum) {
    gateFailures.push(`${message}: ${actual.toFixed(3)} < ${minimum.toFixed(3)}`);
  }
}

const distModule: unknown = await import(new URL('../dist/index.js', import.meta.url).href);
const api = loadApi(distModule);
const coldEngine = api.createDiceEngine();
const hotEngine = api.createDiceEngine();
const hotPlan = hotEngine.compile('2d6+3');
let mtSeedSequence = 0;
let xoshiroSeedSequence = 0;

const cases: readonly BenchmarkCase[] = [
  {
    name: 'cold-compile',
    iterations: 4_000,
    run: () => {
      coldEngine.clearCache();
      return coldEngine.compile('20d20kh10+ceil(1d6/2)');
    },
  },
  {
    name: 'hot-plan-mt19937',
    iterations: 20_000,
    run: () => hotEngine.roll(hotPlan, { seed: 123_456 }),
  },
  {
    name: 'hot-string-mt19937',
    iterations: 20_000,
    run: () => hotEngine.roll('2d6+3', { seed: 123_456 }),
  },
  {
    name: 'full-simple-mt19937',
    iterations: 20_000,
    run: () => api.rollRpgDice('1d20', { seed: 123_456 }),
  },
  {
    name: 'full-simple-xoshiro128ss',
    iterations: 20_000,
    run: () => api.rollRpgDice('1d20', {
      randomAlgorithm: 'xoshiro128ss',
      seed: 123_456,
    }),
  },
  {
    name: 'summary-simple-mt19937',
    iterations: 20_000,
    run: () => api.rollRpgDiceSummary('1d20', { seed: 123_456 }),
  },
  {
    name: 'rng-summary-10-mt19937',
    iterations: 20_000,
    run: () => {
      mtSeedSequence += 1;
      return api.rollRpgDiceSummary('10d20', { seed: mtSeedSequence });
    },
  },
  {
    name: 'rng-summary-10-xoshiro128ss',
    iterations: 20_000,
    run: () => {
      xoshiroSeedSequence += 1;
      return api.rollRpgDiceSummary('10d20', {
        randomAlgorithm: 'xoshiro128ss',
        seed: xoshiroSeedSequence,
      });
    },
  },
  {
    name: 'full-modifiers',
    iterations: 1_000,
    run: () => api.rollRpgDice('100d1000ukh50sa', { seed: 'benchmark-modifiers' }),
  },
  {
    name: 'early-failure',
    iterations: 10_000,
    run: () => requireFailure(() => api.rollRpgDice('1d1!', { seed: 1 })),
  },
  {
    name: 'multi-100x100',
    iterations: 25,
    run: () => api.rollRpgDice('100#100d20', { seed: 123_456 }),
  },
  {
    name: 'flat-10000',
    iterations: 25,
    run: () => api.rollRpgDice('10000d20', { seed: 123_456 }),
  },
  {
    name: 'unique-200',
    iterations: 100,
    run: () => api.rollRpgDice('200d1000u', { seed: 123_456 }),
  },
  {
    name: 'unique-400',
    iterations: 100,
    run: () => api.rollRpgDice('400d1000u', { seed: 123_456 }),
  },
];

const results = cases.map(measure);
const byName = new Map(results.map((result) => [result.name, result]));
const casesByName = new Map(cases.map((benchmark) => [benchmark.name, benchmark]));

function requiredResult(name: string): BenchmarkMeasurement {
  const result = byName.get(name);
  if (result === undefined) {
    throw new Error(`Missing benchmark result: ${name}`);
  }
  return result;
}

function requiredCase(name: string): BenchmarkCase {
  const benchmark = casesByName.get(name);
  if (benchmark === undefined) {
    throw new Error(`Missing benchmark case: ${name}`);
  }
  return benchmark;
}

const planToString = measureRelativeDuration(
  'known-plan-to-cached-string',
  requiredCase('hot-plan-mt19937'),
  requiredCase('hot-string-mt19937'),
);
const mtToXoshiro = measureRelativeDuration(
  'mt19937-to-xoshiro128ss-rng-workload',
  requiredCase('rng-summary-10-mt19937'),
  requiredCase('rng-summary-10-xoshiro128ss'),
);
const multiToFlat = measureRelativeDuration(
  'multi-100x100-to-flat-10000',
  requiredCase('multi-100x100'),
  requiredCase('flat-10000'),
);
const unique400To200 = measureRelativeDuration(
  'unique-400-to-unique-200',
  requiredCase('unique-400'),
  requiredCase('unique-200'),
);
const comparisons: readonly RelativeMeasurement[] = [
  planToString,
  mtToXoshiro,
  multiToFlat,
  unique400To200,
];

const mtResult = requiredResult('full-simple-mt19937');

assertAtLeast(mtResult.medianOpsPerSecond, 35_000, 'MT19937 simple roll throughput');
assertAtMost(
  planToString.medianDurationRatio,
  1.1,
  'Known RollPlan cost relative to a cached string',
);
assertAtLeast(
  mtToXoshiro.medianDurationRatio,
  1.3,
  'xoshiro128ss speedup over MT19937 on an RNG-dominant roll',
);
assertAtMost(
  multiToFlat.medianDurationRatio,
  2.5,
  '100#100d20 cost relative to 10000d20',
);
assertAtMost(
  unique400To200.medianDurationRatio,
  3,
  'unique scaling from 200 to 400 dice',
);

const fullLargeResult = api.rollRpgDice('10000d20', { seed: 123_456 });
const summaryLargeResult = api.rollRpgDiceSummary('10000d20', { seed: 123_456 });
const fullJsonBytes = Buffer.byteLength(JSON.stringify(fullLargeResult));
const summaryJsonBytes = Buffer.byteLength(JSON.stringify(summaryLargeResult));
const esmGzipBytes = gzipSync(readFileSync(resolve(root, 'dist/index.js'))).byteLength;

assertAtMost(fullJsonBytes, 5.5 * 1024 * 1024, 'Full 10,000-die JSON size');
assertAtMost(summaryJsonBytes, 50 * 1024, 'Summary 10,000-die JSON size');
assertAtMost(esmGzipBytes, 25 * 1024, 'ESM gzip size');

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
const shouldCompareBaseline = process.argv.includes('--check')
  && process.platform === 'linux'
  && nodeMajor === 22;

if (shouldCompareBaseline) {
  const baseline = readBaseline(JSON.parse(readFileSync(
    resolve(root, 'scripts/benchmark-baseline.json'),
    'utf8',
  )) as unknown);

  for (const [name, entry] of Object.entries(baseline.benchmarks)) {
    const actual = requiredResult(name).medianOpsPerSecond;
    const minimum = entry.referenceMedianOpsPerSecond * (1 - REGRESSION_TOLERANCE);
    assertAtLeast(actual, minimum, `${name} regression against Linux/Node 22 baseline`);
  }
}

const report = {
  schemaVersion: 1,
  runtime: {
    baselineCompared: shouldCompareBaseline,
    node: process.version,
    platform: process.platform,
  },
  comparisons,
  results,
  sizes: {
    esmGzipBytes,
    full10000DiceJsonBytes: fullJsonBytes,
    summary10000DiceJsonBytes: summaryJsonBytes,
  },
  gateFailures,
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.table(results);
  console.table(report.sizes);
}

if (gateFailures.length > 0) {
  throw new Error(`Benchmark gates failed:\n- ${gateFailures.join('\n- ')}`);
}
