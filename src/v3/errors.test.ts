import { describe, expect, it } from 'vitest';
import { DiceRollError, isDiceRollError, isDiceRollErrorData } from './errors.js';

describe('DiceRollError cross-realm data', () => {
  it('round-trips JSON-safe error data', () => {
    const original = new DiceRollError('Bad notation', {
      code: 'INVALID_NOTATION',
      input: '1d',
      span: { start: 1, end: 2 },
      details: { token: 'd', nested: [true, null, 2] },
    });
    const data: unknown = JSON.parse(JSON.stringify(original));

    expect(isDiceRollErrorData(data)).toBe(true);
    const restored = DiceRollError.fromJSON(data);
    expect(isDiceRollError(restored)).toBe(true);
    expect(restored.toJSON()).toEqual(original.toJSON());
  });

  it('rejects malformed, cyclic and getter-backed data safely', () => {
    expect(isDiceRollErrorData(null)).toBe(false);
    expect(isDiceRollErrorData({
      name: 'DiceRollError',
      code: 'NOT_A_CODE',
      message: 'x',
      span: null,
      input: '',
      details: {},
    })).toBe(false);

    const details: { self?: unknown } = {};
    details.self = details;
    expect(isDiceRollErrorData({
      name: 'DiceRollError',
      code: 'INVALID_NOTATION',
      message: 'x',
      span: null,
      input: '',
      details,
    })).toBe(false);

    const hostile = Object.defineProperty({}, 'name', {
      enumerable: true,
      get(): never {
        throw new Error('hostile');
      },
    });
    expect(isDiceRollErrorData(hostile)).toBe(false);
    expect(() => DiceRollError.fromJSON(hostile)).toThrow(
      expect.objectContaining({ code: 'INVALID_ERROR_DATA' }),
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(isDiceRollErrorData(revoked.proxy)).toBe(false);
  });

  it('rejects invalid spans and non-JSON details', () => {
    const base = {
      name: 'DiceRollError',
      code: 'INVALID_NOTATION',
      message: 'x',
      input: '',
    } as const;
    expect(isDiceRollErrorData({ ...base, span: { start: 2, end: 1 }, details: {} }))
      .toBe(false);
    expect(isDiceRollErrorData({ ...base, span: null, details: { bad: Number.NaN } }))
      .toBe(false);
    expect(isDiceRollErrorData({ ...base, span: 'bad', details: {} })).toBe(false);
    expect(isDiceRollErrorData({ ...base, span: null, details: { bad: undefined } })).toBe(false);

    const hostileSpan = Object.defineProperty({}, 'start', {
      get(): never {
        throw new Error('hostile span');
      },
    });
    expect(isDiceRollErrorData({ ...base, span: hostileSpan, details: {} })).toBe(false);
    const hostileDetails = new Proxy({}, {
      ownKeys(): never {
        throw new Error('hostile details');
      },
    });
    expect(isDiceRollErrorData({ ...base, span: null, details: hostileDetails })).toBe(false);
  });
});
