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
