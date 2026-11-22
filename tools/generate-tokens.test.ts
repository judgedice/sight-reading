// Contract tests for the token generator (04 section 7, section 12; redesign 06 section 5):
// generation is deterministic, the committed src/ui/tokens.css and tokens.ts match the JSON,
// comments never leak into output, and the transcribed values match the version 2 spec.
import { describe, expect, it } from 'vitest';
import { checkTokenFiles, generateTokens, loadTokenSource, TOKENS_CSS, TOKENS_TS } from './generate-tokens.ts';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { component, contrastPairs, motion, score, tokens, ui, zIndex } from '../src/ui/tokens.ts';

/** The parts of design/tokens.json this test reads. */
interface TokenDoc {
  version: number;
  color: {
    ui: Record<string, ThemeValue>;
    paper: Record<string, ThemeValue>;
    highContrast: { ui: Record<string, ThemeValue>; paper: Record<string, ThemeValue> };
    opacity: Record<string, number>;
  };
  elevation: Record<string, ThemeValue>;
  font: { files: string[]; featureSettings: string };
  type: Record<string, Record<string, number | string>>;
  space: Record<string, number>;
  radius: Record<string, number>;
  motion: { dur: Record<string, number>; ease: Record<string, string> };
}
type ThemeValue = { light: string; dark: string };

const source = loadTokenSource() as TokenDoc;
const generated = generateTokens(source);
const css = generated.css;
const tsText = generated.ts;

describe('generateTokens', () => {
  it('is deterministic: the same JSON gives byte-identical output', () => {
    const again = generateTokens(loadTokenSource());
    expect(again.css).toBe(css);
    expect(again.ts).toBe(tsText);
  });

  it('matches the committed src/ui/tokens.css and src/ui/tokens.ts', () => {
    expect(checkTokenFiles(source)).toEqual([]);
    expect(readFileSync(TOKENS_CSS, 'utf8')).toBe(css);
    expect(readFileSync(TOKENS_TS, 'utf8')).toBe(tsText);
  });

  it('never emits $-prefixed documentation keys', () => {
    expect(css).not.toContain('$');
    expect(tsText).not.toContain('$comment');
  });

  it('emits light and dark values for every UI colour token in the right theme block', () => {
    const lightBlock = css.slice(css.indexOf(':root, :root[data-theme="light"] {'), css.indexOf(':root[data-theme="dark"] {'));
    const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"] {'), css.indexOf(':root[data-paper="light"] {'));
    for (const [name, v] of Object.entries(source.color.ui)) {
      if (name.startsWith('$')) continue;
      expect(lightBlock).toContain(`  --${name}: ${v.light};`);
      expect(darkBlock).toContain(`  --${name}: ${v.dark};`);
    }
  });

  it('routes the system dark preference to the dark theme when no data-theme is set', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {');
  });

  it('applies high contrast overrides above the base theme and forced colours last', () => {
    const hcAt = css.indexOf(':root[data-contrast="high"], :root[data-contrast="high"][data-theme="light"] {');
    const darkAt = css.indexOf(':root[data-theme="dark"] {');
    const forcedAt = css.indexOf('@media (forced-colors: active)');
    expect(hcAt).toBeGreaterThan(darkAt);
    expect(forcedAt).toBeGreaterThan(hcAt);
    expect(css).toContain('  --error: #A32100;');
    expect(css).toContain('  --brass: #E9C27A;');
    expect(css).toContain('  --error: #FF9A78;');
    expect(css).toContain('  --correct: #005A63;');
    expect(css).toContain('  --correct: #8FF0FA;');
  });

  it('emits forced-colour mappings verbatim', () => {
    expect(css).toContain('  --ink: CanvasText;');
    expect(css).toContain('  --paper: Canvas;');
    expect(css).toContain('  --error: Mark;');
    expect(css).toContain('  --ghost: LinkText;');
    expect(css).toContain('  --correct: CanvasText;');
  });

  it('emits the coarse pointer override for the 44 px target', () => {
    expect(css).toContain('@media (pointer: coarse) {\n  :root {\n    --target-min: 44px;');
  });

  it('rejects a colour token that lacks a dark value', () => {
    const bad = JSON.parse(JSON.stringify(source)) as TokenDoc;
    (bad.color.ui as Record<string, unknown>).bg = { light: '#F6F5F1' };
    expect(() => generateTokens(bad)).toThrow(/must be \{ light, dark \}/);
  });

  it('rejects a missing group rather than emitting partial output', () => {
    const bad = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
    delete bad.type;
    expect(() => generateTokens(bad)).toThrow(/type must be an object/);
  });
});

