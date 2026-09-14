/** Isolated Node worker. Timed regions exclude module loading and JSON output. */
import { readFileSync } from 'node:fs';
import * as dicecore from '../dist/index.js';

const request = JSON.parse(readFileSync(0, 'utf8'));
const output = { runtime: process.version, phase: request.phase, cases: {} };
let sink;

function operation(workload) {
  const engine = dicecore.createDiceEngine({ cache: workload.cache ? undefined : false,
    randomAlgorithm: workload.algorithm, freezeResults: 'never' });
  const systems = dicecore.createSystemRoller(engine);
  const rollOptions = workload.seeds.map(seed => ({ seed, randomAlgorithm: workload.algorithm }));
  const systemOptions = rollOptions.map(options => ({ ...options, detail: workload.mode }));
  return index => {
    switch (workload.kind) {
      case 'normalize': return dicecore.normalizeRpgDiceNotation(workload.inputs[index % workload.inputs.length]);
      case 'compile': return engine.compile(workload.input);
      case 'roll': {
        const options = rollOptions[index % rollOptions.length];
        if (workload.mode === 'full') return engine.roll(workload.input, options);
        if (workload.mode === 'details') return engine.rollDetails(workload.input, options);
        if (workload.mode === 'summary') return engine.rollSummary(workload.input, options);
        break;
      }
      case 'fate': return systems.rollFateDice(workload.input, systemOptions[index % systemOptions.length]);
      case 'vampire-v5': return systems.rollVampireV5(workload.input, systemOptions[index % systemOptions.length]);
      case 'mixed': return systems.rollMixedDice(workload.input, systemOptions[index % systemOptions.length]);
    }
    throw new Error(`Unknown workload ${workload.id}`);
  };
}

for (const workload of request.workloads) {
  const run = operation(workload);
  if (request.phase === 'preflight') {
    output.cases[workload.id] = Array.from({ length: workload.validationCount }, (_, index) => run(index));
    continue;
  }
  const iterations = request.iterations[workload.id];
  if (!Number.isSafeInteger(iterations) || iterations < 1) throw new Error(`Missing iterations for ${workload.id}`);
  const warmup = Math.max(request.warmupFloor, Math.min(request.warmupCap, iterations));
  for (let index = 0; index < warmup; index++) sink = run(index);
  const started = process.hrtime.bigint();
  for (let index = 0; index < iterations; index++) sink = run(index);
  const durationNs = Number(process.hrtime.bigint() - started);
  output.cases[workload.id] = { iterations, warmupIterations: warmup, durationNs, nsPerOp: durationNs / iterations };
}
// Retain a dependency on the last result without serializing it during timing.
if (sink === Symbol.for('unreachable-comparison-result')) throw new Error('unreachable');
process.stdout.write(`DICECORE_BENCHMARK ${JSON.stringify(output)}\n`);
