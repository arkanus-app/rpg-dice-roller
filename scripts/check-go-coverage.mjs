import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Parse every measured block, preserving exact statement counts. */
export function parseGoCoverage(text) {
  if (text.trim() === '') throw new Error('Go coverage profile is empty');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const header = /^mode: (set|count|atomic)$/.exec(lines[0]);
  if (!header) throw new Error('Malformed Go coverage profile: expected mode: set, count, or atomic');

  const blocks = new Map();
  for (let index = 1; index < lines.length; index += 1) {
    const match = /^(.+):(\d+)\.(\d+),(\d+)\.(\d+) (\d+) (\d+)$/.exec(lines[index]);
    const malformed = () => new Error(`Malformed Go coverage profile at line ${index + 1}: ${lines[index]}`);
    if (!match) throw malformed();
    const [, filename, startLineText, startColumnText, endLineText, endColumnText, statementsText, countText] = match;
    const [startLine, startColumn, endLine, endColumn, statements, count] =
      [startLineText, startColumnText, endLineText, endColumnText, statementsText, countText].map(BigInt);
    if (startLine < 1n || startColumn < 1n || endLine < startLine || endColumn < 1n
      || (endLine === startLine && endColumn < startColumn)
      || (header[1] === 'set' && count > 1n)) throw malformed();

    const location = `${filename}:${startLine}.${startColumn},${endLine}.${endColumn}`;
    const previous = blocks.get(location);
    if (previous && previous.statements !== statements) throw malformed();
    // go test -coverpkg=./... may repeat a block from multiple test binaries.
    // Like go tool cover, combine identical blocks without counting them twice.
    blocks.set(location, { location, statements, covered: count > 0n || previous?.covered === true });
  }

  let totalStatements = 0n;
  let coveredStatements = 0n;
  const uncoveredBlocks = [];
  for (const block of blocks.values()) {
    totalStatements += block.statements;
    if (block.covered) coveredStatements += block.statements;
    else if (block.statements > 0n) uncoveredBlocks.push(block);
  }
  if (totalStatements === 0n) throw new Error('Go coverage profile contains no measured statements');
  return { mode: header[1], totalStatements, coveredStatements, uncoveredBlocks };
}

function main() {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/check-go-coverage.mjs <coverage-profile>');
  const filename = process.argv[2];
  const { totalStatements, coveredStatements, uncoveredBlocks } = parseGoCoverage(readFileSync(filename, 'utf8'));
  const summary = `${coveredStatements}/${totalStatements} Go statements covered in ${filename}`;
  if (uncoveredBlocks.length > 0) {
    process.stderr.write(`${summary}; ${totalStatements - coveredStatements} uncovered statements.\n`);
    for (const block of uncoveredBlocks) {
      process.stderr.write(`  ${block.location}: ${block.statements} uncovered statements\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write(`${summary} (100%).\n`);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