describe('transcribed values (06 section 5)', () => {
  it('colour tokens match 06 section 3 exactly', () => {
    expect(source.version).toBe(2);
    expect(source.color.ui.bg).toEqual({ light: '#F4F1EA', dark: '#111113' });
    expect(source.color.ui['surface-2-hover']).toEqual({ light: '#E5E0D5', dark: '#2E2E32' });
    expect(source.color.ui['border-strong']).toEqual({ light: '#8C8578', dark: '#76716A' });
    expect(source.color.ui.accent).toEqual({ light: '#1C1B19', dark: '#EEEAE2' });
    expect(source.color.ui.brass).toEqual({ light: '#94661A', dark: '#D8A548' });
    expect(source.color.ui['brass-wash']).toEqual({ light: 'rgba(176,124,30,0.14)', dark: 'rgba(216,165,72,0.16)' });
    expect(source.color.ui.danger).toEqual({ light: '#B8360F', dark: '#FF7A52' });
    expect(source.color.ui.scrim).toEqual({ light: 'rgba(28,24,18,0.38)', dark: 'rgba(0,0,0,0.60)' });
    expect(source.color.paper.paper).toEqual({ light: '#FFFDF8', dark: '#24221F' });
    // PLAN R69: the heard note (ghost) is a neutral grey, no longer violet.
    expect(source.color.paper.ghost).toEqual({ light: '#5F5B55', dark: '#B5B0A7' });
    expect(source.color.paper['playhead-bar']).toEqual({ light: 'rgba(176,124,30,0.13)', dark: 'rgba(216,165,72,0.15)' });
    expect(source.color.paper['metro-active']).toEqual(source.color.ui.brass);
    expect(source.color.opacity.disabled).toBe(0.4);
  });

  it('high contrast overrides match 06 section 3.2', () => {
    expect(source.color.highContrast.paper.error).toEqual({ light: '#A32100', dark: '#FF9A78' });
    expect(source.color.highContrast.paper.ghost).toEqual({ light: '#4A4743', dark: '#CFCAC1' });
    expect(source.color.highContrast.paper['staff-line']).toEqual({ light: '#4F4C46', dark: '#B3AEA6' });
    expect(source.color.highContrast.ui.brass).toEqual({ light: '#7D5512', dark: '#E9C27A' });
    expect(source.color.highContrast.ui['border-strong']).toEqual({ light: '#5F5A51', dark: '#A9A398' });
  });

  it('has deleted the deprecated aliases (08-plan decision 12, package qa)', () => {
    expect(source.color.paper['playhead-next']).toBeUndefined();
    expect(source.color.paper['ink-accent-soft']).toBeUndefined();
    expect(source.color.ui['elevation-overlay']).toBeUndefined();
    for (const name of ['random-chip-height', 'random-chip-x-padding', 'instrument-circle', 'verdict-glyph-sizes', 'stepper-value-width']) expect((component as Record<string, unknown>)[name], name).toBeUndefined();
    expect(css).not.toContain('--playhead-next:');
    expect(css).not.toContain('--ink-accent-soft:');
    expect(css).not.toContain('--random-chip-');
  });

  it('every colour and elevation value in the file is carried by tokens.css, in the right theme block', () => {
    const darkAt = css.indexOf(':root[data-theme="dark"] {');
    const lightBlock = css.slice(0, darkAt);
    const darkBlock = css.slice(darkAt, css.indexOf(':root[data-paper="light"] {'));
    for (const group of [source.color.ui, source.color.paper, source.elevation]) {
      for (const [name, v] of Object.entries(group)) {
        if (name.startsWith('$')) continue;
        expect(lightBlock).toContain(`  --${name}: ${v.light};`);
        expect(darkBlock).toContain(`  --${name}: ${v.dark};`);
      }
    }
    for (const [name, v] of Object.entries({ ...source.color.highContrast.ui, ...source.color.highContrast.paper })) {
      expect(css).toContain(`  --${name}: ${v.light};`);
      expect(css).toContain(`  --${name}: ${v.dark};`);
    }
  });

  it('elevation is emitted as --e0 to --e3 and dark paper gets its ring (06 section 4)', () => {
    expect(css).toContain('  --e0: none;');
    expect(css).toContain('  --e1: 0 1px 2px rgba(40,32,20,0.05), 0 1px 1px rgba(40,32,20,0.03);');
    expect(css).toContain('  --e3: inset 0 1px 0 rgba(255,255,255,0.05), 0 40px 80px rgba(0,0,0,0.6);');
    expect(css).toContain('  --paper-ring: 0 0 0 1px rgba(255,255,255,0.04);');
  });

  it('type scale, phone sizes, space, radius, z-index and motion match 06 sections 2.2 and 4', () => {
    expect(source.type.count).toEqual({ face: 'display', size: 200, phoneSize: 132, line: 1, weight: 600 });
    expect(source.type.grade).toMatchObject({ size: 112, phoneSize: 88, line: 0.9, weight: 600, tracking: '-0.03em' });
    expect(source.type.h1).toMatchObject({ face: 'display', size: 34, phoneSize: 30 });
    expect(source.type.h3).toMatchObject({ face: 'ui', size: 17 });
    expect(source.type.body).toMatchObject({ size: 16, line: 1.5, weight: 400, buttonWeight: 600 });
    expect(source.type.caption).toMatchObject({ size: 13, weight: 500 });
    expect(source.type.eyebrow).toMatchObject({ size: 12, tracking: '0.09em', case: 'upper' });
    expect(css).toContain('  --type-h1-size: 34px;');
    expect(css).toContain('  --type-h1-family: var(--font-display);');
    expect(css).toContain('  --type-eyebrow-transform: uppercase;');
    expect(css).toContain('@media (max-width: 699px) {\n  :root {\n    --type-count-size: 132px;');
    expect(source.space['9']).toBe(96);
    expect(source.radius).toMatchObject({ xs: 4, s: 8, m: 12, l: 20, xl: 28, full: 999 });
    expect(zIndex).toEqual({ base: 0, sticky: 10, sheet: 40, popover: 45, modal: 50, toast: 60 });
    expect(motion.dur).toEqual({ instant: 0, fast: 100, base: 200, slow: 320, count: 160, grade: 480 });
    expect(motion.ease['in-out']).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
    expect(motion.ease.settle).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
    expect(css).toContain('  --dur-grade: 480ms;');
    expect(css).toMatch(/:root\[data-motion="reduced"\] \{[^}]*--dur-grade: 0ms;/);
  });

  it('declares the three self-hosted faces with font-display block, no remote URL, and files that exist under 260 KB', () => {
    expect(css.match(/@font-face/g)).toHaveLength(3);
    expect(css.match(/font-display: block;/g)).toHaveLength(3);
    expect(css).toContain('unicode-range: U+2669, U+266A, U+266D-266F;');
    expect(css).not.toMatch(/https?:|\/\//);
    expect(css).toContain('  --font-display: "Source Serif 4", "Iowan Old Style", Charter, Georgia, serif;');
    expect(css).toContain('  --font-features: "cv11", "ss01";');
    expect(css).toContain(':root[data-fonts="fallback"] {\n  --font-display: "Iowan Old Style", Charter, Georgia, serif;');
    expect(css).toContain(':where(h1) {\n  font-family: var(--type-h1-family);');
    expect(css).toContain('.tabular-nums {\n  font-variant-numeric: tabular-nums;');
    for (const f of source.font.files) {
      expect(css).toContain(`url("./fonts/${f}")`);
      expect(statSync(join(import.meta.dirname, '..', 'src/ui/fonts', f)).size).toBeLessThan(260_000);
    }
  });

  it('Reduce motion Off (data-motion="full") restores durations under a system reduced-motion preference', () => {
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(at).toBeGreaterThanOrEqual(0);
    const block = css.slice(at, css.indexOf('\n}\n', at));
    expect(block).toContain(':root[data-motion="full"]');
    expect(block).toContain('--dur-base: 200ms;');
    expect(css).toMatch(/:root\[data-motion="reduced"\] \{[^}]*--dur-base: 0ms;/);
  });

  it('component sizes from 06 section 5 are emitted with their pointer and phone variants', () => {
    expect(css).toContain('  --button-hero-height: 56px;');
    expect(css).toContain('  --button-x-padding: 18px;');
    expect(css).toContain('  --segment-height: 40px;');
    expect(css).toContain('  --time-glyph-staff-space: 7.5;');
    expect(css).toContain('  --count-line-height: 0.74;');
    expect(css).toContain('  --key-chip-staff-width: 100%;');
    expect(css).toContain('  --calibration-mark: 26px;');
    expect(css).toContain('@media (max-width: 699px) {\n  :root {');
    expect(css).toContain('    --calibration-mark: 22px;');
    expect(css).toContain('    --range-picture-width: 100%;');
    expect(css).toMatch(/@media \(pointer: coarse\) \{[\s\S]*--segment-height: 44px;/);
    expect(component['toggle-track-width']).toBe(40);
    expect(component['difficulty-meter-segment']).toEqual([14, 18]);
    expect(component['sheet-side-width']).toBe(400);
  });

  it('score geometry and UI rules match 7.3', () => {
    expect(score['ghost-stroke']).toEqual({ live: 1.5, highContrast: 2.25 });
    expect(score['ghost-fill']).toEqual({ live: 0.4, review: 0.55, highContrast: 0.55 });
    expect(score['staff-space']).toEqual({ takeDesktop: 16.5, takePhone: 11, readDesktop: 15, readPhone: 9.5, reviewDesktop: 12.5, reviewPhone: 9 });
    expect(score['past-mark-opacity'].systemLeft).toBe(0.7);
    expect(score['playhead-pad-staff-spaces']).toEqual([1.8, 0.15]);
    expect(ui.levelThinThreshold).toBe(10);
    expect(ui.meterChipMinExcerpts).toBe(5);
    expect(ui.swapDelayMs).toBe(400);
    expect(ui.unmatchedGhostCapPerBar).toBe(3);
    expect(ui.wakeLockIdleMs).toBe(300000);
    expect(tokens.breakpoints.lg).toEqual({ min: 1024, max: 1439 });
  });

  it('the contrast pair list is present and exported for the contrast test', () => {
    expect(contrastPairs.length).toBeGreaterThan(20);
  });
});
