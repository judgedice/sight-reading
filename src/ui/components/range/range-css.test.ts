// Stylesheet and contrast checks for the range picture. jsdom cannot render motion or colour, so these read the CSS
// source and the token values.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./range.css', import.meta.url), 'utf8');
type ThemeValue = { light: string; dark: string };
const tokens = JSON.parse(readFileSync(new URL('../../../../design/tokens.json', import.meta.url), 'utf8')) as {
  color: { ui: Record<string, ThemeValue>; highContrast: { ui: Record<string, ThemeValue> } };
  contrast: { pairs: { id: string; fg: string; bg: string; min: number }[] };
};

/** The CSS rule body for a selector (first match). */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}
function ratio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('range.css: colours come from the tokens the contrast pairs name', () => {
  it('served band is accent, full band is range-full-bar, on the ruler, the keyboard brackets and the legend', () => {
    expect(rule('.rp-ruler-served')).toMatch(/background: var\(--accent\)/);
    expect(rule('.rp-ruler-full')).toMatch(/background: var\(--range-full-bar\)/);
    expect(rule('.rp-kb-bracket-served')).toMatch(/background: var\(--accent\)/);
    expect(rule('.rp-kb-bracket-full')).toMatch(/background: var\(--range-full-bar\)/);
    expect(rule('.rp-swatch-served')).toMatch(/background: var\(--accent\)/);
    expect(rule('.rp-swatch-full')).toMatch(/background: var\(--range-full-bar\)/);
    expect(rule('.rp-ruler-track')).toMatch(/background: var\(--track\)/);
  });

  it('full-range notes use range-full and the served band behind the staff uses band', () => {
    expect(rule('.rp-note-full .rp-glyph')).toMatch(/fill: var\(--range-full\)/);
    expect(rule('.rp-band')).toMatch(/fill: var\(--band\)/);
  });
});

describe('contrast: served band against the full band (05 section 14 item 10)', () => {
  const ui = tokens.color.ui;
  const high = tokens.color.highContrast.ui;
  const pick = (name: string, theme: 'light' | 'dark', hc: boolean): string => (hc ? high[name]?.[theme] : undefined) ?? ui[name]![theme];

  it('is a pair in the contrast table with a 3:1 minimum', () => {
    const pair = tokens.contrast.pairs.find((p) => p.id === 'accent-on-range-full-bar');
    expect(pair).toMatchObject({ fg: 'accent', bg: 'range-full-bar', min: 3 });
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const hc of [false, true]) {
      it(`passes 3:1 in ${theme}${hc ? ' high contrast' : ''}`, () => {
        expect(ratio(pick('accent', theme, hc), pick('range-full-bar', theme, hc))).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

describe('range.css: motion', () => {
  it('served notes, ruler band and keyboard bracket move over --dur-base', () => {
    expect(rule('.rp-note')).toMatch(/transition: transform var\(--dur-base\)/);
    expect(rule('.rp-ruler-served')).toMatch(/transition: left var\(--dur-base\)/);
    expect(rule('.rp-kb-bracket-served')).toMatch(/transition: left var\(--dur-base\)/);
  });

  it('jumps under reduced motion, from the system setting and from the app setting', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.rp-note,\s*\.rp-ruler-served,\s*\.rp-kb-bracket-served,[^}]*transition: none/);
    expect(css).toMatch(/:root\[data-motion="reduced"\] \.rp-note,[^{]*\{\s*transition: none/);
  });

  it('note buttons have a 44 px hit area', () => {
    expect(rule('button.rp-note-pill::before')).toMatch(/height: 2\.75rem/);
  });
});
