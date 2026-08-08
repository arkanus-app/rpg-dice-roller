import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const maximumPackedSize = 90 * 1024;
const maximumUnpackedSize = 375 * 1024;
const maximumRootEsmGzipSize = 28 * 1024;
const maximumCoreEsmGzipSize = 21 * 1024;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tscExecutable = resolve(root, 'node_modules/typescript/bin/tsc');
const npmExecutable = process.env['npm_execpath'];

if (!npmExecutable) {
  throw new Error('npm_execpath is unavailable');
}
const ignoredJavaScriptDirectories = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
]);
const allowedJavaScriptFiles = new Set([
  resolve(root, 'rollup.config.mjs'),
  resolve(root, 'src/parser/grammars/grammar.js'),
]);
const javaScriptExtensions = ['.cjs', '.js', '.mjs'] as const;

interface PackResult {
  readonly filename: string;
  readonly size: number;
  readonly unpackedSize: number;
}

const run = (command: string, arguments_: readonly string[], cwd = root): string => {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error([
      `${command} exited with status ${result.status ?? 'unknown'}`,
      result.stdout.trim(),
    ].filter((line) => line.length > 0).join('\n'));
  }

  return result.stdout;
};

const runNpm = (arguments_: readonly string[], cwd = root): string => run(
  process.execPath,
  [npmExecutable, ...arguments_],
  cwd,
);

const parsePackResult = (output: string): PackResult => {
  const value = JSON.parse(output) as unknown;

  if (!Array.isArray(value) || value.length !== 1) {
    throw new TypeError('npm pack returned an unexpected result');
  }

  const entry: unknown = value[0];

  if (
    typeof entry !== 'object'
    || entry === null
    || !('filename' in entry)
    || typeof entry.filename !== 'string'
    || !('size' in entry)
    || typeof entry.size !== 'number'
    || !('unpackedSize' in entry)
    || typeof entry.unpackedSize !== 'number'
  ) {
    throw new TypeError('npm pack metadata is invalid');
  }

  return {
    filename: entry.filename,
    size: entry.size,
    unpackedSize: entry.unpackedSize,
  };
};

const findAuthoredJavaScript = (directory: string): readonly string[] => readdirSync(
  directory,
  { withFileTypes: true },
).flatMap((entry) => {
  const path = resolve(directory, entry.name);

  if (entry.isDirectory()) {
    return ignoredJavaScriptDirectories.has(entry.name)
      ? []
      : findAuthoredJavaScript(path);
  }

  if (
    entry.isFile()
    && javaScriptExtensions.some((extension) => entry.name.endsWith(extension))
    && !allowedJavaScriptFiles.has(path)
  ) {
    return [path];
  }

  return [];
});

const authoredJavaScript = findAuthoredJavaScript(root);

if (authoredJavaScript.length > 0) {
  throw new Error(`Authored JavaScript found outside build output:\n${authoredJavaScript.join('\n')}`);
}

const measureEsmClosure = (entry: string): number => {
  const pending = [resolve(root, entry)];
  const visited = new Set<string>();
  const sources: string[] = [];
  const importPattern = /(?:\bfrom\s*|\bimport\s*)(?:\(\s*)?['"](\.[^'"]+)['"]/gu;

  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || visited.has(path)) {
      continue;
    }
    visited.add(path);
    const source = readFileSync(path, 'utf8');
    sources.push(source);
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        pending.push(resolve(dirname(path), specifier));
      }
    }
  }

  return gzipSync(sources.join('\n')).byteLength;
};

const rootEsmGzipSize = measureEsmClosure('dist/index.js');
const coreEsmGzipSize = measureEsmClosure('dist/core.js');
if (rootEsmGzipSize > maximumRootEsmGzipSize) {
  throw new Error(
    `Root ESM graph is ${rootEsmGzipSize} bytes gzip; limit is ${maximumRootEsmGzipSize}`,
  );
}
if (coreEsmGzipSize > maximumCoreEsmGzipSize) {
  throw new Error(
    `Core ESM graph is ${coreEsmGzipSize} bytes gzip; limit is ${maximumCoreEsmGzipSize}`,
  );
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'dicecore-package-'));

