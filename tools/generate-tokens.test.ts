// Contract tests for the token generator (04 section 7, section 12; D0a acceptance):
// generation is deterministic, the committed src/ui/tokens.css and tokens.ts match the JSON,
// comments never leak into output, and the transcribed values match the spec.
import { describe, expect, it } from 'vitest';
import { checkTokenFiles, generateTokens, loadTokenSource, TOKENS_CSS, TOKENS_TS } from './generate-tokens.ts';
import { readFileSync } from 'node:fs';
import { component, contrastPairs, motion, score, tokens, ui, zIndex } from '../src/ui/tokens.ts';

/** The parts of design/tokens.json this test reads. */
interface TokenDoc {
  color: { ui: Record<string, ThemeValue>; paper: Record<string, ThemeValue>; opacity: Record<string, number> };
  type: Record<string, Record<string, number>>;
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
    expect(css).toContain('  --error: #FF9A78;');
    expect(css).toContain('  --correct: #005A52;');
    expect(css).toContain('  --correct: #6FE0D0;');
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

describe('transcribed values (04 section 7)', () => {
  it('colour tokens match 7.1 exactly', () => {
    expect(source.color.ui.bg).toEqual({ light: '#F6F5F1', dark: '#121418' });
    expect(source.color.ui['surface-2-hover']).toEqual({ light: '#DEDCD6', dark: '#32363B' });
    expect(source.color.ui['border-strong']).toEqual({ light: '#8E8A80', dark: '#6B727C' });
    expect(source.color.ui.accent).toEqual({ light: '#2F4BD8', dark: '#8FA1FF' });
    expect(source.color.ui.danger).toEqual({ light: '#C5300A', dark: '#FF7B52' });
    expect(source.color.ui.scrim).toEqual({ light: 'rgba(0,0,0,0.32)', dark: 'rgba(0,0,0,0.56)' });
    expect(source.color.paper.paper).toEqual({ light: '#FFFDF8', dark: '#1B1E23' });
    expect(source.color.paper.ghost).toEqual({ light: '#7A3EC8', dark: '#BFA2FF' });
    expect(source.color.paper['playhead-next']).toEqual({ light: 'rgba(47,75,216,0.60)', dark: 'rgba(143,161,255,0.60)' });
    expect(source.color.opacity.disabled).toBe(0.4);
  });

  it('type, space, radius, z-index and motion match 7.2 and 7.3', () => {
    expect(source.type.grade).toEqual({ size: 72, line: 1.0, weight: 700 });
    expect(source.type.body).toMatchObject({ size: 16, line: 1.5, weight: 400, buttonWeight: 600 });
    expect(source.type.caption).toEqual({ size: 12, line: 1.35, weight: 500 });
    expect(source.space['8']).toBe(64);
    expect(source.radius.xl).toBe(20);
    expect(zIndex).toEqual({ base: 0, sticky: 10, sheet: 40, popover: 45, modal: 50, toast: 60 });
    expect(motion.dur).toEqual({ instant: 0, fast: 100, base: 200, slow: 320 });
    expect(motion.ease['in-out']).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
  });

  it('component sizes from 7.5 are emitted with their pointer variants', () => {
    expect(css).toContain('  --button-hero-height: 56px;');
    expect(css).toContain('  --random-chip-height: 32px;');
    expect(component['random-chip-height']).toEqual({ fine: 32, coarse: 44 });
    expect(component['toggle-track-width']).toBe(36);
    expect(component['sheet-side-width']).toBe(400);
  });

  it('score geometry and UI rules match 7.3', () => {
    expect(score['ghost-stroke']).toEqual({ live: 1.5, highContrast: 2.25 });
    expect(score['ghost-fill']).toEqual({ live: 0.15, review: 0.2, highContrast: 0.3 });
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
