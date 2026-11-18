// Contrast test (04 section 13.1 check 2): every pair in design/tokens.json is recomputed from the
// token values with the WCAG relative-luminance formula. Each ratio must meet its stated minimum,
// and each ratio the spec claims must be within 0.1 of the recomputed value.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = JSON.parse(readFileSync(join(root, 'design/tokens.json'), 'utf8')) as {
  color: {
    ui: Record<string, { light: string; dark: string }>;
    paper: Record<string, { light: string; dark: string }>;
    highContrast: { ui: Record<string, { light: string; dark: string }>; paper: Record<string, { light: string; dark: string }> };
  };
  contrast: {
    pairs: {
      id: string;
      fg: string;
      bg: string;
      min: number;
      claimed?: { light?: number; dark?: number };
      layer?: 'paper' | 'paper-high-contrast';
    }[];
  };
};

type Theme = 'light' | 'dark';

/** WCAG 2.x relative luminance of an opaque #RRGGBB colour. */
export function relativeLuminance(hex: string): number {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) throw new Error(`contrast: not an opaque #RRGGBB colour: ${hex}`);
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** WCAG contrast ratio between two opaque colours, rounded to two decimals the way the spec states them. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return Math.round(ratio * 100) / 100;
}

/** Resolves a token name to its colour for one theme, honouring the layer the pair names. */
function resolve(name: string, theme: Theme, layer: 'ui' | 'paper' | 'paper-high-contrast'): string {
  if (layer === 'ui') {
    const v = source.color.ui[name];
    if (!v) throw new Error(`contrast: unknown ui token ${name}`);
    return v[theme];
  }
  if (layer === 'paper-high-contrast') {
    const v = source.color.highContrast.paper[name] ?? source.color.paper[name];
    if (!v) throw new Error(`contrast: unknown paper token ${name}`);
    return v[theme];
  }
  const v = source.color.paper[name];
  if (!v) throw new Error(`contrast: unknown paper token ${name}`);
  return v[theme];
}

/** A pair names its fg and bg in the ui group, or in the paper group when it sits on the paper. */
function layerFor(pair: { fg: string; bg: string; layer?: string }): 'ui' | 'paper' | 'paper-high-contrast' {
  if (pair.layer === 'paper-high-contrast') return 'paper-high-contrast';
  if (pair.layer === 'paper') return 'paper';
  return 'ui';
}

const themes: Theme[] = ['light', 'dark'];

describe('contrast pairs from design/tokens.json', () => {
  it('lists pairs, each with a minimum of 3 or more', () => {
    expect(source.contrast.pairs.length).toBeGreaterThan(20);
    for (const p of source.contrast.pairs) expect(p.min).toBeGreaterThanOrEqual(3);
  });

  for (const pair of source.contrast.pairs) {
    for (const theme of themes) {
      it(`${pair.id} (${theme}) meets ${pair.min}:1`, () => {
        // Paper pairs resolve fg and bg from the paper group; high-contrast paper pairs take fg from the override.
        const layer = layerFor(pair);
        const fg = resolve(pair.fg, theme, layer);
        const bg = resolve(pair.bg, theme, layer === 'paper-high-contrast' ? 'paper' : layer);
        const ratio = contrastRatio(fg, bg);
        expect(ratio, `${pair.id} ${theme}: ${fg} on ${bg} is ${ratio}:1`).toBeGreaterThanOrEqual(pair.min);

        const claim = pair.claimed?.[theme];
        if (claim !== undefined) {
          expect(Math.abs(ratio - claim), `${pair.id} ${theme}: claimed ${claim}, recomputed ${ratio}`).toBeLessThanOrEqual(0.1);
        }
      });
    }
  }
});
