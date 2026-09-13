import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseGoCoverage } from './check-go-coverage.mjs';

const executable = fileURLToPath(new URL('./check-go-coverage.mjs', import.meta.url));

function runProfile(t, text) {
  const directory = mkdtempSync(join(tmpdir(), 'dicecore-go-coverage-'));
  const path = join(directory, 'coverage.out');
  writeFileSync(path, text);
  t.after(() => {
    unlinkSync(path);
    rmdirSync(directory);
  });
  const result = spawnSync(process.execPath, [executable, path], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return result;
}

for (const [mode, count] of [['set', '1'], ['count', '9'], ['atomic', '9223372036854775807']]) {
  test(`accepts complete ${mode} profiles through the CLI`, (t) => {
    const text = `mode: ${mode}\nexample/go/a.go:1.1,2.2 3 ${count}\nexample/go/b.go:4.2,5.3 2 1\n`;
    const profile = parseGoCoverage(text);
    assert.equal(profile.mode, mode);
    assert.equal(profile.totalStatements, 5n);
    assert.equal(profile.coveredStatements, 5n);
    assert.deepEqual(profile.uncoveredBlocks, []);
    const result = runProfile(t, text);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /5\/5 Go statements covered.*\(100%\)/);
    assert.equal(result.stderr, '');
  });
}

test('fails uncovered statements even when a display would round to 100.0%', (t) => {
  assert.equal((99999 / 100000 * 100).toFixed(1), '100.0');
  const result = runProfile(t,
    'mode: atomic\nexample/go/a.go:1.1,2.2 99999 1\nexample/go/b.go:4.2,5.3 1 0\n');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /99999\/100000 Go statements covered/);
  assert.match(result.stderr, /example\/go\/b.go:4\.2,5\.3: 1 uncovered statements/);
});

test('preserves exact counts and reports every uncovered source block', () => {
  const profile = parseGoCoverage('mode: count\na.go:1.1,2.1 9007199254740993 3\nb.go:3.1,4.1 2 0\nc.go:5.1,6.1 3 0');
  assert.equal(profile.totalStatements, 9007199254740998n);
  assert.equal(profile.coveredStatements, 9007199254740993n);
  assert.deepEqual(profile.uncoveredBlocks.map(({ location, statements }) => [location, statements]), [
    ['b.go:3.1,4.1', 2n], ['c.go:5.1,6.1', 3n],
  ]);
});

test('combines repeated blocks from different test binaries without hiding another uncovered block', () => {
  const profile = parseGoCoverage('mode: atomic\na.go:1.1,2.1 3 0\na.go:1.1,2.1 3 1\nb.go:3.1,4.1 1 0\n');
  assert.equal(profile.totalStatements, 4n);
  assert.equal(profile.coveredStatements, 3n);
  assert.equal(profile.uncoveredBlocks[0].location, 'b.go:3.1,4.1');
});

test('accepts CRLF, paths with colons/spaces, and zero-statement blocks', () => {
  const profile = parseGoCoverage('mode: set\r\nC:/Go Project/a.go:1.1,1.2 0 0\r\nC:/Go Project/a.go:2.1,3.2 1 1\r\n');
  assert.equal(profile.totalStatements, 1n);
  assert.equal(profile.coveredStatements, 1n);
});

test('rejects empty or malformed profiles', () => {
  for (const text of [
    '', ' \r\n', 'mode: set\n', 'mode: unknown\na.go:1.1,2.1 1 1\n',
    'a.go:1.1,2.1 1 1\n', 'mode: set\na.go:1.1,2.1 0 0\n',
    'mode: count\nbroken\n', 'mode: count\na.go:0.1,2.1 1 1\n',
    'mode: count\na.go:1.0,2.1 1 1\n', 'mode: count\na.go:2.1,1.1 1 1\n',
    'mode: count\na.go:1.3,1.2 1 1\n', 'mode: count\na.go:1.1,2.1 -1 1\n',
    'mode: count\na.go:1.1,2.1 1 -1\n', 'mode: count\na.go:1.1,2.1 1 1.5\n',
    'mode: count\na.go:1.1,2.1 1 1 trailing\n', 'mode: set\na.go:1.1,2.1 1 2\n',
    'mode: count\na.go:1.1,2.1 1 1\n\n',
    'mode: count\na.go:1.1,2.1 1 1\na.go:1.1,2.1 2 1\n',
  ]) assert.throws(() => parseGoCoverage(text), /empty|Malformed|no measured statements/);
});

test('the CLI fails empty and malformed files with an explanation', (t) => {
  for (const text of ['', 'mode: count\nbroken\n']) {
    const result = runProfile(t, text);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /empty|Malformed/);
  }
});

test('the CLI rejects a missing file or missing argument', () => {
  const missing = spawnSync(process.execPath, [executable, fileURLToPath(new URL('./missing-coverage-profile.out', import.meta.url))], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ENOENT/);
  const usage = spawnSync(process.execPath, [executable], { encoding: 'utf8' });
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /Usage:/);
});
