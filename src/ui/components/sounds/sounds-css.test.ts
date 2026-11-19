// Stylesheet checks for the sounds components (06 section 6.8). jsdom cannot render, so these read the CSS source.
// Colours and raw px are enforced by stylelint.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./sounds.css', import.meta.url), 'utf8');

describe('sounds.css', () => {
  it('sizes come from tokens: sound row, icon tile, dock button, info hit', () => {
    expect(css).toMatch(/\.sd-sound\s*\{[^}]*min-height:\s*var\(--sound-button-min-height\)/);
    expect(css).toMatch(/\.sd-sound-tile\s*\{[^}]*width:\s*var\(--sound-icon-tile\)/);
    expect(css).toMatch(/\.sd-dock-button\s*\{[^}]*min-height:\s*var\(--dock-button-min-height\)/);
    expect(css).toContain('var(--info-button-hit)');
  });

  it('the playing state is a 1 px brass edge plus a 1 px inset brass edge, and a brass-wash tile', () => {
    expect(css).toMatch(/\.sd-sound\[data-playing='true'\]\s*\{[^}]*border-color:\s*var\(--brass\)[^}]*inset 0 0 0 0\.0625rem var\(--brass\)/);
    expect(css).toMatch(/\.sd-sound\[data-playing='true'\] \.sd-sound-tile[^{]*\{[^}]*background:\s*var\(--brass-wash\)[^}]*color:\s*var\(--brass-ink\)/);
  });

  it('focus is the 2 px focus ring with a 2 px offset on the sound buttons', () => {
    for (const selector of ['.sd-sound-main:focus-visible', '.sd-dock-button:focus-visible']) {
      const block = new RegExp(`${selector.replace(/[.:()]/g, '\\$&')}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? '';
      expect(block).toContain('outline: 0.125rem solid var(--focus-ring)');
      expect(block).toContain('outline-offset: 0.125rem');
    }
  });

  it('disabled sounds use the 40% token', () => {
    expect(css.match(/opacity:\s*var\(--opacity-disabled\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('the live caption is brass ink', () => {
    expect(css).toMatch(/\.sd-live-cap\s*\{[^}]*color:\s*var\(--brass-ink\)/);
  });

  it('the bars stand still under reduced motion: only guarded rules animate them', () => {
    expect(css).toMatch(/prefers-reduced-motion: no-preference\)[\s\S]*?:not\(\[data-motion='reduced'\]\) \.sd-eq i\s*\{[^}]*animation:/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?:root\[data-motion='full'\] \.sd-eq i\s*\{[^}]*animation:/);
    expect(/\n\.sd-eq i\s*\{[^}]*animation/.test(css)).toBe(false);
  });

  it('the coach mark takes its place in the flow: relative, no z-index, never fixed or absolute', () => {
    const block = /\.sd-coach\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(block).toContain('position: relative');
    expect(block).not.toMatch(/z-index|position:\s*(fixed|absolute)/);
  });
});
