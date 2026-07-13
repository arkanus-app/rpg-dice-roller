import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { crossRuntimeReplayVectors } from './replay-vectors.js';

interface ReplayApi {
  rollRpgDice(input: string, options: object): unknown;
}

interface ReplayReferenceEntry {
  readonly json: string;
  readonly name: string;
}

interface ReplayReference {
  readonly schemaVersion: 1;
  readonly vectors: readonly ReplayReferenceEntry[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFunction(value: unknown): value is (...arguments_: readonly unknown[]) => unknown {
  return typeof value === 'function';
}

function loadApi(value: unknown): ReplayApi {
  if (!isObject(value) || !isFunction(value['rollRpgDice'])) {
    throw new TypeError('dist does not expose rollRpgDice');
  }
  const rollRpgDice = value['rollRpgDice'];
  return {
    rollRpgDice: (input, options) => rollRpgDice(input, options),
  };
}

function parseReference(value: unknown): ReplayReference {
  if (
    !isObject(value)
    || value['schemaVersion'] !== 1
    || !Array.isArray(value['vectors'])
  ) {
    throw new TypeError('Replay reference has an invalid schema');
  }

  const vectors: ReplayReferenceEntry[] = [];
  for (const entry of value['vectors']) {
    if (
      !isObject(entry)
      || typeof entry['name'] !== 'string'
      || typeof entry['json'] !== 'string'
    ) {
      throw new TypeError('Replay reference contains an invalid vector');
    }
    vectors.push({ json: entry['json'], name: entry['name'] });
  }
  return { schemaVersion: 1, vectors };
}

function createReference(api: ReplayApi): ReplayReference {
  return {
    schemaVersion: 1,
    vectors: crossRuntimeReplayVectors.map((vector) => ({
      json: JSON.stringify(api.rollRpgDice(vector.input, vector.options)),
      name: vector.name,
    })),
  };
}

function compareReferences(expected: ReplayReference, actual: ReplayReference): void {
  if (expected.vectors.length !== actual.vectors.length) {
    throw new Error('Replay vector count differs from the Node 22 reference');
  }

  for (let index = 0; index < expected.vectors.length; index += 1) {
    const expectedVector = expected.vectors[index];
    const actualVector = actual.vectors[index];
    if (expectedVector === undefined || actualVector === undefined) {
      throw new Error(`Replay vector ${index} is missing`);
    }
    if (expectedVector.name !== actualVector.name) {
      throw new Error(`Replay vector name differs at index ${index}`);
    }
    if (expectedVector.json !== actualVector.json) {
      throw new Error(`Replay output differs for ${expectedVector.name}`);
    }
  }
}

const mode = process.argv[2];
const outputPath = process.argv[3];
if ((mode !== '--write' && mode !== '--check') || outputPath === undefined) {
  throw new Error('Usage: replay-fixture.ts <--write|--check> <reference-path>');
}

const distModule: unknown = await import(new URL('../dist/index.js', import.meta.url).href);
const actual = createReference(loadApi(distModule));
const path = resolve(outputPath);

if (mode === '--write') {
  writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
  console.log(`Replay reference written to ${path}`);
} else {
  const expected = parseReference(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  compareReferences(expected, actual);
  console.log(`Replay reference verified against ${path}`);
}
