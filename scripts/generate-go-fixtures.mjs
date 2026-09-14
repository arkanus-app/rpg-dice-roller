/**
 * TypeScript oracle for the staged Go port. Run after npm run build:
 *   node scripts/generate-go-fixtures.mjs [--check]
 * No Go implementation is imported and no entropy or timestamp enters fixtures.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const source = (path) => tsImport(path, import.meta.url);
const [core, mixed, normalization, parser, math, rngMT, rngXoshiro, replay, limits, budget,
  compatibility, replayVectors] = await Promise.all([
  import('../dist/core.js'),
  import('../dist/systems/mixed.js'),
  source('../src/v3/normalization.ts'),
  source('../src/v3/syntax/parser.ts'),
  source('../src/v3/math.ts'),
  source('../src/v3/runtime/mt19937.ts'),
  source('../src/v3/runtime/xoshiro128ss.ts'),
  source('../src/v3/runtime/replay.ts'),
  source('../src/v3/runtime/limits.ts'),
  source('../src/v3/runtime/budget.ts'),
  source('../tests/fixtures/v3-compatibility-corpus.ts'),
  source('./replay-vectors.ts'),
]);

const provenance = {
  package: '@erpg/dicecore',
  version: '3.7.1',
  commit: '1940044',
};
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
if (packageVersion !== provenance.version) {
  throw new Error('Review fixture provenance before generating against a different package version');
}
const mode = process.argv[2];
if (mode !== undefined && mode !== '--check') {
  throw new Error('Usage: node scripts/generate-go-fixtures.mjs [--check]');
}
const directory = new URL('../go/testdata/', import.meta.url);
mkdirSync(directory, { recursive: true });
let totalCases = 0;

function numericReplacer(_key, value) {
  if (typeof value !== 'number') return value;
  if (Object.is(value, -0)) return '-0';
  return Number.isFinite(value) ? value : String(value);
}

function capture(run) {
  try {
    // Reference outputs follow the same JSON wire semantics as the existing
    // cross-runtime replay checks (-0 becomes 0 in serialized result objects).
    return { value: JSON.parse(JSON.stringify(run())) };
  } catch (error) {
    if (typeof error?.toJSON === 'function') return { error: error.toJSON() };
    return { error: { name: error.name, message: error.message } };
  }
}

function emit(name, cases, metadata = {}) {
  const output = `${JSON.stringify({ schemaVersion: 1, provenance, ...metadata, cases }, numericReplacer, 2)}\n`;
  const path = new URL(`${name}.json`, directory);
  if (mode === '--check') {
    if (readFileSync(path, 'utf8') !== output) throw new Error(`Fixture differs: ${fileURLToPath(path)}`);
  } else {
    writeFileSync(path, output);
  }
  totalCases += cases.length;
  process.stdout.write(`${mode === '--check' ? 'Verified' : 'Wrote'} ${name}.json (${cases.length} cases)\n`);
}

const normalizationInputs = [...new Set([
  ...compatibility.compatibilityCorpus.map((entry) => entry.notation),
  '', ' ', 'd + 2d + f + 2f + df + 2d6ei6 + 4d6km',
  'floor(1d6/2)+max(1d6,2)', ' 2 # 1d6 [ataque] // vantagem',
  '3-1#1d6', '(3-1)#1d6', '{3-1}#1d6', '[3-1]#1d6', 'ceil(3/2)#1d6',
  '1d20 # iniciativa', '[ataque] # iniciativa', '1d6/* a */+1 [b]\n// c\n+2# d',
  '1d6 /* open', '1d6 [open', '(2+1)d(3+3)', '4d6kh3dl1', '4d6kh3dis',
  '2d20-pool(1)', '2d20+pool(2)', '2d20-pull(3)', '2d20+PULL(4)',
  '2d20pull(-1)', 'd20ADVpull(-1)', '1d20+2-pool(1)', '1d20+2-pull(1)adv',
  'd20ADV', 'd20DIS', '1d5-step(1)', '1d5+step(2)', '1d5-STEP(3)',
  '1d5-STREP(1)', '1d5strep(+2)', '1d5+2-step(1)',
  '2 D 6 [ação 🎲] // descrição', '1d6\u00a0+\u20281', '1d6 // a\r\n+2',
  '0#1d6', '1.5#1d6', '1/0#1d6', '2#3#d6',
])];
emit('normalization', normalizationInputs.map((input, index) => ({
  name: `normalization-${index + 1}`,
  input,
  outcome: capture(() => core.normalizeRpgDiceNotation(input)),
  parsedOutcome: capture(() => normalization.parseNormalizedDiceInput(input)),
})));

