// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../../primitives/test-render.ts';
import { SegmentedControl } from './SegmentedControl.tsx';
import { q } from './test-helpers.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});

const options = [
  { value: '4', label: '4/4' },
  { value: '6/8', label: '6/8', disabled: true, tooltip: 'Not enough music in 6/8 at this level yet' },
  { value: '3/4', label: '3/4' },
];

describe('SegmentedControl', () => {
  it('is a labelled radio group with one native radio per option', () => {
    current = mount(<SegmentedControl options={options} value="4" onChange={vi.fn()} ariaLabel="Time" />);
    const group = q('[role=radiogroup]');
    expect(group.getAttribute('aria-label')).toBe('Time');
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=radio]'));
    expect(radios).toHaveLength(3);
    // One shared name puts the radios in one group, so native arrow keys move the selection.
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
  });

  it('marks the selected segment as checked and styled', () => {
    current = mount(<SegmentedControl options={options} value="3/4" onChange={vi.fn()} ariaLabel="Time" />);
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=radio]'));
    expect(radios.map((r) => r.checked)).toEqual([false, false, true]);
    expect(document.querySelectorAll('.ui-segment-selected')).toHaveLength(1);
  });

  it('calls onChange with the option value when a segment is chosen', () => {
    const onChange = vi.fn();
    current = mount(<SegmentedControl options={options} value="4" onChange={onChange} ariaLabel="Time" />);
    click(document.querySelectorAll<HTMLInputElement>('input[type=radio]')[2] as HTMLInputElement);
    expect(onChange).toHaveBeenCalledWith('3/4');
  });

  it('disabled options are native disabled, aria-disabled, and not choosable', () => {
    const onChange = vi.fn();
    current = mount(<SegmentedControl options={options} value="4" onChange={onChange} ariaLabel="Time" />);
    const disabled = document.querySelectorAll<HTMLInputElement>('input[type=radio]')[1] as HTMLInputElement;
    expect(disabled.disabled).toBe(true);
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    click(disabled);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('describes a disabled option by its tooltip', () => {
    current = mount(<SegmentedControl options={options} value="4" onChange={vi.fn()} ariaLabel="Time" />);
    const disabled = document.querySelectorAll<HTMLInputElement>('input[type=radio]')[1] as HTMLInputElement;
    const describedBy = disabled.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Not enough music in 6/8 at this level yet');
  });
});
