/** TypeScript-only oracle for the complete Go compiler port. */
import { readFileSync, writeFileSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';

const compiler = await tsImport('../src/v3/compiler.ts', import.meta.url);
const { createDiceLimits } = await tsImport('../src/v3/runtime/limits.ts', import.meta.url);
const mode = process.argv[2];
if (mode !== undefined && mode !== '--check') throw new Error('Usage: node scripts/generate-go-compiler-fixtures.mjs [--check]');
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
if (version !== '3.7.1') throw new Error('Review compiler oracle provenance before changing the reference version');

function capture(run) {
  try { return { value: JSON.parse(JSON.stringify(run())) }; }
  catch (error) { return { error: error.toJSON?.() ?? { name: error.name, message: error.message } }; }
}

function projectProgram(program) {
  return { ...program, diceSpecs: Object.fromEntries(program.diceSpecs),
    groupModifiers: Object.fromEntries(program.groupModifiers), constants: Object.fromEntries(program.constants) };
}

const inputs = new Set([
  '', ' ', 'not-dice', '0#d6', '101#d6', '999999999999999999999#d6', `${'9'.repeat(400)}#d6`,
  '2#2d6!+1d8ro<2 [ataque]', '2 D 6 [ação 🎲] // descrição', '(1+1)d(2*3)sdmin2min3',
  '1d(1d6)', '(1d6)d6', '0d6', '1d0', '1d0!1', '1d1!p1u',
  '9007199254740991d6pool(+1)', '1d6pool(-9007199254740991)',
  '1d6step(+9007199254740991)step(+9007199254740991)',
  '1d6step(-9007199254740991)step(-9007199254740991)',
  '1d6step(+9007199254740991)step(-9007199254740991)',
  '{1,2}min1', '{1,2}>=1', '{1,2}cs=1', '{1,2}!',
  '1d6max-2', '1d6max1.5!1u', '1d6min1max6!1u', '1d6!1ro', '2d6!1uo', '1d6!!p2ro',
  '1d6cs=6cf=1>=5f=1sd', '2d6!!1ro<2uo', 'd6+(-d8)', '-d6', '+d6',
  '1d4097!1<2uo', '1d4097!1>=2uo', '1d4097min5000!1>4000uo',
  '4d2!1>=1u!=99', '2d6!!1r!=1', '2d6!!1r<>1', '2d6!!1r<1', '2d6!!1r<=1', '2d6!!1r>1', '2d6!!1r>=1',
  Array.from({length:40},()=> '2d256!!2>=1u').join('+'),
]);

// Reuse checked-in reference inputs and complete notation literals in TS tests.
for (const filename of ['normalization.json', 'parser.json']) {
  const fixture = JSON.parse(readFileSync(new URL(`../go/testdata/${filename}`, import.meta.url)));
  for (const example of fixture.cases) if (typeof example.input === 'string') inputs.add(example.input);
}
for (const filename of ['compiler.test.ts','compiler-boundaries.test.ts','zero-dice.test.ts','zero-pool.test.ts']) {
  const source = readFileSync(new URL(`../src/v3/${filename}`, import.meta.url), 'utf8');
  for (const match of source.matchAll(/'([^'\r\n]*)'/g)) {
    if (/\d[d#]|d[0-9F%]|(?:sin|cos|tan|pow|sqrt|sign|abs|ceil|exp|log|round|floor|max|min)\(/.test(match[1])) inputs.add(match[1]);
  }
}
for (const expression of ['abs(-2)','ceil(1.2)','cos(0)','exp(0)','floor(1.8)','log(exp(1))','round(1.6)','sign(2)','sqrt(4)','max(1,2)','min(2,3)','pow(2,2)','8/2','5%2','2*2','3-1','1+2','2^2','2**2','+2','sin(0)','tan(0)','sqrt(-1)','sign(-0)']) inputs.add(`(${expression})d6`);

const specifications = [...inputs].map(input => ({ input }));
specifications.push(
  {input:'1d7',limits:{maxSides:6}}, {input:'1d1000step(-1)',limits:{maxSides:100}},
  {input:'1d20step(+1)',limits:{maxSides:20}}, {input:'2#1d20-pool(3)',limits:{maxInitialDice:7}},
  {input:'2#1d20-pool(3)',limits:{maxInitialDice:8}}, {input:'d6',limits:{maxInputLength:1}},
  {input:'1+2+3',limits:{maxAstNodes:4}}, {input:'(((1)))',limits:{maxAstDepth:3}},
  {input:'2#2d6!r=1',limits:{maxModifierSteps:Number.MAX_SAFE_INTEGER}},
  {input:'2d6!2',limits:{maxModifierSteps:1}}, {input:'d%',limits:{maxSides:99}},
);
const cases = specifications.map((example,index) => {
  const limits = createDiceLimits(example.limits);
  return {
    name:`compiler-${index+1}`, ...example,
    outcome:capture(() => {const plan=compiler.compileDicePlan(example.input,limits);return {plan,program:projectProgram(compiler.getPlanProgram(plan))};}),
    inspectionOutcome:capture(() => compiler.inspectDicePlan(example.input,limits)),
  };
});
const output = `${JSON.stringify({schemaVersion:1,provenance:{package:'@erpg/dicecore',version,reference:'src/v3/compiler.ts'},cases},null,2)}\n`;
const file = new URL('../go/testdata/compiler.json',import.meta.url);
if (mode==='--check') {if(readFileSync(file,'utf8')!==output)throw new Error('Compiler oracle is not reproducible');}
else writeFileSync(file,output);
console.log(`${mode==='--check'?'Verified':'Wrote'} compiler.json (${cases.length} cases)`);
