// Stylesheet checks for the D2a form components (04 sections 7.5 and 8.1). jsdom cannot render
// focus or motion, so these read the CSS source. Colours and px are enforced by stylelint.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const formCss = readFileSync(new URL('./form.css', import.meta.url), 'utf8');

describe('form.css: sizes (7.5 table)', () => {
  it('button, stepper, select, tempo and toggle sizes come from tokens', () => {
    expect(formCss).toMatch(/\.ui-button-compact\s*\{\s*min-height:\s*var\(--button-compact-height\)/);
    expect(formCss).toMatch(/\.ui-button-default\s*\{\s*min-height:\s*var\(--button-default-height\)/);
    expect(formCss).toMatch(/\.ui-button-hero\s*\{[^}]*min-height:\s*var\(--button-hero-height\)/);
    expect(formCss).toMatch(/\.ui-stepper-button\s*\{[^}]*width:\s*var\(--stepper-button-size\)/);
    expect(formCss).toMatch(/\.ui-stepper-value\s*\{[^}]*min-width:\s*var\(--stepper-value-min-width\)/);
    expect(formCss).toMatch(/\.ui-select\s*\{[^}]*min-height:\s*var\(--select-height\)/);
    expect(formCss).toMatch(/\.ui-tempo-field\s*\{[^}]*width:\s*var\(--tempo-field-width\)/);
    expect(formCss).toMatch(/\.ui-tempo-range\s*\{[^}]*height:\s*var\(--tempo-hit-size\)/);
    expect(formCss).toMatch(/\.ui-toggle\s*\{[^}]*min-height:\s*var\(--toggle-hit-size\)/);
    expect(formCss).toMatch(/\.ui-toggle-track\s*\{[^}]*width:\s*var\(--toggle-track-width\)/);
    expect(formCss).toMatch(/\.ui-random-chip\s*\{[^}]*min-height:\s*var\(--random-chip-height\)/);
    expect(formCss).toMatch(/\.ui-segment\s*\{[^}]*min-height:\s*var\(--segment-height\)/);
  });
});

describe('form.css: focus, disabled and motion', () => {
  it.each([
    '.ui-button:focus-visible',
    '.ui-random-chip:focus-visible',
    '.ui-stepper-button:focus-visible',
    '.ui-select:focus-visible',
    '.ui-tempo-range:focus-visible',
    '.ui-tempo-field:focus-visible',
  ])('%s draws the 2 px focus ring with a 2 px offset', (selector) => {
    const block = new RegExp(`${selector.replace(/[.:()]/g, '\\$&')}[\\s\\S]*?\\}`).exec(formCss)?.[0] ?? '';
    expect(block).toContain('outline: 0.125rem solid var(--focus-ring)');
    expect(block).toContain('outline-offset: 0.125rem');
  });

  it('segments and switches show the focus ring when their hidden input has focus', () => {
    expect(formCss).toMatch(/\.ui-segment:has\(> \.ui-form-hidden:focus-visible\)\s*\{[^}]*outline:\s*0\.125rem solid var\(--focus-ring\)/);
    expect(formCss).toMatch(/\.ui-toggle:has\(> \.ui-form-hidden:focus-visible\) \.ui-toggle-track\s*\{[^}]*outline:\s*0\.125rem solid var\(--focus-ring\)/);
  });

  it('every disabled control uses the 40% opacity token', () => {
    for (const selector of ['.ui-button[aria-disabled', '.ui-segment-disabled', '.ui-stepper-button[aria-disabled', '.ui-toggle:has(']) {
      expect(formCss).toContain(selector);
    }
    expect(formCss.match(/opacity:\s*var\(--opacity-disabled\)/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('the loading spinner and any reduced-motion setting stop the animation', () => {
    expect(formCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ui-form-spinner\s*\{\s*animation:\s*none/);
    expect(formCss).toMatch(/:root\[data-motion='reduced'\] \.ui-form-spinner\s*\{\s*animation:\s*none/);
  });

  it('transitions use the motion tokens only', () => {
    const transitions = formCss.match(/transition:[^;]+;/g) ?? [];
    expect(transitions.length).toBeGreaterThan(0);
    for (const declaration of transitions) {
      expect(declaration).toMatch(/var\(--dur-[a-z]+\)/);
    }
  });
});
