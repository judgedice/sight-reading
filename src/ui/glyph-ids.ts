// Glyph ids of the sprite in glyphs.svg (04 section 7.4). Kept in step with the sprite by glyph-ids.test.ts.

export const VERDICT_GLYPH_IDS = [
  'dot',
  'check',
  'check-marginal',
  'early',
  'late',
  'sharp',
  'flat',
  'wrong',
  'missed',
  'octave',
  'extra',
  'replay',
  'plus-n',
] as const;

export const GHOST_PART_GLYPH_IDS = ['ghost-head', 'arrow-up', 'arrow-down', 'ledger-dashed'] as const;

export const RANK_GLYPH_IDS = [
  'rank-1',
  'rank-2',
  'rank-3',
  'rank-4',
  'rank-5',
  'rank-6',
  'rank-7',
  'rank-8',
  'rank-9',
  'rank-10',
] as const;

/** Pinned Lucide subset (ISC): 20 px, 1.75 px stroke. */
export const ICON_GLYPH_IDS = [
  'mic',
  'mic-off',
  'settings',
  'dice',
  'play',
  'stop',
  'chevron-down',
  'chevron-left',
  'chevron-right',
  'x',
  'info',
  'alert-triangle',
  'alert-octagon',
  'check-circle',
  'download',
  'upload',
  'trash',
  'volume-2',
  'headphones',
  'bluetooth',
  'flame',
] as const;

export const GLYPH_IDS = [
  ...VERDICT_GLYPH_IDS,
  ...GHOST_PART_GLYPH_IDS,
  ...RANK_GLYPH_IDS,
  ...ICON_GLYPH_IDS,
] as const;

export type VerdictGlyphId = (typeof VERDICT_GLYPH_IDS)[number];
export type GhostPartGlyphId = (typeof GHOST_PART_GLYPH_IDS)[number];
export type RankGlyphId = (typeof RANK_GLYPH_IDS)[number];
export type IconGlyphId = (typeof ICON_GLYPH_IDS)[number];
export type GlyphId = (typeof GLYPH_IDS)[number];

/** Free area of `plus-n` (24-unit viewBox) where the overflow count is drawn. */
export const PLUS_N_SLOT = { x: 14.5, y: 6, w: 9, h: 12 } as const;

export function isGlyphId(s: string): s is GlyphId {
  return (GLYPH_IDS as readonly string[]).includes(s);
}
