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

const maximumPackedSize = 70 * 1024;
const maximumUnpackedSize = 350 * 1024;
const maximumEsmGzipSize = 25 * 1024;
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
const generatedJavaScriptFiles = new Set([
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
    && !generatedJavaScriptFiles.has(path)
  ) {
    return [path];
  }

  return [];
});

const authoredJavaScript = findAuthoredJavaScript(root);

if (authoredJavaScript.length > 0) {
  throw new Error(`Authored JavaScript found outside build output:\n${authoredJavaScript.join('\n')}`);
}

const esmGzipSize = gzipSync(readFileSync(resolve(root, 'dist/index.js'))).byteLength;
if (esmGzipSize > maximumEsmGzipSize) {
  throw new Error(
    `ESM bundle is ${esmGzipSize} bytes gzip; limit is ${maximumEsmGzipSize}`,
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

  runNpm(['exec', '--', 'attw', tarballPath]);

  writeFileSync(
    join(temporaryDirectory, 'package.json'),
    JSON.stringify({ name: 'dicecore-package-check', private: true }),
  );
  writeFileSync(
    join(temporaryDirectory, 'smoke.mjs'),
    "import { rollRpgDice, rollRpgDiceSummary } from '@erpg/dicecore';\nif (typeof rollRpgDice !== 'function' || typeof rollRpgDiceSummary !== 'function') throw new TypeError('Missing ESM export');\n",
  );
  writeFileSync(
    join(temporaryDirectory, 'smoke.cjs'),
    "const { rollRpgDice, rollRpgDiceSummary } = require('@erpg/dicecore');\nif (typeof rollRpgDice !== 'function' || typeof rollRpgDiceSummary !== 'function') throw new TypeError('Missing CJS export');\n",
  );
  writeFileSync(
    join(temporaryDirectory, 'smoke.mts'),
    "import { rollRpgDice, rollRpgDiceSummary, type DiceRollResult, type DiceRollSummary } from '@erpg/dicecore';\nconst result: DiceRollResult = rollRpgDice('1d6', { seed: 'package-check-esm' });\nconst summary: DiceRollSummary = rollRpgDiceSummary('1d6', { seed: 'package-check-summary' });\nvoid result;\nvoid summary;\n",
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
    `Package verified: ${packResult.filename} (${packResult.size} bytes packed, ${packResult.unpackedSize} bytes unpacked, ${esmGzipSize} bytes ESM gzip)`,
  );
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
