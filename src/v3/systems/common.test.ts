import { describe, expect, test } from 'vitest';
import { isDiceRollErrorData } from '../errors.js';
import type { ResolvedDie } from '../types.js';
import {
  createSystemDieResult,
  readRequiredSystemInteger,
  readSystemInput,
} from './common.js';

describe('system dice common contracts', () => {
  test('creates a stable semantic projection linked to its base die', () => {
    const source: ResolvedDie = {
      id: 'roll-1-die-1',
      sourceNodeId: 'dice@0:3',
      parentDieId: null,
      rollIndex: 1,
      rollDieIndex: 1,
      groupId: 'roll-1:group:dice@0:3',
      sides: 6,
      rawValue: 5,
      value: 5,
      contribution: 5,
      included: true,
      states: [],
    };
    const die = createSystemDieResult(
      source,
      'test-d6',
      'test',
      'five',
      ['symbol'],
    );

    expect(die).toEqual({
      id: 'test-d6:roll-1-die-1',
      sourceDieId: 'roll-1-die-1',
      sides: 6,
      value: 5,
      rawValue: 5,
      profileId: 'test-d6',
      dieKind: 'test',
      faceKey: 'five',
      symbols: ['symbol'],
    });
  });

  test('rejects non-numeric dice and serializes system validation errors', () => {
    const fudge: ResolvedDie = {
      id: 'fudge',
      sourceNodeId: 'fudge',
      parentDieId: null,
      rollIndex: 1,
      rollDieIndex: 1,
      groupId: 'fudge',
      sides: 'F',
      rawValue: 0,
      value: 0,
      contribution: 0,
      included: true,
      states: [],
    };
    expect(() => createSystemDieResult(fudge, 'test', 'test', 'zero', []))
      .toThrow(TypeError);

    let serialized: unknown;
    try {
      readRequiredSystemInteger(
        readSystemInput({}, 'assimilation'),
        'assimilation',
        'pool',
        1,
      );
    } catch (error: unknown) {
      serialized = error instanceof Error && 'toJSON' in error
        ? (error as { toJSON(): unknown }).toJSON()
        : null;
    }
    expect(serialized).toMatchObject({ code: 'INVALID_SYSTEM_INPUT' });
    expect(isDiceRollErrorData(serialized)).toBe(true);
  });

  test('normalizes hostile system input access', () => {
    const hostile = Object.defineProperty({}, 'pool', {
      get(): never {
        throw new Error('hostile getter');
      },
    });
    expect(() => readRequiredSystemInteger(
      readSystemInput(hostile, 'vampire-v5'),
      'vampire-v5',
      'pool',
      1,
    )).toThrow(expect.objectContaining({ code: 'INVALID_SYSTEM_INPUT' }));

    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => readSystemInput(proxy, 'assimilation'))
      .toThrow(expect.objectContaining({ code: 'INVALID_SYSTEM_INPUT' }));
  });
});
