import { describe, expect, it, vi } from 'vitest';
import { createEmitter } from './events.ts';

describe('createEmitter', () => {
  it('delivers in subscription order and unsubscribes', () => {
    const e = createEmitter<number>();
    const seen: string[] = [];
    const off1 = e.on((v) => seen.push(`a${v}`));
    e.on((v) => seen.push(`b${v}`));
    e.emit(1);
    off1();
    off1();
    e.emit(2);
    expect(seen).toEqual(['a1', 'b1', 'b2']);
  });

  it('subscribing the same function twice gives independent handles', () => {
    const e = createEmitter<number>();
    const fn = vi.fn();
    const off1 = e.on(fn);
    e.on(fn);
    off1();
    e.emit(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('changes during emit apply to the next emit', () => {
    const e = createEmitter<number>();
    const late = vi.fn();
    let offSelf = (): void => {};
    const self = vi.fn(() => {
      offSelf();
      e.on(late);
    });
    offSelf = e.on(self);
    const other = vi.fn();
    e.on(other);
    e.emit(1);
    expect(self).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();
    e.emit(2);
    expect(self).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener does not starve the others; the first error is rethrown', () => {
    const e = createEmitter<number>();
    const ok = vi.fn();
    e.on(() => {
      throw new Error('boom');
    });
    e.on(ok);
    expect(() => e.emit(1)).toThrow('boom');
    expect(ok).toHaveBeenCalledWith(1);
  });

  it('clear removes every listener', () => {
    const e = createEmitter<number>();
    const fn = vi.fn();
    const off = e.on(fn);
    e.clear();
    e.emit(1);
    off();
    expect(fn).not.toHaveBeenCalled();
  });
});
