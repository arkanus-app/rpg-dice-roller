import {
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const typesDir = join(root, 'dist');
const tscBin = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

const typeEntrypoints = (value: unknown): readonly string[] => {
  if (typeof value === 'string') {
    return /\.d\.(?:cts|ts)$/u.test(value) ? [value.replace(/\.d\.cts$/u, '.d.ts')] : [];
  }
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap((entry: unknown) => typeEntrypoints(entry));
};

// TypeScript emits declarations for runtime internals too. Ship only the graph
// reachable from package entrypoints; deep imports are blocked by exports.
const prunePrivateDeclarations = (): void => {
  const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const pending = typeEntrypoints(manifest).map((entry) => resolve(root, entry));
  if (pending.length === 0) throw new Error('No public declaration entrypoints found');
  const reachable = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || reachable.has(path)) continue;
    reachable.add(path);
    const source = readFileSync(path, 'utf8');
    for (const reference of ts.preProcessFile(source, true).importedFiles) {
      if (reference.fileName.startsWith('.')) {
        pending.push(resolve(dirname(path), reference.fileName.replace(/\.js$/u, '.d.ts')));
      }
    }
  }
  const prune = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) prune(path);
      else if (entry.name.endsWith('.d.ts') && !reachable.has(path)) unlinkSync(path);
    }
  };
  prune(typesDir);
};

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
  prunePrivateDeclarations();
  createCommonJsDeclarations(typesDir);
}
