import { performance } from 'node:perf_hooks';
import {
  inspectRpgDiceNotation,
  normalizeRpgDiceNotation,
  rollRpgDice,
  verifyRpgDiceNotation,
} from '../lib/esm/index.js';

const cases = [
  {
    name: 'normalize-simple',
    iterations: 25_000,
    run: () => normalizeRpgDiceNotation(' 2d + f + 4d6km + 1d6ei6 '),
  },
  {
    name: 'inspect-simple',
    iterations: 10_000,
    run: () => inspectRpgDiceNotation('2d6+3'),
  },
  {
    name: 'verify-simple',
    iterations: 10_000,
    run: () => verifyRpgDiceNotation('1d20'),
  },
  {
    name: 'roll-simple',
    iterations: 5_000,
    run: () => rollRpgDice('2d6+3', { seed: 'bench-simple' }),
  },
  {
    name: 'roll-multi',
    iterations: 2_000,
    run: () => rollRpgDice('3#2d6+3', { seed: 'bench-multi' }),
  },
  {
    name: 'blocked-explode',
    iterations: 5_000,
    run: () => inspectRpgDiceNotation('1d6!', { maxDice: 1000 }),
  },
  {
    name: 'pool-successes',
    iterations: 5_000,
    run: () => rollRpgDice('5d10>=8f=1', { seed: 'bench-pool' }),
  },
];

const results = cases.map((bench) => {
  const start = performance.now();

  for (let index = 0; index < bench.iterations; index += 1) {
    bench.run();
  }

  const durationMs = performance.now() - start;

  return {
    name: bench.name,
    iterations: bench.iterations,
    durationMs: Number(durationMs.toFixed(2)),
    opsPerSecond: Math.round((bench.iterations / durationMs) * 1000),
  };
});

console.table(results);