const parserInputs = [...new Set([
  ...normalizationInputs.map((input) => normalization.parseNormalizedDiceInput(input).notation),
  '1+2*3^2^2', '-2^2', '+2**3', 'max(abs(-2),(1+2)d(3+3))', 'dF', '4dF.1',
  '2d6!rukh1dl1min-1max+6cscfsa', '8d10!!p>=10>=8f=1dl1kh2min1max10ro<2uo=3cs=10cf=1sd',
  '1d6!2', '1d6!!3', '1d6!p4', '1d6!!p5>=6', '1d6!2!=5',
  '2d20pool(+2)pool(-1)advdis', '2d20pool(0)', '2d20pool(+0)', '2d20pool(-0)',
  '1d5step(+2)step(-1)', '1d20+2adv', '1d20+2pool(+2)advdis', '(1d20+2)adv',
  '1d5+2step(+1)', '1d20adv+2', '1d6!+1', '1d6!-1', '1d6!=1', '1d6r!=1',
  '{1d6,2d8+3}kh1', '{1d6,{2d8,3d4}kl1}sd', ' 1d6 + 2 ', '.5+1.25',
  '', '@', '$', '?', '🎲', '1d6&2', '0d6', '01d6', '1d00', '1d01', 'dF.3', 'dF.01',
  '{}', 'foo(1)', '1d6kh0', '1d6kh01', '(1+2', '1+2)', '{1d6,}', '{,1d6}',
  'abs(1,2)', 'max(1)', '1d6xyz', '1d6sfoo', '1d6>=', '.', '1..2', '1d6min',
  '1d6max', '1d6d', '1d6!0', '1d6!01', '1d6!1.0', '1d6!1.5',
  '1d6!9007199254740992', '1d6!2p', '1d6pool(1)', '1d6pool(00)', '1d6pool(+0.0)',
  '1d6pool(+01)', '1d6pool(+1.5)', '1d6pool(+9007199254740992)', '1d6pool(+)',
  '1d6step(1)', '1d6step(+0)', '1d6step(-0)', '1d6step(+01)', '1d6step(+1.5)',
  '1d6step(+9007199254740992)', '1d6step(+)', '1+2adv', '1d20+1d6+2adv',
  'max(1d20,1d6)+2pool(-1)', '1d5+1d6+2step(+1)',
])];
const parserCases = parserInputs.map((input, index) => ({
  name: `parser-${index + 1}`, input, outcome: capture(() => parser.parseDiceNotation(input)),
}));
for (const [input, maxDepth, maxNodes] of [
  ['1+2', 10, 2], ['(((1)))', 3, 100], ['1d5step(+1)', 10, 3],
  ['1d5step(+1)', 10, 4], ['1d6>=4f=1', 10, 4], ['(1)', 1, 100],
]) {
  const parserLimits = { maxDepth, maxNodes };
  parserCases.push({ name: `parser-limit-${parserCases.length + 1}`, input, limits: parserLimits,
    outcome: capture(() => parser.parseDiceNotation(input, parserLimits)) });
}
emit('parser', parserCases);

const mathFunctions = {
  normalize: math.normalizeMathValue,
  binary: math.evaluateBinary,
  unaryFunction: math.evaluateUnaryFunction,
  binaryFunction: math.evaluateBinaryFunction,
  compare: math.compareValues,
  round: math.roundResult,
};
const mathCases = [];
function addMath(operation, args) {
  const input = operation === 'round' || operation === 'compare' ? '' : 'fixture-expression';
  mathCases.push({ name: `${operation}-${mathCases.length + 1}`, operation, args, input,
    outcome: capture(() => mathFunctions[operation](...args, input)) });
}
for (const value of [0, -0, 1, -1, 0.1 + 0.2, 1 / 3, 1.23456789012345e25,
  Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, Number.MIN_VALUE, 1e-300, -1e-300,
  999999999999.5, 123456789012.5, 1.234567890125, -1.234567890125,
  Infinity, -Infinity, NaN]) addMath('normalize', [value]);
