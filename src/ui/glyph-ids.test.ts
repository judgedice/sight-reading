import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GLYPH_IDS, isGlyphId, PLUS_N_SLOT, RANK_GLYPH_IDS } from './glyph-ids.ts';

const svg = readFileSync(new URL('./glyphs.svg', import.meta.url), 'utf8');
const symbols = [...svg.matchAll(/<symbol\b([^>]*)>/g)].map((m) => m[1] ?? '');
const attr = (a: string, n: string): string | undefined => new RegExp(`\\b${n}="([^"]*)"`).exec(a)?.[1];

describe('glyph sprite', () => {
  it('has no duplicate ids in the union or the sprite', () => {
    expect(new Set(GLYPH_IDS).size).toBe(GLYPH_IDS.length);
    const ids = symbols.map((a) => attr(a, 'id'));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('every id in the union exists in the sprite and vice versa', () => {
    const ids = symbols.map((a) => attr(a, 'id') ?? '').sort();
    expect(ids).toEqual([...GLYPH_IDS].sort());
  });
  it('every symbol has a 24-unit viewBox', () => {
    for (const a of symbols) expect(attr(a, 'viewBox'), attr(a, 'id')).toBe('0 0 24 24');
  });
  it('is well formed: symbol open and close tags balance', () => {
    expect((svg.match(/<symbol\b/g) ?? []).length).toBe((svg.match(/<\/symbol>/g) ?? []).length);
  });
  it('has ten rank emblems with the 0.75 stroke (size / 32)', () => {
    expect(RANK_GLYPH_IDS).toHaveLength(10);
    for (const a of symbols.filter((x) => attr(x, 'id')?.startsWith('rank-'))) {
      expect(attr(a, 'stroke-width')).toBe('0.75');
    }
  });
  it('uses currentColor only (no hard-coded colours)', () => {
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?!["\w-])/);
    expect(svg).not.toMatch(/\b(?:rgb|hsl)a?\(/);
  });
  it('isGlyphId narrows', () => {
    expect(isGlyphId('check')).toBe(true);
    expect(isGlyphId('nope')).toBe(false);
  });
  it('plus-n slot fits inside the viewBox', () => {
    expect(PLUS_N_SLOT.x + PLUS_N_SLOT.w).toBeLessThanOrEqual(24);
    expect(PLUS_N_SLOT.y + PLUS_N_SLOT.h).toBeLessThanOrEqual(24);
  });
});
