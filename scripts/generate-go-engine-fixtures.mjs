import { readFileSync, writeFileSync } from 'node:fs';
import { createDiceEngine } from '../dist/core.js';

const cases = [];
const add = (name, options, operations) => cases.push({ name, options, operations });
const seed = 'engine-cross-language';
add('cache-lifecycle', {}, [
  { method: 'compile', input: '2d6+1', save: 'plan' },
  { method: 'compile', input: '2d6+1' },
  { method: 'compile', input: '2d6+1 [damage]' },
  { method: 'inspect', input: '2d6+1' },
  { method: 'verify', input: '1d6' },
  { method: 'verify', input: 'invalid' },
  { method: 'normalize', input: 'd20ADV [attack]' },
  { method: 'roll', plan: 'plan', options: { seed } },
  { method: 'rollDetails', plan: 'plan', options: { seed } },
  { method: 'rollSummary', plan: 'plan', options: { seed } },
  { method: 'clearCache' },
]);
for (const cache of [false, { maxInputEntries: 0 }, { maxProgramEntries: 0 }, { maxProgramNodes: 0 },
  { maxInputEntries: 1, maxProgramEntries: 1, maxProgramNodes: 10 }]) {
  add(`cache-policy-${cases.length}`, { cache }, [
    { method: 'compile', input: '1d6' }, { method: 'compile', input: '2d8' },
    { method: 'compile', input: '1d6' }, { method: 'compile', input: '1+2+3+4+5+6' },
    { method: 'clearCache' },
  ]);
}
add('limits-cache-and-inspection', { limits: { maxInitialDice: 8, maxInputLength: 32 } }, [
  { method: 'compile', input: '4d6', save: 'plan' },
  { method: 'compile', input: '4d6', options: { limits: { maxInitialDice: 2 } } },
  { method: 'roll', plan: 'plan', options: { seed, limits: { maxInitialDice: 2 } } },
  { method: 'inspect', input: 'd'.repeat(33) },
  { method: 'inspect', input: '4d6', options: { limits: { maxInitialDice: 9 } } },
  { method: 'inspect', input: 'bad [note]' },
  { method: 'roll', input: '2#1d6', options: { seed, limits: { maxRolls: 1 } } },
]);
for (const freezeResults of ['always', 'never', 'development']) {
  add(`freeze-${freezeResults}`, { freezeResults, randomAlgorithm: 'xoshiro128ss' }, [
    { method: 'roll', input: '3d6!2kh2+1', options: { seed }, saveReplay: 'replay' },
    { method: 'roll', input: '3d6!2kh2+1', replay: 'replay' },
    { method: 'rollDetails', input: '3d6!2kh2+1', replay: 'replay' },
    { method: 'rollSummary', input: '3d6!2kh2+1', replay: 'replay' },
    { method: 'roll', input: '3d6!2kh2+1', options: { seed, randomAlgorithm: 'mt19937' } },
  ]);
}
add('external-plan-envelopes', {}, [
  { method: 'compile', input: '2d6+3', save: 'plan' },
  { method: 'roll', plan: 'plan', clone: true, options: { seed } },
  { method: 'roll', plan: 'plan', clone: true, patch: { rollCount: 999, notation: '99d99' }, options: { seed } },
  ...[{ type: 'invalid' }, { schemaVersion: 2 }, { compilerVersion: 2 }, { input: 42 },
    { input: null }, { planFingerprint: null }, { planFingerprint: 'INVALID' },
    { planFingerprint: '0'.repeat(32) }, { input: '4d6+1' }, { input: 'bad' }]
    .map((patch) => ({ method: 'roll', plan: 'plan', clone: true, patch, options: { seed } })),
  ...[null, false, 4, [], {}].map((input) => ({ method: 'roll', input, options: { seed } })),
]);
add('runtime-invalid-options', {}, [
  ...['roll', 'rollDetails', 'rollSummary'].flatMap((method) => [
    { method, input: '1d6', options: { randomAlgorithm: 'bad' } },
    { method, input: '1d6', options: { seed: {} } },
    { method, input: '1d6', options: { seed, replay: {} } },
    { method, input: '1d6', options: { randomAlgorithm: 'mt19937', replay: {} } },
    { method, input: '1d6', options: { limits: { maxSides: 1 } } },
  ]),
]);
for (const options of [
  { freezeResults: 'bad' }, { randomAlgorithm: 'bad' }, { limits: { maxRolls: 0 } },
  { cache: true }, { cache: 'bad' }, { cache: [] },
  ...['maxInputEntries', 'maxProgramEntries', 'maxProgramNodes'].flatMap((key) =>
    [{ cache: { [key]: -1 } }, { cache: { [key]: Number.MAX_SAFE_INTEGER + 1 } }]),
]) add(`invalid-engine-${cases.length}`, options, []);

function capture(run) {
  try { return { value: JSON.parse(JSON.stringify(run() ?? null)) }; }
  catch (error) { return { error: typeof error?.toJSON === 'function' ? error.toJSON() : { name: error.name, message: error.message } }; }
}

for (const entry of cases) {
  let engine;
  entry.outcome = capture(() => { engine = createDiceEngine(entry.options); return engine.limits; });
  if (!engine) continue;
  const saved = new Map();
  for (const operation of entry.operations) {
    let input = operation.plan ? saved.get(operation.plan) : operation.input;
    if (operation.clone) input = { ...JSON.parse(JSON.stringify(input)), ...operation.patch };
    const options = { ...operation.options };
    if (operation.replay) options.replay = saved.get(operation.replay);
    operation.outcome = capture(() => {
      const result = engine[operation.method](input, options);
      if (operation.save) saved.set(operation.save, result);
      if (operation.saveReplay) saved.set(operation.saveReplay, result.replay);
      return result;
    });
    operation.stats = engine.getCacheStats();
  }
}
const result = `${JSON.stringify({ schemaVersion: 1, provenance: { package: '@erpg/dicecore', version: '3.7.1', commit: '1940044' }, cases }, null, 2)}\n`;
const path = new URL('../go/testdata/engine.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== result) throw new Error('Engine oracle differs');
} else writeFileSync(path, result);
process.stdout.write(`Engine oracle: ${cases.length} scenarios, ${cases.reduce((n, c) => n + c.operations.length, 0)} operations.\n`);