for (const operator of ['+', '-', '*', '/', '%', '^']) {
  for (const operands of [[7, 2], [-7, 2], [0.1, 0.2]]) addMath('binary', [operator, ...operands]);
}
for (const operands of [['/', 1, 0], ['/', 0, 0], ['%', 1, 0], ['^', -1, 0.5],
  ['^', 10, 400], ['/', 1, 3], ['*', 0, -1]]) addMath('binary', operands);
for (const [name, values] of Object.entries({
  abs: [-2, -0], ceil: [1.2, -1.2, -0.5], cos: [0, 1], exp: [0, 1, 1000],
  floor: [1.8, -1.8],
  log: [1, 2, 0, -1, Number.MIN_VALUE, 1e-320, 1e-310, 1e-309, 1e-308,
    1.2729519621896365e-308, 2.225073858507201e-308, 2.2250738585072014e-308],
  round: [1.5, -1.5, -0.5, -0.1],
  sign: [-4, 0, 4, -0], sin: [0, 1], sqrt: [9, 2, -1], tan: [0, 1],
})) for (const value of values) addMath('unaryFunction', [name, value]);
for (const name of ['max', 'min', 'pow']) {
  for (const operands of [[2, 8], [-2, 3], [-0, 0]]) addMath('binaryFunction', [name, ...operands]);
}
for (const name of ['max', 'min']) {
  for (const operands of [[Infinity, NaN], [NaN, Infinity], [-Infinity, NaN], [NaN, -Infinity]]) {
    addMath('binaryFunction', [name, ...operands]);
  }
}
for (const operator of ['=', '!=', '<>', '<', '>', '<=', '>=']) {
  for (const operands of [[2, 2], [2, 3], [3, 2]]) addMath('compare', [operator, ...operands]);
}
for (const value of [0, -0, 1.234, -0.001, 1.005, 2.675, -2.675, 1.125, -1.125,
  0.005, -0.005, 999999999999.99, 1e21, Infinity]) addMath('round', [value]);
emit('math', mathCases, { mathProfile: math.MATH_PROFILE });

const transcendentalRegressions = [
  ['sin', 1.4293], ['tan', 3.3315], ['cos', 4.6702], ['cos', 9.0805],
  ['tan', 4.8115743527127792e26], ['sin', 5.1100438385391316e140],
  ['cos', 1.7072285362519324e99], ['tan', 8.576470182742924e99],
];
emit('math-transcendental', transcendentalRegressions.map(([name, value], index) => ({
  name: `rounding-boundary-${name}-${index + 1}`,
  operation: 'unaryFunction', args: [name, value], input: 'fixture-expression',
  outcome: capture(() => math.evaluateUnaryFunction(name, value, 'fixture-expression')),
})), {
  mathProfile: math.MATH_PROFILE,
  reason: 'Regression vectors for decimal12 rounding boundaries in sine, cosine, and tangent. Go uses the reference fdlibm kernels and enforces these cases unconditionally.',
});

const rngCases = [];
function addRng(algorithm, seed, operation, count, min, max) {
  const entry = { name: `${algorithm}-${operation}-${rngCases.length + 1}`, algorithm, seed, operation, count };
  if (operation === 'integer') Object.assign(entry, { min, max });
  entry.outcome = capture(() => {
    let randomCalls = 0;
    const randomBudget = { consumeRandomCalls() { randomCalls += 1; } };
    const random = algorithm === 'mt19937'
      ? new rngMT.MersenneTwister19937(seed, randomBudget)
      : new rngXoshiro.Xoshiro128StarStar(seed, randomBudget);
    const values = Array.from({ length: count }, () => operation === 'integer'
      ? random.integer(min, max) : random[operation]());
    return { values, randomCalls };
  });
  rngCases.push(entry);
}
for (const algorithm of ['mt19937', 'xoshiro128ss']) {
  for (const seed of [[1, 2, 3, 4], [0, 0, 0, 0], [0xdeadbeef, 0xcafebabe, 42, 0xffffffff],
    [-1, 0x100000000, 17, Number.MAX_SAFE_INTEGER]]) {
    addRng(algorithm, seed, 'nextUint32', algorithm === 'mt19937' ? 630 : 32);
    addRng(algorithm, seed, 'real', 8);
  }
  for (const [min, max] of [[1, 6], [-1, 1], [0, 0], [0, 0xffffffff],
    [-2147483648, 2147483647], [0, 2147483648], [Number.MAX_SAFE_INTEGER - 5, Number.MAX_SAFE_INTEGER],
    [2, 1], [0, 0x100000000], [0.5, 1], [NaN, 1], [0, Infinity]]) {
    addRng(algorithm, [1, 2, 3, 4], 'integer', 20, min, max);
  }
  for (const seed of [[], [1.5, 2, 3, 4], [NaN, 2, 3, 4]]) addRng(algorithm, seed, 'nextUint32', 1);
}
for (const seed of [5489, 0, -1, 0x100000000, 1.5, NaN]) addRng('mt19937', seed, 'nextUint32', 630);
emit('rng', rngCases);

