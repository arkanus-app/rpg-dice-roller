/** Summarize saved, alternating baseline/winner samples; does not run benchmarks. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../go/benchmarks/optimization/', import.meta.url));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const variants = {};
for (const variant of ['baseline', 'winner']) {
  const cases = {};
  for (let sample = 1; sample <= 5; sample++) {
    const file = `combined-${variant}-${sample}.txt`;
    const text = readFileSync(directory + file, 'utf8');
    assert.match(text, /\bPASS\b/, `Unsuccessful benchmark: ${file}`);
    let count = 0;
    for (const match of text.matchAll(/^BenchmarkBackendOperation\/(.+)-\d+\s+(\d+)\s+([\d.]+) ns\/op\s+(\d+) B\/op\s+(\d+) allocs\/op/gm)) {
      const [, name, iterations, ns, bytes, allocations] = match;
      (cases[name] ??= []).push({ sample, iterations: Number(iterations), ns: Number(ns), bytes: Number(bytes), allocations: Number(allocations), file });
      count++;
    }
    assert.equal(count, 18, `Missing workloads: ${file}`);
  }
  variants[variant] = Object.fromEntries(Object.entries(cases).map(([name, samples]) => {
    assert.equal(samples.length, 5);
    return [name, { medianNs: median(samples.map(x => x.ns)), medianBytes: median(samples.map(x => x.bytes)), medianAllocations: median(samples.map(x => x.allocations)), samples }];
  }));
}
assert.deepEqual(Object.keys(variants.baseline), Object.keys(variants.winner));
const summary = Object.keys(variants.baseline).map(name => {
  const before = variants.baseline[name], after = variants.winner[name];
  return { name, before, after, speedup: before.medianNs / after.medianNs, timeReductionPercent: 100 * (1 - after.medianNs / before.medianNs), allocatedByteReductionPercent: 100 * (1 - after.medianBytes / before.medianBytes) };
});
// Provenance below records this saved experiment. This summarizer verifies log
// completeness and recalculates metrics; it does not re-run correctness gates
// or hash local binaries. New measurements need their own provenance record.
const result = {
  baselineCommit: '62de50293b2e22121f8ae3832f303da973e24934',
  measuredBinarySha256: {
    baseline: 'a292d575b90cc8eb631e609f5fb1a424da0b663969ff72082a1c8a02d70bff7a',
    winner: 'd2816cfc996f868cebbe48d3411a0680c72a8dbde6794120a86a7b4ed63dc59e',
  },
  method: 'Five alternating pairs: baseline/winner, winner/baseline, baseline/winner, winner/baseline, baseline/winner. Each sample runs the same BenchmarkBackendOperation with -test.benchtime=100ms -test.count=1. Go 1.26.2 windows/amd64; Ryzen 5 5500, default GOMAXPROCS=12. Setup outside timer, public results escape; cache warm; fixed seed or 128 alternating seeds. No competing benchmark processes.',
  correctness: { coveredStatements: 4151, totalStatements: 4151, race: 'passed', fixtures: 'all six TypeScript fixture generators --check passed' },
  summary,
};
writeFileSync(directory + 'combined.json', JSON.stringify(result, null, 2) + '\n');
for (const row of summary) console.log(`${row.name}: ${(row.before.medianNs / 1000).toFixed(2)} -> ${(row.after.medianNs / 1000).toFixed(2)} us; ${row.speedup.toFixed(2)}x; ${row.before.medianBytes} -> ${row.after.medianBytes} B; ${row.before.medianAllocations} -> ${row.after.medianAllocations} allocs`);
