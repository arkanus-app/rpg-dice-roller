const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const typesDir = path.join(root, 'types');
const dtsPath = path.join(typesDir, 'index.d.ts');
const ctsPath = path.join(typesDir, 'index.d.cts');
const tscBin = path.join(
  root,
  'node_modules',
  'typescript',
  'bin',
  'tsc',
);

fs.rmSync(typesDir, { recursive: true, force: true });

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
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

fs.copyFileSync(dtsPath, ctsPath);
