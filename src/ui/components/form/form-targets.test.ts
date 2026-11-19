// Stylesheet checks: 44 px targets on coarse pointers and the 2 px focus ring (06 section 6). Node environment.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('touch targets and focus ring (stylesheets)', () => {
  const tokens = readFileSync(new URL('../../tokens.css', import.meta.url), 'utf8');
  const coarse = /@media \(pointer: coarse\) \{\s*:root \{([^}]*)\}/.exec(tokens)?.[1] ?? '';
  const px = (name: string): number => Number(new RegExp(`--${name}:\\s*(\\d+)px`).exec(coarse)?.[1] ?? 0);

  it.each(['target-min', 'button-compact-height', 'button-default-height', 'segment-height', 'select-height', 'stepper-button-size'])(
    'coarse pointer: --%s is at least 44 px',
    (name) => {
      expect(px(name)).toBeGreaterThanOrEqual(44);
    },
  );

  it('switch, slider and info button hit areas are 44 px tokens', () => {
    for (const name of ['toggle-hit-size', 'tempo-hit-size', 'info-button-hit']) {
      expect(Number(new RegExp(`--${name}:\\s*(\\d+)px`).exec(tokens)?.[1])).toBeGreaterThanOrEqual(44);
    }
  });

  it('every interactive control draws a 2 px focus ring with a 2 px offset', () => {
    const css = ['./form.css', '../../primitives/primitives.css', '../containers/containers.css'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
    for (const selector of ['.ui-button:focus-visible', '.ui-info-button:focus-visible', '.ui-icon-button:focus-visible', '.ui-banner-dismiss:focus-visible']) {
      const at = css.indexOf(selector);
      expect(at, selector).toBeGreaterThan(-1);
      const block = css.slice(at, css.indexOf('}', at));
      expect(block).toContain('outline: 0.125rem solid var(--focus-ring)');
      expect(block).toContain('outline-offset: 0.125rem');
    }
  });
});
