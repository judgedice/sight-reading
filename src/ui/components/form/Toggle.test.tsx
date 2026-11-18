// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../../primitives/test-render.ts';
import { Toggle } from './Toggle.tsx';
import { q } from './test-helpers.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});

describe('Toggle', () => {
  it('is a native checkbox with role switch, named by its label', () => {
    current = mount(<Toggle checked={false} label="Show tips" onChange={vi.fn()} />);
    const input = q<HTMLInputElement>('input');
    expect(input.type).toBe('checkbox');
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.checked).toBe(false);
    expect(q('label').textContent).toBe('Show tips');
  });

  it('reports the new state when clicked', () => {
    const onChange = vi.fn();
    current = mount(<Toggle checked={false} label="Show tips" onChange={onChange} />);
    click(q('input'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reports off when a checked switch is clicked', () => {
    const onChange = vi.fn();
    current = mount(<Toggle checked label="Show tips" onChange={onChange} />);
    expect(q<HTMLInputElement>('input').checked).toBe(true);
    click(q('input'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('disabled is native disabled with aria-disabled and does not change', () => {
    const onChange = vi.fn();
    current = mount(<Toggle checked={false} label="Beta" disabled onChange={onChange} />);
    const input = q<HTMLInputElement>('input');
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-disabled')).toBe('true');
    click(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
