import {
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const typesDir = join(root, 'dist');
const tscBin = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

const createCommonJsDeclarations = (directory: string): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      createCommonJsDeclarations(path);
    } else if (entry.isFile() && entry.name.endsWith('.d.ts')) {
      const declaration = readFileSync(path, 'utf8');
      const commonJsDeclaration = declaration.replace(
        /(['"])(\.\.?\/[^'"]+)\.js\1/gu,
        '$1$2.cjs$1',
      );
      const commonJsPath = `${path.slice(0, -'.d.ts'.length)}.d.cts`;

      writeFileSync(commonJsPath, commonJsDeclaration, 'utf8');
    }
  }
};

const removeDeclarations = (directory: string): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      removeDeclarations(path);
    } else if (entry.isFile() && (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.cts'))) {
      unlinkSync(path);
    }
  }
};

removeDeclarations(typesDir);

const result = spawnSync(
  process.execPath,
  [tscBin, '-p', 'declaration.tsconfig.json'],
  {
    cwd: root,
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(result.error);
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  createCommonJsDeclarations(typesDir);
}
