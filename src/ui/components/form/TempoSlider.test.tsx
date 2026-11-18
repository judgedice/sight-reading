// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../../copy/copy.ts';
import { mount, key, type Mounted } from '../../primitives/test-render.ts';
import { TempoSlider } from './TempoSlider.tsx';
import { blur, q, setNativeValue } from './test-helpers.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});

const base = { min: 40, max: 200, beatUnit: '♩', ariaLabel: 'Tempo' };

describe('TempoSlider', () => {
  it('shows the beat marking from copy and a slider plus numeric field, both named', () => {
    current = mount(<TempoSlider {...base} value={72} onChange={vi.fn()} />);
    expect(q('.ui-tempo-marking').textContent).toBe(copy('tempo.marking', { unit: '♩', bpm: 72 }));
    const range = q<HTMLInputElement>('input[type=range]');
    const field = q<HTMLInputElement>('input[type=number]');
    expect(range.value).toBe('72');
    expect(range.min).toBe('40');
    expect(range.max).toBe('200');
    expect(range.getAttribute('aria-label')).toBe('Tempo');
    expect(range.getAttribute('aria-valuetext')).toBe(copy('tempo.spoken', { unit: '♩', bpm: 72 }));
    expect(field.value).toBe('72');
    expect(field.getAttribute('aria-label')).toBe('Tempo');
  });

  it('reports a slider change as a number', () => {
    const onChange = vi.fn();
    current = mount(<TempoSlider {...base} value={72} onChange={onChange} />);
    setNativeValue(q<HTMLInputElement>('input[type=range]'), '90', 'input');
    expect(onChange).toHaveBeenCalledWith(90);
  });

  it('commits a typed value on blur', () => {
    const onChange = vi.fn();
    current = mount(<TempoSlider {...base} value={72} onChange={onChange} />);
    const field = q<HTMLInputElement>('input[type=number]');
    setNativeValue(field, '96', 'input');
    expect(onChange).not.toHaveBeenCalled();
    blur(field);
    expect(onChange).toHaveBeenCalledWith(96);
  });

  it('clamps a typed value to the level range on Enter', () => {
    const onChange = vi.fn();
    current = mount(<TempoSlider {...base} value={72} onChange={onChange} />);
    const field = q<HTMLInputElement>('input[type=number]');
    setNativeValue(field, '250', 'input');
    key(field, 'Enter');
    expect(onChange).toHaveBeenCalledWith(200);
  });

  it('Escape reverts a typed value without committing', () => {
    const onChange = vi.fn();
    current = mount(<TempoSlider {...base} value={72} onChange={onChange} />);
    const field = q<HTMLInputElement>('input[type=number]');
    setNativeValue(field, '150', 'input');
    key(field, 'Escape');
    blur(field);
    expect(onChange).not.toHaveBeenCalled();
    expect(field.value).toBe('72');
  });

  it('ignores an empty or non-numeric entry', () => {
    const onChange = vi.fn();
    current = mount(<TempoSlider {...base} value={72} onChange={onChange} />);
    const field = q<HTMLInputElement>('input[type=number]');
    setNativeValue(field, '', 'input');
    blur(field);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled disables both controls', () => {
    current = mount(<TempoSlider {...base} value={72} onChange={vi.fn()} disabled />);
    expect(q<HTMLInputElement>('input[type=range]').disabled).toBe(true);
    expect(q<HTMLInputElement>('input[type=number]').disabled).toBe(true);
  });
});