const seeds = [0, -0, 1, -1, 1.5, 1e-7, 1e-6, 1e20, 1e21, Number.MAX_SAFE_INTEGER,
  1.2345678901234568e20, 1.0000000000000001e18,
  Number.MAX_VALUE, Number.MIN_VALUE, Infinity, -Infinity, NaN,
  '', '0', '-0', '1', 'fortuna', 'ação 🎲', 'é', 'e\u0301', '\u0000', '\ud800', 'a'.repeat(1024)];
const seedCases = seeds.map((seed, index) => ({
  name: `seed-${index + 1}`, seedType: typeof seed, seed,
  ...(typeof seed === 'string'
    ? { seedUTF16: Array.from({ length: seed.length }, (_, offset) => seed.charCodeAt(offset)) } : {}),
  outcome: capture(() => replay.createProvidedSeed(seed)),
}));
for (const [seed, maxSeedLength] of [['🎲', 1], ['🎲', 2], ['abc', 2], ['abc', 0], ['abc', 1.5]]) {
  seedCases.push({ name: `seed-${seedCases.length + 1}`, seedType: typeof seed, seed, maxSeedLength,
    seedUTF16: Array.from({ length: seed.length }, (_, offset) => seed.charCodeAt(offset)),
    outcome: capture(() => replay.createProvidedSeed(seed, maxSeedLength)) });
}
emit('seeds', seedCases);

const validReplay = replay.createReplayDescriptor(replay.createProvidedSeed('fortuna'));
const replayCases = [];
function addReplay(name, descriptor, expectedPlanFingerprint) {
  replayCases.push({ name, descriptor,
    ...(expectedPlanFingerprint === undefined ? {} : { expectedPlanFingerprint }),
    isReplayDescriptor: replay.isReplayDescriptor(descriptor),
    outcome: capture(() => replay.validateReplayDescriptor(descriptor, expectedPlanFingerprint)),
    seedOutcome: capture(() => replay.createReplaySeed(descriptor, expectedPlanFingerprint)),
  });
}
addReplay('valid-mt19937', validReplay);
addReplay('valid-xoshiro', { ...validReplay, algorithm: 'xoshiro128ss' });
addReplay('valid-plan-binding', validReplay, validReplay.planFingerprint);
addReplay('wrong-plan-binding', validReplay, '11111111111111111111111111111111');
addReplay('null', null);
addReplay('array', []);
addReplay('empty', {});
addReplay('extra-key', { ...validReplay, unexpected: true });
const missingOrigin = { ...validReplay };
delete missingOrigin.origin;
addReplay('missing-origin', missingOrigin);
for (const [field, values] of Object.entries({
  schemaVersion: [1, '2'], algorithm: ['other'], algorithmVersion: [2], executionVersion: [2],
  mathProfile: ['native'], origin: ['crypto', 'provided-number', 'unknown'],
  seedMaterial: ['ABCDEF0123456789ABCDEF0123456789', 'abc', 1, '00000000000000000000000000000000'],
  planFingerprint: ['ABCDEF0123456789ABCDEF0123456789', 'abc'],
})) for (const value of values) addReplay(`${field}-${String(value)}`, { ...validReplay, [field]: value });
emit('replay', replayCases);

const limitCases = [{ name: 'defaults', operation: 'create', overrides: {},
  outcome: capture(() => limits.createDiceLimits()) }];
