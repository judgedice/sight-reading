// Stylesheet checks for the D2a container components (04 section 7.5). Node environment: reads the CSS source.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./containers.css', import.meta.url), 'utf8');

describe('containers.css: card', () => {
  it('pads 16 px, and 24 px from the lg breakpoint (1024 px = 64rem)', () => {
    expect(css).toMatch(/\.ui-card\s*\{[^}]*padding:\s*var\(--card-x-padding\)/);
    expect(css).toMatch(/@media \(min-width:\s*64rem\)\s*\{\s*\.ui-card\s*\{\s*padding:\s*var\(--card-x-padding-lg\)/);
  });
});

describe('containers.css: banner', () => {
  it('maps each tone to its colour token and keeps the 4 px bar and 48 px minimum', () => {
    expect(css).toMatch(/\.ui-banner-caution\s*\{[^}]*--banner-accent:\s*var\(--caution\)/);
    expect(css).toMatch(/\.ui-banner-danger\s*\{[^}]*--banner-accent:\s*var\(--danger\)/);
    expect(css).toMatch(/\.ui-banner-info\s*\{[^}]*--banner-accent:\s*var\(--accent\)/);
    expect(css).toMatch(/border-inline-start-width:\s*0\.25rem/);
    expect(css).toMatch(/min-height:\s*var\(--banner-min-height\)/);
  });
});