try {
  const packResult = parsePackResult(runNpm([
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    temporaryDirectory,
  ]));

  if (packResult.size > maximumPackedSize) {
    throw new Error(
      `Package is ${packResult.size} bytes packed; limit is ${maximumPackedSize}`,
    );
  }

  if (packResult.unpackedSize > maximumUnpackedSize) {
    throw new Error(
      `Package is ${packResult.unpackedSize} bytes unpacked; limit is ${maximumUnpackedSize}`,
    );
  }

  const tarballPath = join(temporaryDirectory, packResult.filename);

  // The package requires Node.js 22. Node 10 cannot resolve package-export
  // subpaths by design, so require the modern Node/CJS/ESM and bundler matrix.
  runNpm(['exec', '--', 'attw', tarballPath, '--profile', 'node16']);

  writeFileSync(
    join(temporaryDirectory, 'package.json'),
    JSON.stringify({ name: 'dicecore-package-check', private: true }),
  );
  writeFileSync(
    join(temporaryDirectory, 'smoke.mjs'),
    "import { createSystemRoller, evaluateAssimilationSelection, rollAssimilation, rollDaggerheart, rollFateDice, rollMixedDice, rollRpgDice, rollRpgDiceDetails, rollRpgDiceSummary, rollVampireV5 } from '@erpg/dicecore';\nimport { createDiceEngine } from '@erpg/dicecore/core';\nimport { rollFateDice as rollFateSubpath } from '@erpg/dicecore/systems/fate';\nimport { rollMixedDice as rollMixedSubpath } from '@erpg/dicecore/systems/mixed';\nif ([createDiceEngine, createSystemRoller, evaluateAssimilationSelection, rollAssimilation, rollDaggerheart, rollFateDice, rollFateSubpath, rollMixedDice, rollMixedSubpath, rollRpgDice, rollRpgDiceDetails, rollRpgDiceSummary, rollVampireV5].some((value) => typeof value !== 'function')) throw new TypeError('Missing ESM export');\n",
  );
  writeFileSync(
    join(temporaryDirectory, 'smoke.cjs'),
    "const { createSystemRoller, evaluateAssimilationSelection, rollAssimilation, rollDaggerheart, rollFateDice, rollMixedDice, rollRpgDice, rollRpgDiceDetails, rollRpgDiceSummary, rollVampireV5 } = require('@erpg/dicecore');\nconst { createDiceEngine } = require('@erpg/dicecore/core');\nconst { rollFateDice: rollFateSubpath } = require('@erpg/dicecore/systems/fate');\nif ([createDiceEngine, createSystemRoller, evaluateAssimilationSelection, rollAssimilation, rollDaggerheart, rollFateDice, rollFateSubpath, rollMixedDice, rollRpgDice, rollRpgDiceDetails, rollRpgDiceSummary, rollVampireV5].some((value) => typeof value !== 'function')) throw new TypeError('Missing CJS export');\n",
  );
  writeFileSync(
    join(temporaryDirectory, 'smoke.mts'),
    "import { createSystemRoller, evaluateAssimilationSelection, rollAssimilation, rollDaggerheart, rollFateDice, rollMixedDice, rollRpgDice, rollRpgDiceDetails, rollRpgDiceSummary, rollVampireV5, type AssimilationRollResult, type DaggerheartRollResult, type DiceRollDetails, type DiceRollResult, type DiceRollSummary, type FateRollResult, type MixedRollResult, type VampireV5RollResult } from '@erpg/dicecore';\nimport { createDiceEngine } from '@erpg/dicecore/core';\nconst result: DiceRollResult = rollRpgDice('1d6', { seed: 'package-check-esm' });\nconst details: DiceRollDetails = rollRpgDiceDetails('1d6', { seed: 'package-check-details' });\nconst summary: DiceRollSummary = rollRpgDiceSummary('1d6', { seed: 'package-check-summary' });\nconst vampire: VampireV5RollResult = rollVampireV5({ pool: 2, hunger: 1 }, { seed: 'package-check-vampire' });\nconst assimilation: AssimilationRollResult = rollAssimilation({ d6: 1 }, { seed: 'package-check-assimilation' });\nconst fate: FateRollResult = rollFateDice(undefined, { seed: 'package-check-fate' });\nconst daggerheart: DaggerheartRollResult = rollDaggerheart(undefined, { seed: 'package-check-daggerheart' });\nconst mixed: MixedRollResult = rollMixedDice('1d6; fate(1)', { seed: 'package-check-mixed' });\ncreateSystemRoller(createDiceEngine()).rollFateDice(undefined, { detail: 'compact', seed: 'compact' });\nevaluateAssimilationSelection(assimilation, [assimilation.dice[0]!.id]);\nvoid result; void details; void summary; void vampire; void fate; void daggerheart; void mixed;\n",
  );
  writeFileSync(
    join(temporaryDirectory, 'smoke.cts'),
    "import dicecore = require('@erpg/dicecore');\nconst total: number = dicecore.rollRpgDice('1d6', { seed: 'package-check-cjs' }).total;\nvoid total;\n",
  );
  writeFileSync(
    join(temporaryDirectory, 'negative.mts'),
    "import { rollRpgDice } from '@erpg/dicecore';\n// @ts-expect-error V2 internals are not exported by V3.\nimport { parseRpgDiceInput } from '@erpg/dicecore';\n// @ts-expect-error Package exports prevent internal deep imports.\nimport '@erpg/dicecore/dist/v3/executor.js';\n// @ts-expect-error Results expose readonly collections.\nrollRpgDice('1d6', { seed: 'readonly' }).dice.push();\n",
  );
  writeFileSync(
    join(temporaryDirectory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        noUncheckedSideEffectImports: true,
        skipLibCheck: false,
        strict: true,
        target: 'ES2022',
      },
      files: ['smoke.mts', 'smoke.cts', 'negative.mts'],
    }),
  );

  runNpm([
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    tarballPath,
  ], temporaryDirectory);
  run(process.execPath, ['smoke.mjs'], temporaryDirectory);
  run(process.execPath, ['smoke.cjs'], temporaryDirectory);
  run(process.execPath, [tscExecutable, '-p', 'tsconfig.json'], temporaryDirectory);

  console.log(
    `Package verified: ${packResult.filename} (${packResult.size} bytes packed, ${packResult.unpackedSize} bytes unpacked, ${rootEsmGzipSize} bytes root ESM gzip, ${coreEsmGzipSize} bytes core ESM gzip)`,
  );
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
