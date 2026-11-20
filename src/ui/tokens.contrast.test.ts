// Contrast test (04 section 13.1 check 2): every pair in design/tokens.json is recomputed from the
// token values with the WCAG relative-luminance formula. Each ratio must meet its stated minimum,
// and each ratio the spec claims must be within 0.1 of the recomputed value.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
type ThemeValue = { light: string; dark: string };
type Group = Record<string, ThemeValue>;
interface Pair {
  id: string;
  fg: string;
  bg: string;
  min: number;
  claimed?: { light?: number; dark?: number };
  /** Draws the foreground at this opacity over the background. */
  fgOpacity?: number;
  /** The token a translucent background sits on. */
  bgUnder?: string;
  /** Applies the color.highContrast overrides first. */
  high?: boolean;
}
const source = JSON.parse(readFileSync(join(root, 'design/tokens.json'), 'utf8')) as {
  color: { ui: Group; paper: Group; highContrast: { ui: Group; paper: Group } };
  contrast: { pairs: Pair[] };
};

type Theme = 'light' | 'dark';
type Rgb = [number, number, number];

/** Parses #RRGGBB or rgba(r,g,b,a) into channels 0 to 255 and an alpha. */
function parseColour(value: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9A-Fa-f]{6})$/.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(value);
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
  throw new Error(`contrast: not a #RRGGBB or rgba() colour: ${value}`);
}

/** Source-over compositing of a colour at some opacity onto an opaque colour. */
function over(fg: { rgb: Rgb; alpha: number }, opacity: number, under: Rgb): Rgb {
  const a = fg.alpha * opacity;
  return [0, 1, 2].map((i) => fg.rgb[i]! * a + under[i]! * (1 - a)) as Rgb;
}

/** WCAG 2.x relative luminance of an opaque colour. */
export function relativeLuminance(rgb: Rgb): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG contrast ratio between two opaque colours, rounded to two decimals the way the spec states them. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return Math.round(ratio * 100) / 100;
}

/** Looks a token up in the ui group, then the paper group, with the high-contrast override first when asked. */
function token(name: string, theme: Theme, high: boolean): string {
  const v =
    (high ? source.color.highContrast.ui[name] ?? source.color.highContrast.paper[name] : undefined) ?? source.color.ui[name] ?? source.color.paper[name];
  if (!v) throw new Error(`contrast: unknown token ${name}`);
  return v[theme];
}

/** The pair's resolved opaque foreground and background. */
function resolvePair(pair: Pair, theme: Theme): { fg: Rgb; bg: Rgb; text: string } {
  const high = pair.high === true;
  const bgColour = parseColour(token(pair.bg, theme, high));
  const bgOpaque: Rgb =
    bgColour.alpha === 1
      ? bgColour.rgb
      : over(bgColour, 1, (() => {
          if (!pair.bgUnder) throw new Error(`contrast: ${pair.id}: ${pair.bg} is translucent, so the pair needs bgUnder`);
          const under = parseColour(token(pair.bgUnder, theme, high));
          if (under.alpha !== 1) throw new Error(`contrast: ${pair.id}: bgUnder ${pair.bgUnder} must be opaque`);
          return under.rgb;
        })());
  const fgColour = parseColour(token(pair.fg, theme, high));
  const fg = over(fgColour, pair.fgOpacity ?? 1, bgOpaque);
  return { fg, bg: bgOpaque, text: `${token(pair.fg, theme, high)} on ${token(pair.bg, theme, high)}` };
}

const themes: Theme[] = ['light', 'dark'];

/** Every pair in 06 section 3.3, by id. The table has 44 rows; each is one pair here, high contrast pairs are extra. */
const SPEC_3_3 = [
  'text-on-surface', 'text-on-bg', 'text-on-surface-2', 'text-on-selected', 'text-muted-on-surface', 'text-muted-on-bg',
  'text-muted-on-surface-2', 'text-muted-on-surface-2-pressed', 'text-muted-on-selected', 'on-accent-on-accent',
  'on-accent-on-accent-hover', 'on-accent-on-accent-pressed', 'border-strong-on-surface', 'border-strong-on-bg',
  'border-strong-on-surface-2', 'focus-ring-on-surface', 'focus-ring-on-bg', 'brass-on-surface', 'brass-on-paper',
  'brass-on-track', 'brass-ink-on-surface', 'brass-ink-on-brass-wash', 'danger-on-surface', 'on-danger-on-danger',
  'caution-on-surface', 'ink-on-paper', 'ink-on-playhead-bar', 'staff-line-on-paper', 'error-on-paper',
  'error-on-playhead-bar', 'error-70-on-paper', 'ghost-on-paper', 'ghost-70-on-paper', 'correct-on-paper',
  'ghost-replay-on-paper', 'range-full-on-paper', 'accent-on-range-full-bar', 'range-full-bar-on-track',
  'range-full-bar-on-selected', 'kb-black-on-kb-white', 'kb-black-on-kb-full', 'error-on-paper-high-contrast',
];

