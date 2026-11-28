import { describe, expect, it } from 'vitest';
import { randomId, uuidV4 } from './uuid.ts';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidV4', () => {
  it('sets the version and variant bits whatever the random bytes are', () => {
    for (const fill of [0x00, 0xff, 0x5a]) expect(uuidV4((a) => a.fill(fill))).toMatch(V4);
  });
  it('is made of the random bytes in order', () => {
    expect(uuidV4((a) => a.map((_, i) => i))).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });
  it('differs between calls on real randomness', () => {
    const real = (a: Uint8Array): Uint8Array => globalThis.crypto.getRandomValues(a);
    expect(uuidV4(real)).not.toBe(uuidV4(real));
  });
});

describe('randomId', () => {
  it('uses randomUUID when the context has it, so the web build is unchanged', () => {
    expect(randomId({ randomUUID: () => 'from-the-browser', getRandomValues: () => { throw new Error('unused'); } })).toBe('from-the-browser');
  });
  it('falls back to getRandomValues without randomUUID (a context that is not secure)', () => {
    expect(randomId({ getRandomValues: ((a: Uint8Array) => a.fill(1)) as never })).toMatch(V4);
  });
});
