import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFontCap, FONT_CAP_MS, FONT_PROBES, type FontSetLike } from './font-loading.ts';

class FakeRoot {
  readonly attrs = new Map<string, string>();
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
}
const root = (): FakeRoot => new FakeRoot();
const attr = (el: FakeRoot): string | undefined => el.attrs.get('data-fonts');

describe('applyFontCap', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks for the display, text and music-text faces', () => {
    expect(FONT_PROBES.map((p) => p.font)).toEqual(['600 34px "Source Serif 4"', '400 16px "Inter"', '400 16px "Sightread Music Text"']);
    expect(FONT_PROBES[2]!.text).toBe('♩♪♭♮♯');
  });

  it('leaves the root alone when the fonts arrive before the cap', async () => {
    const el = root();
    const fonts: FontSetLike = { load: () => Promise.resolve([]) };
    await expect(applyFontCap(el as unknown as Element, fonts)).resolves.toBe('ready');
    await vi.advanceTimersByTimeAsync(FONT_CAP_MS * 2);
    expect(attr(el)).toBeUndefined();
  });

  it('shows the fallback stack at 300 ms and returns to the web fonts when they arrive', async () => {
    const el = root();
    const releases: (() => void)[] = [];
    const fonts: FontSetLike = { load: () => new Promise((r) => releases.push(() => r([]))) };
    const result = applyFontCap(el as unknown as Element, fonts);
    await vi.advanceTimersByTimeAsync(FONT_CAP_MS - 1);
    expect(attr(el)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(attr(el)).toBe('fallback');
    for (const r of releases) r();
    await expect(result).resolves.toBe('ready');
    expect(attr(el)).toBeUndefined();
  });

  it('keeps the fallback when a face fails to load', async () => {
    const el = root();
    const fonts: FontSetLike = { load: () => Promise.reject(new Error('404')) };
    await expect(applyFontCap(el as unknown as Element, fonts)).resolves.toBe('fallback');
    expect(attr(el)).toBe('fallback');
  });

  it('does nothing without a FontFaceSet', async () => {
    await expect(applyFontCap(root() as unknown as Element, undefined)).resolves.toBe('ready');
  });
});
