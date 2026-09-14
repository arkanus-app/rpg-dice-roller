/** Node/V8 oracle for exact decimal12 arithmetic; inputs and outputs use IEEE754 bits. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';
const math = await tsImport('../src/v3/math.ts', import.meta.url);
const mode = process.argv[2];
if (mode !== undefined && mode !== '--check' && mode !== '--audit') throw new Error('Usage: node scripts/generate-go-math-conformance.mjs [--check|--audit]');
const buffer = new ArrayBuffer(8), view = new DataView(buffer);
function bits(value) { view.setFloat64(0, value, false); return view.getBigUint64(0, false).toString(16).padStart(16, '0'); }
function fromBits(value) { view.setBigUint64(0, value, false); return view.getFloat64(0, false); }
const values = new Map();
function add(value) { values.set(bits(value), value); }
function adjacent(value, steps = 2) {
  add(value);
  if (!Number.isFinite(value)) return;
  const word = BigInt(`0x${bits(value)}`);
  for (let delta = -steps; delta <= steps; delta += 1) {
    const next = word + BigInt(delta);
    if (next >= 0n && next <= 0xffffffffffffffffn) add(fromBits(next));
  }
}
for (const value of [0, -0, NaN, Infinity, -Infinity, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE,
  1, -1, 0.1, -0.1, 0.3, 0.6744, 0.78125, 1.4, Math.PI / 4, Math.PI / 2, Math.PI, Math.PI * 2,
  2 ** -28, 2 ** -29, 2 ** -54, 2 ** -1022, 2 ** 20, 2 ** 24, 2 ** 48, 2 ** 500, 1e100, 1e300,
  Math.LN2 / 2, Math.LN2, Math.LN2 * 1.5, 709.782712893384, -745.1332191019411, -708.3964185322641]) adjacent(value);
for (let multiplier = 1; multiplier <= 40; multiplier += 1) {
  adjacent(multiplier * Math.PI / 2); adjacent(-multiplier * Math.PI / 2);
}
for (const exponent of [-1074, -1073, -1050, -1023, -1022, -1000, -500, -54, -29, -28, -10, 0, 10, 20, 24, 50, 100, 300, 500, 700, 1000, 1023]) {
  const scale = 2 ** exponent;
  for (const mantissa of [1, 1.5, Math.PI / 2, 1.9999999999999998]) { adjacent(scale * mantissa, 1); adjacent(-scale * mantissa, 1); }
}
let state = 0x517cc1b7;
function random32() { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; }
function uniform() { return random32() / 0x100000000; }
function randomFloat() { return fromBits(BigInt(random32()) << 32n | BigInt(random32())); }
const audit = mode === '--audit';
for (let index = 0; index < (audit ? 16000 : 256); index += 1) {
  add(randomFloat()); add((uniform() - 0.5) * 1500); add((uniform() - 0.5) * 100); add(2 ** ((uniform() - 0.5) * 2000));
}
const cases = [];
function capture(name, args) {
  const entry = { function: name, args: args.map(bits) };
  try {
    const value = args.length === 1 ? math.evaluateUnaryFunction(name, args[0], 'math-conformance')
      : math.evaluateBinaryFunction(name, args[0], args[1], 'math-conformance');
    entry.resultBits = bits(value);
  } catch (error) { entry.error = error.toJSON(); }
  cases.push(entry);
}
for (const name of ['sin', 'cos', 'tan', 'exp', 'log']) for (const value of values.values()) capture(name, [value]);
const powBases = [NaN, Infinity, -Infinity, 0, -0, 1, -1, 2, -2, 0.5, -0.5, Number.MIN_VALUE,
  2 ** -1022, Number.MAX_VALUE, 1 - Number.EPSILON, 1 + Number.EPSILON, Math.PI, Math.E, 1e-10, 1e10];
const powExponents = [NaN, Infinity, -Infinity, 0, -0, 1, -1, 2, -2, 0.5, -0.5, 3, 4, 10, -10,
  1 / 3, 2 / 3, 1.5, 2.5, 100, 1000, -1000, 1024, -1074, 2 ** 32, -(2 ** 32), 2 ** 53, 2 ** 65, -(2 ** 65)];
for (const base of powBases) for (const exponent of powExponents) capture('pow', [base, exponent]);
for (let index = 0; index < (audit ? 100000 : 2048); index += 1) {
  const variant = index % 5;
  const base = variant === 0 ? 0.1 + uniform() * 10 : variant === 1 ? 1 + (uniform() - 0.5) * 0.0001
    : variant === 2 ? 2 ** ((uniform() - 0.5) * 1000) : variant === 3 ? -uniform() * 10 : randomFloat();
  const exponent = variant === 1 ? (uniform() - 0.5) * 1e7 : variant === 3 ? Math.trunc((uniform() - 0.5) * 30) : (uniform() - 0.5) * 100;
  capture('pow', [base, exponent]);
}
// All 42 safe-integer-boundary regressions found by the initial 425,385-case
// audit. Keep input bits, never hand-written expected answers: every result
// below still comes directly from the unmodified TypeScript implementation.
const powRegressionArgs = [
  ['40222602a9573333', '40309d333d000000'],
  ['3fefffde0c49fa44', 'c141259be028a5c0'],
  ['4020ce957bc33333', '4030d9f495a40000'],
  ['4024059c9f633333', '402f23a876080000'],
  ['3ff0001b44006b51', '413579776a280300'],
  ['3ff0001c992d9f56', '4133e7d5cebc4e00'],
  ['3ff0002169fc9ba6', '4131695db8f4b100'],
  ['401c468571866666', '403289d675180000'],
  ['3ff0000c47705d64', '4146472aa0d2c300'],
  ['4023408908333333', '402da1bcf4d00000'],
  ['3fefffa5249af27c', 'c129915722375400'],
  ['3ff0000913b92a99', '415009a6fd85dc80'],
  ['40009067cbdccccd', '4048a9ed85d40000'],
  ['40207fbfa86b3333', '40309ddd6e240000'],
  ['4006ebe288fccccd', '40414b94da520000'],
  ['4021629345f33333', '402e9a3875580000'],
  ['40240930d3ab3333', '402f694c86680000'],
  ['3fefffd118620ebf', 'c137faafbfe4aa80'],
  ['4009afbe8f1ccccd', '403e7252a5680000'],
  ['4019fd5d404e6666', '40332e37c83c0000'],
  ['40172f2da8be6666', '4033df79f4bc0000'],
  ['3fefffde019a1d7e', 'c13fdcf4e7602880'],
  ['3fefffe0390c8241', 'c1419dbb9991de40'],
  ['4022206be1f73333', '402f83e7bb280000'],
  ['40096995c67ccccd', '403d1f09b85c0000'],
  ['400d8879e90ccccd', '403bde8da2080000'],
  ['3fefffe2c5c3b8bb', 'c1437bf214df8f00'],
  ['3fd2026e43666666', 'c03ce6dc4d640000'],
  ['4023d5f5048f3333', '402fa71d58500000'],
  ['3ff000206024cd36', '4131e872f5b0c680'],
  ['401456ac146e6666', '4035f4d73de00000'],
  ['400cc1b5d18ccccd', '403bde556b680000'],
  ['4022f23392a73333', '402fa8df5c380000'],
  ['3fefffe7d0c2f4f1', 'c147b1fb0699de80'],
  ['3ff000091581d97f', '4150109a8f722140'],
  ['3fddd296b9e66666', 'c046cc4b84520000'],
  ['3fefffeac61d02de', 'c14a55a5c1de1940'],
  ['3fcb6994aecccccd', 'c037413b1e940000'],
  ['3ff0000f67db538f', '414282dde90b3180'],
  ['3f12bc133e06042b', 'c00df22cfaa00000'],
  ['44ff6d55fe8348ea', '3fe4dbf846800000'],
  ['3ff0001c4cb44b5e', '4132f1c3e09b9080'],
];
for (const args of powRegressionArgs) capture('pow', args.map(value => fromBits(BigInt(`0x${value}`))));
const output = `${JSON.stringify({ schemaVersion: 1, provenance: { package: '@erpg/dicecore', version: '3.7.1', node: process.version, v8: process.versions.v8, mathProfile: 'decimal12-v1' }, cases }, null, 2)}\n`;
const destination = new URL(audit ? '../.artifacts/math-conformance-audit.json' : '../go/testdata/math-conformance.json', import.meta.url);
mkdirSync(new URL(audit ? '../.artifacts/' : '../go/testdata/', import.meta.url), { recursive: true });
if (mode === '--check') { if (readFileSync(destination, 'utf8') !== output) throw new Error('Math conformance fixture differs'); }
else writeFileSync(destination, output);
process.stdout.write(`${mode === '--check' ? 'Verified' : 'Wrote'} ${cases.length} exact math cases (${values.size} unary inputs).\n`);