for (const preset of ['browser', 'trustedServer', 'untrustedServer']) {
  limitCases.push({ name: `preset-${preset}`, operation: 'preset', preset,
    outcome: { value: limits.DICE_LIMIT_PRESETS[preset] } });
}
for (const [name, overrides] of [
  ['lower-caps', { maxRolls: 2, maxSides: 6 }], ['raise-engine-caps', { maxRolls: 1000 }],
  ['zero', { maxRolls: 0 }], ['negative', { maxEvents: -1 }],
  ['fraction', { maxSides: 1.5 }], ['unsafe-integer', { maxSeedLength: Number.MAX_SAFE_INTEGER + 1 }],
  ['wrong-type', { maxRolls: '2' }], ['null', null], ['array', []],
]) limitCases.push({ name, operation: 'create', overrides,
  outcome: capture(() => limits.createDiceLimits(overrides)) });
for (const [name, engineOverrides, overrides] of [
  ['resolve-defaults', {}, {}], ['resolve-lowered', { maxRolls: 10 }, { maxRolls: 5 }],
  ['resolve-same', { maxRolls: 10 }, { maxRolls: 10 }],
  ['resolve-raise', { maxRolls: 10 }, { maxRolls: 11 }],
  ['resolve-invalid', {}, { maxRolls: 0 }], ['resolve-null', {}, null],
]) limitCases.push({ name, operation: 'resolve', engineOverrides, overrides,
  outcome: capture(() => limits.resolveDiceLimits(limits.createDiceLimits(engineOverrides), overrides)) });
emit('limits', limitCases);

const budgetCases = [];
function addBudget(name, overrides, steps) {
  const executionBudget = new budget.ExecutionBudget(limits.createDiceLimits(overrides));
  const operations = steps.map(([method, ...args]) => ({ method, args,
    outcome: capture(() => { executionBudget[method](...args); return null; }),
  }));
  budgetCases.push({ name, limits: overrides, operations,
    snapshot: executionBudget.snapshot(), stats: executionBudget.stats() });
}
const budgetMethods = {
  consumeRolls: 'maxRolls', consumeInitialDice: 'maxInitialDice',
  consumeGeneratedDice: 'maxGeneratedDice', consumeRandomCalls: 'maxRandomCalls',
  consumeEvents: 'maxEvents', consumeModifierSteps: 'maxModifierSteps',
  consumeResolvedGroups: 'maxResolvedGroups', consumeResultItems: 'maxResultItems',
};
for (const [method, cap] of Object.entries(budgetMethods)) {
  addBudget(method, { [cap]: 2 }, [[method], [method, 1], [method], [method, 0], [method, -1], [method, 0.5]]);
}
addBudget('ast-nodes', { maxAstDepth: 2, maxAstNodes: 2 }, [
  ['consumeAstNode', 1], ['consumeAstNode', 2], ['consumeAstNode', 2],
  ['consumeAstNode', 3], ['consumeAstNode', 0], ['consumeAstNode', 1.5],
]);
addBudget('input-length-utf16', { maxInputLength: 2 }, [
  ['assertInputLength', '🎲'], ['assertInputLength', '🎲a'], ['assertInputLength', 'abc'],
]);
addBudget('output-length', { maxOutputLength: 2 }, [
  ['assertOutputLength', 2], ['assertOutputLength', 3], ['assertOutputLength', -1],
]);
addBudget('combined', {}, [['consumeAstNode', 2], ...Object.keys(budgetMethods).map((method) => [method, 3])]);
emit('budget', budgetCases);

// Preserve these historic values verbatim rather than regenerate them from today's engine.
emit('compatibility-corpus', compatibility.compatibilityCorpus, {
  purpose: 'Historical V2/V3 reference exercised by the native Go executor with both recorded seeds.',
  seeds: compatibility.compatibilitySeeds,
});
emit('full-roll-replay', replayVectors.crossRuntimeReplayVectors.map((vector) => ({
  ...vector,
  outcome: capture(() => vector.kind === 'mixed'
    ? mixed.rollMixedDice(vector.input, vector.options)
    : core.rollRpgDice(vector.input, vector.options)),
})), { purpose: 'Complete TypeScript roll and replay outputs exercised by the native Go engine and system adapters.' });
process.stdout.write(`${mode === '--check' ? 'Verified' : 'Generated'} ${totalCases} deterministic fixture cases.\n`);
