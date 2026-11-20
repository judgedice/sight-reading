// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '../../primitives/test-render.ts';
import { BeatUnitText } from './BeatUnitText.tsx';

describe('BeatUnitText', () => {
  it('draws each beat unit as an SVG and keeps the character in the text for copy and screen readers', () => {
    for (const unit of ['♩', '♩.', '♪', '\u{1D15E}']) {
      const m = mount(<BeatUnitText text={`Bar 2 · ${unit} = 84`} />);
      expect(m.container.querySelectorAll('svg.ui-beat-unit')).toHaveLength(1);
      expect(m.container.textContent).toBe(`Bar 2 · ${unit} = 84`);
      expect(m.container.querySelector('.ui-visually-hidden')?.textContent).toBe(unit);
      m.unmount();
    }
  });

  it('draws a dot for the dotted quarter only, and passes text without a unit through', () => {
    const dotted = mount(<BeatUnitText text="♩. = 60" />);
    expect(dotted.container.querySelectorAll('svg circle')).toHaveLength(1);
    dotted.unmount();
    const plain = mount(<BeatUnitText text="Count-in" />);
    expect(plain.container.querySelector('svg')).toBeNull();
    plain.unmount();
  });

  it("draws the half note as setup's beatUnit writes it (decomposed, U+1D157 U+1D165) as an open notehead", () => {
    const half = mount(<BeatUnitText text={`\u{1D157}\u{1D165} = 80`} />);
    expect(half.container.querySelectorAll('svg.ui-beat-unit')).toHaveLength(1);
    expect(half.container.querySelector('svg ellipse')?.getAttribute('fill')).toBe('none');
    half.unmount();
  });
});
