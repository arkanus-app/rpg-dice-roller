/** Deterministic TypeScript executor oracle; does not import the Go port. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';

const executor = await tsImport('./generate-go-executor-oracle.ts', import.meta.url);
const { compileDicePlan, createDiceLimits } = executor;
const mode = process.argv[2];
if (mode !== undefined && mode !== '--check') throw new Error('Usage: node scripts/generate-go-executor-fixtures.mjs [--check]');
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
if (packageVersion !== '3.7.1') throw new Error('Review executor fixtures for a new TypeScript version');
const capture = (run) => {
  try { return { value: JSON.parse(JSON.stringify(run())) }; }
  catch (error) { return { error: typeof error.toJSON === 'function' ? error.toJSON() : { name: error.name, message: error.message } }; }
};
const inputs = [
  '1', '-2^2', '+2', '(1+2)*3', '2**3', '1.5+2.75', '5%2', '2#1', '0#1d6',
  '1d0', '1d1', '2d%', '20dF.1', '20dF.2', '(1+2)d(3+3)', '2#2d6+1 [ataque]',
  '4d6', '8d6min3', '8d6max3', '4d6kh1', '4d6kl1', '4d6dh1', '4d6dl1',
  '4d6kh2', '4d6kl2', '4d6dh2', '4d6dl2', '4d6kh10', '4d6dl10', '4d6dh10',
  '20d6>=5f=1', '20d6>=5', '20d6>=7', '20d6<=0f<=6',
  '20d6!', '20d6!2', '20d6!!2', '20d6!p2', '20d6!!p2', '20d6!2>=5',
  '20d6r', '20d6ro', '20d6ro<3', '5d6u', '12d6uo', '12d6uo=1',
  '20d6cscf', '20d6cs>=5cf<=2', '20d6sd', '20d6sa',
  '12d6!2ro<2uokh8dl2>=5f=1cs>=6cf<=1sd',
  '12d6!!p2ro<2uo=2kh7dl2>=5f=1cs>=6cf<=1sa',
  '8d6min3max5kh4dl1', '4d6min2min3', '4d6kh3dl3',
  '{1d6,2d8+3}kh1', '{1d6,2d8+3}kl1', '{1d6,2d8+3}dh1', '{1d6,2d8+3}dl1',
  '{1,1,2,2}kh2dl2sd', '{1d6,2d8+3}sd', '{1d6,2d8+3}sa',
  '{{2d6kh1,1d8}kh1,1d10}kh1', '{1d6,1d8}dl10', '{1d6>=5,1d8>=6}kh1',
  '2#{1d6,2d8+3}kh1sd', '2#{1d6,2d8+3}', '{1,2}+1', 'abs(-1d6)',
  'max(1d6,2d8)', 'min(1d6,2d8)', 'pow(1d6,2)', 'floor(1d6/2)', 'ceil(1d6/2)',
  'sqrt(1d6)', 'round(1d6/2)', 'sign(1d6)', 'log(1d6)', 'sin(1d6)', 'cos(1d6)',
  'tan(1d6)', 'exp(1d6)', '1d6/0', 'sqrt(-1d6)', '1d6+(-2)', '1d6+(+2)',
  '2d20pool(-2)', '2d20pool(+2)adv', '1d5step(+2)', '1d20+2adv',
  '{1d6,1d8}min3', '1d1!', '2d1u',
];
const runs = [];
for (const algorithm of ['mt19937', 'xoshiro128ss']) {
  for (const [index, input] of inputs.entries()) runs.push({ name: `${algorithm}-${index + 1}`, input, seed: `executor:${index}`, algorithm });
}
for (const [index, executionLimits] of [
  { maxRolls: 1 }, { maxInitialDice: 1 }, { maxGeneratedDice: 1 }, { maxRandomCalls: 1 },
  { maxEvents: 1 }, { maxResultItems: 1 }, { maxResolvedGroups: 1 }, { maxOutputLength: 1 },
  { maxModifierSteps: 1 }, { maxEvents: 3, maxResultItems: 4 },
].entries()) runs.push({ name: `execution-budget-${index}`, input: '2#20d6!2ro<2', seed: 'limits', executionLimits });
for (const [index, input] of ['4d6', '4d6kh1', '4d6dl1', '4d6min3', '4d6max3', '4d6>=5f=1'].entries()) {
  for (const cap of [1, 3, 5, 8, 10, 14, 18]) {
    runs.push({ name: `fast-budget-${index}-${cap}`, input, seed: 'limits', executionLimits: { maxEvents: cap, maxResultItems: cap + 3 } });
  }
}
const cases = runs.map((entry) => {
  const outcomes = {};
  for (const [projection, run] of [ ['full', executor.executeRollPlan], ['details', executor.executeRollPlanDetails], ['summary', executor.executeRollPlanSummary] ]) {
    outcomes[projection] = capture(() => run(compileDicePlan(entry.input, createDiceLimits()), {
      limits: createDiceLimits(entry.executionLimits), seed: entry.seed, randomAlgorithm: entry.algorithm,
    }));
  }
  return { ...entry, outcomes };
});
const output = `${JSON.stringify({ schemaVersion: 1, provenance: { package: '@erpg/dicecore', version: '3.7.1', commit: '1940044' }, cases }, null, 2)}\n`;
const destination = new URL('../go/testdata/executor.json', import.meta.url);
mkdirSync(new URL('../go/testdata/', import.meta.url), { recursive: true });
if (mode === '--check') { if (readFileSync(destination, 'utf8') !== output) throw new Error('Executor fixture differs'); }
else writeFileSync(destination, output);
process.stdout.write(`${mode === '--check' ? 'Verified' : 'Wrote'} executor.json (${cases.length} cases, three projections each)\n`);
