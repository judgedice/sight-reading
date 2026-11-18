// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../../copy/copy.ts';
import { click, mount, type Mounted } from '../../primitives/test-render.ts';
import { RandomChip } from './RandomChip.tsx';
import { q } from './test-helpers.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});

describe('RandomChip', () => {
  it('is an aria-pressed button labelled with the Random copy', () => {
    current = mount(<RandomChip pressed={false} onToggle={vi.fn()} />);
    const chip = q<HTMLButtonElement>('button');
    expect(chip.type).toBe('button');
    expect(chip.textContent).toBe(copy('chip.random'));
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('reflects pressed as aria-pressed and toggles to the opposite value on click', () => {
    const onToggle = vi.fn();
    current = mount(<RandomChip pressed onToggle={onToggle} />);
    const chip = q('button');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    click(chip);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('turns on when unpressed', () => {
    const onToggle = vi.fn();
    current = mount(<RandomChip pressed={false} onToggle={onToggle} />);
    click(q('button'));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('accepts a label override', () => {
    current = mount(<RandomChip pressed={false} onToggle={vi.fn()} label="Any key" />);
    expect(q('button').textContent).toBe('Any key');
  });
});