describe('contrast pairs from design/tokens.json', () => {
  it('lists every pair in 06 section 3.3 and the high contrast overrides', () => {
    const ids = new Set(source.contrast.pairs.map((p) => p.id));
    for (const id of SPEC_3_3) expect(ids.has(id), `missing pair ${id}`).toBe(true);
    for (const name of Object.keys(source.color.highContrast.ui).concat(Object.keys(source.color.highContrast.paper))) {
      const covered = source.contrast.pairs.some((p) => p.high === true && (p.fg === name || p.bg === name));
      expect(covered, `no high contrast pair uses the overridden token ${name}`).toBe(true);
    }
  });

  it('gives every pair a minimum of at least 1.5 and every text pair 4.5', () => {
    for (const p of source.contrast.pairs) {
      expect(p.min).toBeGreaterThanOrEqual(1.5);
      if (/^(?:text|text-muted|on-accent|on-danger|toast-text|brass-ink|caution|danger)-on-/.test(p.id)) expect(p.min).toBeGreaterThanOrEqual(4.5);
    }
  });

  for (const pair of source.contrast.pairs) {
    for (const theme of themes) {
      it(`${pair.id} (${theme}) meets ${pair.min}:1`, () => {
        const { fg, bg, text } = resolvePair(pair, theme);
        const ratio = contrastRatio(fg, bg);
        expect(ratio, `${pair.id} ${theme}: ${text} is ${ratio}:1`).toBeGreaterThanOrEqual(pair.min);

        const claim = pair.claimed?.[theme];
        if (claim !== undefined) {
          expect(Math.abs(ratio - claim), `${pair.id} ${theme}: claimed ${claim}, recomputed ${ratio}`).toBeLessThanOrEqual(0.1);
        }
      });
    }
  }
});

/**
 * High contrast over the take and results screens (designer's checks, 05 notes): every pair is recomputed with the
 * color.highContrast overrides applied, not only the pairs the table marks `high`. The take draws on paper (ink, staff
 * line, error, ghost, correct, the playhead bar) and results add the surface, text, brass and border pairs, so a
 * high contrast override that breaks a pair it does not name is caught here. High contrast never lowers a minimum.
 */
describe('contrast pairs under high contrast (take and results)', () => {
  const TAKE_AND_RESULTS = /^(?:ink|staff-line|error|ghost|correct|ghost-replay|text|text-muted|brass|brass-ink|border-strong|danger|on-danger|on-accent|focus-ring|caution)(?:-|$)/;
  const pairs = source.contrast.pairs.filter((p) => TAKE_AND_RESULTS.test(p.id));

  it('covers the paper pairs the take draws and the surface pairs results use', () => {
    const ids = new Set(pairs.map((p) => p.id));
    for (const id of ['ink-on-paper', 'ink-on-playhead-bar', 'staff-line-on-paper', 'error-on-paper', 'error-on-playhead-bar', 'ghost-on-paper', 'correct-on-paper', 'ghost-replay-on-paper', 'text-on-surface', 'text-muted-on-surface', 'brass-on-surface', 'border-strong-on-surface']) {
      expect(ids.has(id), `missing ${id}`).toBe(true);
    }
  });

  for (const pair of pairs) {
    for (const theme of themes) {
      it(`${pair.id} (${theme}, high contrast) meets ${pair.min}:1`, () => {
        const { fg, bg, text } = resolvePair({ ...pair, high: true }, theme);
        const ratio = contrastRatio(fg, bg);
        expect(ratio, `${pair.id} ${theme} high contrast: ${text} is ${ratio}:1`).toBeGreaterThanOrEqual(pair.min);
      });
    }
  }
});

/**
 * Note colours and grey marks (PLAN R69). Each letter's notehead colour and the greyed head of a wrong note are at
 * least 3:1 on the paper in light and dark and 4.5:1 under high contrast (the pairs above), and the heard-note marks
 * are a neutral grey in every theme: no hue a letter could be mistaken for, and nothing violet left.
 */
describe('note colours and grey marks (PLAN R69)', () => {
  const HEADS = ['head-c', 'head-d', 'head-e', 'head-f', 'head-g', 'head-a', 'head-b', 'head-greyed'];

  it('has a paper pair for every notehead colour, in normal and high contrast', () => {
    for (const h of HEADS) {
      expect(source.contrast.pairs.some((p) => p.fg === h && p.bg === 'paper' && p.min >= 3 && p.high !== true), h).toBe(true);
      expect(source.contrast.pairs.some((p) => p.fg === h && p.bg === 'paper' && p.min >= 4.5 && p.high === true), `${h} high contrast`).toBe(true);
    }
  });

  it('gives the seven letters seven different colours in each theme', () => {
    for (const theme of themes) {
      for (const high of [false, true]) {
        const values = HEADS.slice(0, 7).map((h) => token(h, theme, high).toUpperCase());
        expect(new Set(values).size, `${theme}${high ? ' high contrast' : ''}`).toBe(7);
      }
    }
  });

  it('draws the heard note, its replay and a greyed head in neutral greys, distinct from ink', () => {
    for (const theme of themes) {
      for (const high of [false, true]) {
        const ink = token('ink', theme, high).toUpperCase();
        for (const name of ['ghost', 'ghost-replay', 'head-greyed']) {
          const { rgb } = parseColour(token(name, theme, high));
          const chroma = Math.max(...rgb) - Math.min(...rgb);
          expect(chroma, `${name} ${theme}${high ? ' high contrast' : ''} is not a neutral grey`).toBeLessThanOrEqual(16);
          expect(token(name, theme, high).toUpperCase()).not.toBe(ink);
          const r = contrastRatio(rgb, parseColour(token('paper', theme, high)).rgb);
          expect(r, `${name} ${theme}`).toBeGreaterThanOrEqual(3);
        }
        // The greyed written head and the heard ghost are told apart by value as well as by shape and place.
        expect(token('head-greyed', theme, high)).not.toBe(token('ghost', theme, high));
      }
    }
  });
});
