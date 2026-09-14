import { readFileSync, writeFileSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';
import * as api from '../dist/index.js';

const [fate, assimilation, daggerheart, vampire, mixed] = await Promise.all([
  'fate', 'assimilation', 'daggerheart', 'vampire-v5', 'mixed',
].map((name) => tsImport(`../src/v3/systems/${name}.ts`, import.meta.url)));
const functions = {
  fate: api.rollFateDice, assimilation: api.rollAssimilation,
  daggerheart: api.rollDaggerheart, 'vampire-v5': api.rollVampireV5, mixed: api.rollMixedDice,
};
const boundFunctions = {
  fate: fate.rollFateDiceWithEngine, assimilation: assimilation.rollAssimilationWithEngine,
  daggerheart: daggerheart.rollDaggerheartWithEngine, 'vampire-v5': vampire.rollVampireV5WithEngine,
  mixed: mixed.rollMixedDiceWithEngine,
};
const mode = process.argv[2];
if (mode !== undefined && mode !== '--check') throw new Error('Usage: node scripts/generate-go-system-fixtures.mjs [--check]');
const capture = (run) => {
  try { return { value: run() }; }
  catch (error) { return { error: error.toJSON?.() ?? { name: error.name, message: error.message } }; }
};
const fixtures = [];
function add(system, input, options = { seed: 'system-validation' }, extra = {}) {
  const entry = { name: `${system}-${fixtures.length + 1}`, system, input, options, ...extra };
  entry.outcome = capture(() => functions[system](input, options));
  fixtures.push(entry);
}
const scenarios = {
  fate: [{}, { dice: 1 }, { dice: 8 }],
  assimilation: [{ d6: 4 }, { d10: 4 }, { d12: 8, keep: 2 }, { d6: 2, d10: 2, d12: 2, keep: 3 }],
  daggerheart: [{}, { modifier: -2, difficulty: 12 }, { difficulty: 0 }, { difficulty: 99 }],
  'vampire-v5': [{ pool: 8, hunger: 3, difficulty: 4 }, { pool: 2, hunger: 5, difficulty: 8 }, { pool: 8, hunger: 0, difficulty: 0 }, { pool: 1, hunger: 0 }],
  mixed: [
    '2d6+1; v5(5,2,3); fate(4); assim(1,1,1,2); dh(-1,12)',
    'vampiro(5,2,3); fatedice(); AS(1,1,1,2)',
    'v5(pool=4,fome=1,dificuldade=2); fate(dados=3); assim(d6=2,manter=1)',
    'dh(-1,12); daggerheart(mod=2,dc=15); dagger(modifier=0,dificuldade=10)',
    'ASSIMILAÇÃO(d10=1); fáte(díce=1); max(2,3); d1 [one; die]',
    '\u1c89fate(1); fate\u{10d40}(1)',
    'd1ro=1; d1!1; d6min6; fate(3)',
    'ceil(1d6/2); {1d6,1d8}kh1; max(2,3) // comment',
  ],
};
for (const randomAlgorithm of ['mt19937', 'xoshiro128ss']) {
  for (const detail of ['full', 'compact']) {
    for (const seed of [0, 1, 'systems/ação 🎲']) {
      for (const [system, inputs] of Object.entries(scenarios)) {
        for (const input of inputs) add(system, input, { seed, randomAlgorithm, detail });
      }
    }
  }
}

for (const system of ['fate', 'assimilation', 'daggerheart', 'vampire-v5']) {
  for (const input of [[], 1, 'not an object']) add(system, input);
}
for (const input of [{ dice: 0 }, { dice: null }, { dice: 1.5 }, { dice: '4' }, { dice: 9007199254740992 }]) add('fate', input);
for (const input of [null, {}, { d6: -1 }, { d10: -1 }, { d12: -1 }, { d6: 1, keep: 0 }, { d6: 1, keep: 2 }, { d6: 9007199254740991, d12: 1 }]) add('assimilation', input);
for (const input of [{ modifier: 9007199254740968 }, { modifier: -9007199254740968 }, { difficulty: -1 }]) add('daggerheart', input);
for (const input of [null, {}, { pool: 1 }, { pool: 0, hunger: 0 }, { pool: 1, hunger: 6 }, { pool: 1, hunger: 0, difficulty: -1 }]) add('vampire-v5', input);
for (const input of [null, [], {}, 42, '', '   ', 'd6)', 'd6}', 'd6]', '(d6', '{d6', 'd6 [comment',
  ';d6', 'd6;;d6', 'd6;', 'fate(1.5)', 'fate(+1)', 'fate(9007199254740992)', 'fate(1,)',
  'fate(=1)', 'fate(dice=invalid)', 'fate(dice=1,dice=2)', 'fate(dice=1,dado=2)', 'fate(dice=1,2)', 'fate(unknown=1)',
  'fate(2=1,1=1)', 'fate(2,3)', 'v5(1)', 'v5(pool=1)', 'v5(hunger=1)', 'v5(pool=1,hunger=0,fome=1)',
  'v5(1,0,0,0)', 'dh(1,2,3)', 'dh(mod=1,modifier=2)', 'dh(dc=1,difficulty=2)',
  'assim()', 'assim(1,2,3,4,5)', 'assim(d6=1,keep=1,manter=1)',
  'fate(0)', 'v5(0,0)', 'dh(9007199254740968)', 'assim(9007199254740991,1)', 'xyz(2)',
]) add('mixed', input);
for (const [input, limits] of [
  ['d6;d6', { maxInputLength: 4 }], ['d1;d1', { maxRolls: 1 }], ['fate(3);d1', { maxInitialDice: 3 }],
  ['d1;1', { maxEvents: 3 }], ['d1;d1', { maxRandomCalls: 1 }], ['d1!1;d1!1', { maxGeneratedDice: 1 }],
  ['d1;d1', { maxResolvedGroups: 1 }], ['d1;d1', { maxResultItems: 3 }],
  ['d1ro=1;d1ro=1', { maxModifierSteps: 1 }], ['d1', { maxRolls: 0 }],
]) add('mixed', input, { seed: 'boundary', limits });
for (const input of ['fate(1)', 'd1;d1']) {
  const baseline = api.rollMixedDice(input, { seed: 'boundary' });
  add('mixed', input, { seed: 'boundary', limits: { maxOutputLength: baseline.output.length - 1 } });
}
add('mixed', 'fate(1)', { seed: 'long-seed', limits: { maxSeedLength: 1 } });
for (const system of ['fate', 'assimilation', 'daggerheart', 'vampire-v5']) {
  for (const detail of ['full', 'compact']) add(system, scenarios[system][0], { seed: 'limit', detail, limits: { maxInitialDice: 1 } });
}

const replayBase = api.rollMixedDice('d6;fate(1)', { seed: 'replay-reference' }).replay;
for (const replay of [[], {}, { ...replayBase, extra: true }, { ...replayBase, notation: 'other' },
  { ...replayBase, schemaVersion: 2 }, { ...replayBase, rolls: [] },
  ...[null, [], { ...replayBase.rolls[0], kind: 'fate' }, { ...replayBase.rolls[0], notation: 'd8' },
    { ...replayBase.rolls[0], extra: true }, { ...replayBase.rolls[0], replay: {} }]
    .map((entry) => ({ ...replayBase, rolls: [entry, replayBase.rolls[1]] })),
]) add('mixed', 'd6;fate(1)', { replay });
for (const detail of ['full', 'compact']) add('mixed', 'd6;fate(1)', { replay: replayBase, detail });

const contracts = [];
function contract(system, input, faces, detail = 'full', injectedError = false) {
  const base = api.rollRpgDice(`${Math.max(1, faces.length)}d6`, { seed: 'contract-base' });
  const dice = faces.map((face, index) => ({ ...base.dice[index], ...face }));
  const result = { ...base, dice };
  const details = { ...api.rollRpgDiceDetails(`${Math.max(1, faces.length)}d6`, { seed: 'contract-base' }), dice };
  const engine = { ...api.createDiceEngine(), roll: () => {
    if (injectedError) throw new Error('injected engine failure');
    return result;
  }, rollDetails: () => {
    if (injectedError) throw new Error('injected engine failure');
    return details;
  } };
  const options = { detail };
  contracts.push({ name: `contract-${system}-${contracts.length + 1}`, system, input, options,
    engineResult: result, engineDetails: details, injectedError,
    outcome: capture(() => boundFunctions[system](engine, input, options)),
  });
}
for (const detail of ['full', 'compact']) {
  for (let rawValue = 1; rawValue <= 6; rawValue += 1) contract('fate', { dice: 1 }, [{ rawValue }], detail);
  for (const sides of [6, 10, 12]) for (let rawValue = 1; rawValue <= sides; rawValue += 1) contract('assimilation', { d6: 1 }, [{ rawValue, sides }], detail);
  for (const [hope, fear, difficulty] of [[6, 6, 99], [9, 2, undefined], [2, 9, undefined], [9, 2, 1], [2, 9, 1], [9, 2, 99], [2, 9, 99]]) {
    contract('daggerheart', difficulty === undefined ? {} : { difficulty }, [{ sides: 12, rawValue: hope }, { sides: 12, rawValue: fear }], detail);
  }
  for (const [values, hunger, difficulty] of [
    [[10, 10], 0, 1], [[10, 10], 1, 1], [[1, 1], 1, 99], [[2, 2], 1, 99],
    [[6, 6], 1, 1], [[3, 4], 1, undefined], [[10, 6], 1, 1],
  ]) contract('vampire-v5', { pool: values.length, hunger, ...(difficulty === undefined ? {} : { difficulty }) }, values.map((rawValue) => ({ sides: 10, rawValue })), detail);
  for (const system of ['fate', 'assimilation', 'daggerheart', 'vampire-v5']) contract(system, scenarios[system][0], [{ rawValue: 1 }], detail, true);
}
for (const [system, input, faces] of [
  ['fate', {}, [{ rawValue: 0 }]], ['fate', {}, [{ rawValue: 1, sides: 'F' }]],
  ['assimilation', { d6: 1 }, [{ rawValue: 13 }]], ['assimilation', { d6: 1 }, [{ sides: 'F' }]],
  ['assimilation', { d6: 1 }, [{ sides: 8 }]], ['assimilation', { d6: 1 }, [{ sides: 'bad' }]],
  ['daggerheart', {}, []], ['daggerheart', {}, [{ sides: 12 }]],
  ['daggerheart', {}, [{ sides: 'F' }, { sides: 12 }]], ['daggerheart', {}, [{ sides: 12 }, { sides: 'F' }]],
  ['vampire-v5', { pool: 1, hunger: 0 }, [{ sides: 'F' }]],
]) contract(system, input, faces);

const selectionRoll = api.rollAssimilation({ d12: 12, keep: 12 }, { seed: 'selection' });
const selections = [[], selectionRoll.dice.map((die) => die.id), [selectionRoll.dice[2].id, selectionRoll.dice[0].id],
  null, 1, [''], [1], ['unknown'], [selectionRoll.dice[0].id, selectionRoll.dice[0].id], Array(13).fill('any')]
  .map((selectedIds, index) => ({ name: `selection-${index + 1}`, roll: selectionRoll, selectedIds,
    outcome: capture(() => api.evaluateAssimilationSelection(selectionRoll, selectedIds)),
  }));

// Go 1.26 uses Unicode 15 tables; the pinned Node oracle uses Unicode 17.
// Freeze the actual JavaScript letter/number categories instead of depending on
// a host runtime's Unicode version when recognizing mixed system call names.
function unicodePropertyRanges(property) {
  const expression = new RegExp(`\\p{${property}}`, 'u');
  const ranges = [];
  let start = null;
  for (let point = 0; point <= 0x110000; point += 1) {
    const member = point < 0x110000 && expression.test(String.fromCodePoint(point));
    if (member && start === null) start = point;
    if (!member && start !== null) {
      const first = `\\x{${start.toString(16)}}`;
      ranges.push(point - 1 === start ? first : `${first}-\\x{${(point - 1).toString(16)}}`);
      start = null;
    }
  }
  return ranges.join('');
}
const foldGroups = new Map();
const nameCases = [];
for (let point = 128; point <= 0x10ffff; point += 1) {
  const input = String.fromCodePoint(point);
  const normalized = input.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/giu, '').toLowerCase();
  if (normalized !== '') {
    if ([...normalized].length !== 1) throw new Error('Review multi-character Unicode normalization support');
    foldGroups.set(normalized, (foldGroups.get(normalized) ?? '') + input);
    nameCases.push({ name: `unicode-name-${point.toString(16)}`, input, outcome: { value: normalized } });
  }
}
for (const input of ['fate', 'ASSIMILAÇÃO', 'a\u0301s', 'Keep', 'ſẛ', 'ＦＡＴＥ', '\u1c89fate', 'fate\u{10d40}', 'ligature-ﬁ']) {
  nameCases.push({ name: `name-${nameCases.length + 1}`, input,
    outcome: { value: input.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/giu, '').toLowerCase() },
  });
}
const foldSource = [...foldGroups].map(([base, characters]) => `\t'${base}': ${JSON.stringify(characters)},`).join('\n');
const unicodeSource = `// Code generated by scripts/generate-go-system-fixtures.mjs; DO NOT EDIT.\n// JavaScript Unicode ${process.versions.unicode}, TypeScript oracle @erpg/dicecore 3.7.1.\npackage dicecore\n\nconst systemLetterRanges = ${JSON.stringify(unicodePropertyRanges('L'))}\nconst systemNumberRanges = ${JSON.stringify(unicodePropertyRanges('N'))}\n\n// NFD plus the exact reference Diacritic/ASCII case-fold filtering pipeline.\n// This deliberately excludes compatibility decomposition (NFKD).\nvar systemNameFolds = map[rune]string{\n${foldSource}\n}\n`;
const unicodePath = new URL('../go/system_unicode.go', import.meta.url);
if (mode === '--check') {
  if (readFileSync(unicodePath, 'utf8') !== unicodeSource) throw new Error('Changed JavaScript Unicode name categories');
} else writeFileSync(unicodePath, unicodeSource);

for (const [filename, cases] of [['systems-rolls', fixtures], ['systems-contracts', contracts], ['systems-selection', selections], ['systems-names', nameCases]]) {
  const data = `${JSON.stringify({ schemaVersion: 1, provenance: { package: '@erpg/dicecore', version: '3.7.1', commit: '1940044' }, cases }, null, 2)}\n`;
  const path = new URL(`../go/testdata/${filename}.json`, import.meta.url);
  if (mode === '--check') {
    if (readFileSync(path, 'utf8') !== data) throw new Error(`Changed fixture: ${filename}`);
  } else writeFileSync(path, data);
  process.stdout.write(`${mode === '--check' ? 'Verified' : 'Wrote'} ${filename}: ${cases.length} cases\n`);
}
