// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../../primitives/test-render.ts';
import { Select } from './Select.tsx';
import { q, setNativeValue } from './test-helpers.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma', disabled: true },
];

describe('Select', () => {
  it('is a native select named by ariaLabel, showing the current value', () => {
    current = mount(<Select options={options} value="b" onChange={vi.fn()} ariaLabel="Level" />);
    const select = q<HTMLSelectElement>('select');
    expect(select.getAttribute('aria-label')).toBe('Level');
    expect(select.value).toBe('b');
    expect(select.options).toHaveLength(3);
    expect(select.options[2]?.disabled).toBe(true);
  });

  it('reports the chosen value through onChange', () => {
    const onChange = vi.fn();
    current = mount(<Select options={options} value="a" onChange={onChange} ariaLabel="Level" />);
    setNativeValue(q<HTMLSelectElement>('select'), 'b', 'change');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('disabled sets the native disabled attribute and aria-disabled', () => {
    current = mount(<Select options={options} value="a" onChange={vi.fn()} ariaLabel="Level" disabled />);
    const select = q<HTMLSelectElement>('select');
    expect(select.disabled).toBe(true);
    expect(select.getAttribute('aria-disabled')).toBe('true');
  });

  it('draws the chevron as a decorative glyph', () => {
    current = mount(<Select options={options} value="a" onChange={vi.fn()} ariaLabel="Level" />);
    const icon = q('.ui-select-chevron');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.querySelector('use')?.getAttribute('href')).toBe('#chevron-down');
  });
});
