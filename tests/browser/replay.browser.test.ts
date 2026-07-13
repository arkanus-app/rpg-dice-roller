import { describe, expect, it } from 'vitest';
import { rollRpgDice } from '../../dist/index.js';
import { crossRuntimeReplayVectors } from '../../scripts/replay-vectors.js';

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

describe('cross-runtime deterministic replay', () => {
  it('matches the byte-identical Node 22 reference for both algorithms', async () => {
    const referenceUrl = new URL('../../dist/replay-reference.json', import.meta.url);
    const response = await fetch(referenceUrl);
    expect(response.ok).toBe(true);
    const reference = parseReference(await response.json());

    expect(reference.vectors).toHaveLength(crossRuntimeReplayVectors.length);
    for (const [index, vector] of crossRuntimeReplayVectors.entries()) {
      const expected = reference.vectors[index];
      expect(expected?.name).toBe(vector.name);
      const first = JSON.stringify(rollRpgDice(vector.input, vector.options));
      const second = JSON.stringify(rollRpgDice(vector.input, vector.options));
      expect(first).toBe(expected?.json);
      expect(second).toBe(first);
    }
  });
});
