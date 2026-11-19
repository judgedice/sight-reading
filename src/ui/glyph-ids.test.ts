import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GLYPH_IDS, ICON_ALIAS_IDS, ICON_FAMILY_IDS, ICON_LEGACY_IDS, isGlyphId, PLUS_N_SLOT, RANK_GLYPH_IDS } from './glyph-ids.ts';
import { iconStrokeWidth } from './primitives/Glyph.tsx';

const svg = readFileSync(new URL('./glyphs.svg', import.meta.url), 'utf8');
const symbols = [...svg.matchAll(/<symbol\b([^>]*)>/g)].map((m) => m[1] ?? '');
const attr = (a: string, n: string): string | undefined => new RegExp(`\\b${n}="([^"]*)"`).exec(a)?.[1];

/** Every id in the 06 section 8 icon set (docs/redesign/06-design-spec.md). `close` is `x`, the UI check is `check-ui`. */
const SPEC_06_IDS = [
  'home',
  'settings',
  'chevron-left',
  'chevron-right',
  'chevron-down',
  'check-ui',
  'plus',
  'minus',
  'info',
  'x',
  'more',
  'arrow-right',
  'play',
  'stop',
  'listen',
  'metronome',
  'tuning-fork',
  'pitch',
  'key-chord',
  'note',
  'mic',
  'speaker',
  'headphones',
  'flame',
  'progress',
  'history',
  'practice',
  'skip',
  'retry',
  'caution',
  'lightbulb',
  'slower',
  // Instrument line icons (06 section 8, Instruments).
  'flute',
  'clarinet',
  'sax',
  'trumpet',
  'violin',
  'cello',
  'piano',
] as const;

/** Icon ids that src/ uses today (inline literals and the Glyph and EmptyState props). Each must keep resolving. */
const SRC_ICON_IDS = [
  'alert-octagon',
  'alert-triangle',
  'check',
  'check-circle',
  'chevron-down',
  'chevron-left',
  'chevron-right',
  'download',
  'info',
  'mic',
  'mic-off',
  'play',
  'plus-n',
  'settings',
  'stop',
  'trash',
  'upload',
  'volume-2',
  'x',
] as const;

/** Every .ts and .tsx file under src/ except tests. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Literal ids passed as icons in src: icon="x", icon: 'x', <Glyph id="x">, <VerdictGlyph id="x">. */
function literalIconIdsInSrc(): Set<string> {
  const found = new Set<string>();
  const patterns = [/\bicon(?:=|:\s*)(?:"|')([a-z][a-z0-9-]*)(?:"|')/g, /<Glyph\s+id="([a-z][a-z0-9-]*)"/g, /<VerdictGlyph\s+[^>]*?\bid="([a-z][a-z0-9-]*)"/g];
  for (const file of sourceFiles(fileURLToPath(new URL('../', import.meta.url)))) {
    const text = readFileSync(file, 'utf8');
    for (const re of patterns) for (const m of text.matchAll(re)) found.add(m[1] ?? '');
  }
  return found;
}

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

describe('icon family (06 section 8)', () => {
  it('lists every id in the 06 set, and each one resolves in the sprite', () => {
    for (const id of SPEC_06_IDS) {
      expect(GLYPH_IDS, id).toContain(id);
      expect(symbols.map((a) => attr(a, 'id')), id).toContain(id);
    }
    expect([...ICON_FAMILY_IDS].sort()).toEqual([...SPEC_06_IDS].sort());
  });
  it('the family symbols leave stroke width to Glyph, so the size rule applies', () => {
    for (const id of ICON_FAMILY_IDS) {
      const sym = symbols.find((a) => attr(a, 'id') === id) ?? '';
      expect(attr(sym, 'stroke-width'), id).toBeUndefined();
      expect(attr(sym, 'stroke'), id).toBe('currentColor');
      expect(attr(sym, 'stroke-linecap'), id).toBe('round');
    }
  });
  it('the stroke is 1.75 at 16, 20 and 24 px and 1.5 at 28 px and up', () => {
    expect([16, 20, 24].map(iconStrokeWidth)).toEqual([1.75, 1.75, 1.75]);
    expect([28, 32, 96].map(iconStrokeWidth)).toEqual([1.5, 1.5, 1.5]);
  });
  it('the alias and legacy ids are in the union and the sprite', () => {
    for (const id of [...ICON_ALIAS_IDS, ...ICON_LEGACY_IDS]) expect(GLYPH_IDS, id).toContain(id);
  });
});

describe('ids used in src keep resolving', () => {
  it('every id src uses today is in the union and the sprite', () => {
    const sprite = symbols.map((a) => attr(a, 'id'));
    for (const id of SRC_ICON_IDS) {
      expect(GLYPH_IDS, id).toContain(id);
      expect(sprite, id).toContain(id);
    }
  });
  it('every literal icon id found by scanning src is a glyph', () => {
    const found = literalIconIdsInSrc();
    expect(found.size).toBeGreaterThan(0);
    const unknown = [...found].filter((id) => !isGlyphId(id));
    expect(unknown).toEqual([]);
  });
});
