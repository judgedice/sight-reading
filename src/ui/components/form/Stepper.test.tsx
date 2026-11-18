// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../../primitives/test-render.ts';
import { copy } from '../../copy/copy.ts';
import { Stepper } from './Stepper.tsx';
import { q } from './test-helpers.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});

const props = { ariaLabel: 'Bars', decrementLabel: 'Fewer bars', incrementLabel: 'More bars' };

function buttons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.ui-stepper-button'));
}

describe('Stepper', () => {
  it('shows the value and labels its two buttons', () => {
    current = mount(<Stepper value={8} min={4} max={12} onChange={vi.fn()} {...props} />);
    expect(q('.ui-stepper-value').textContent).toBe('8');
    const [down, up] = buttons();
    expect(down?.getAttribute('aria-label')).toBe('Fewer bars');
    expect(up?.getAttribute('aria-label')).toBe('More bars');
    expect(q('[role=group]').getAttribute('aria-label')).toBe('Bars');
  });

  it('defaults the button names to the stepper copy keys', () => {
    current = mount(<Stepper value={8} min={4} max={12} onChange={vi.fn()} ariaLabel="Bars" />);
    const [down, up] = buttons();
    expect(down?.getAttribute('aria-label')).toBe(copy('stepper.decrease', { label: 'Bars' }));
    expect(up?.getAttribute('aria-label')).toBe(copy('stepper.increase', { label: 'Bars' }));
  });

  it('steps up and down by one within range', () => {
    const onChange = vi.fn();
    current = mount(<Stepper value={8} min={4} max={12} onChange={onChange} {...props} />);
    const [down, up] = buttons();
    click(up as HTMLButtonElement);
    expect(onChange).toHaveBeenLastCalledWith(9);
    click(down as HTMLButtonElement);
    expect(onChange).toHaveBeenLastCalledWith(7);
  });

  it('at a limit the button is aria-disabled, stays focusable and does nothing', () => {
    const onChange = vi.fn();
    current = mount(<Stepper value={12} min={4} max={12} onChange={onChange} {...props} />);
    const [, up] = buttons();
    expect(up?.getAttribute('aria-disabled')).toBe('true');
    expect(up?.disabled).toBe(false);
    click(up as HTMLButtonElement);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('skips disabledValues when stepping', () => {
    const onChange = vi.fn();
    current = mount(<Stepper value={3} min={1} max={6} disabledValues={[4]} onChange={onChange} {...props} />);
    click(buttons()[1] as HTMLButtonElement);
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('is disabled when every value in the direction is blocked', () => {
    const onChange = vi.fn();
    current = mount(<Stepper value={3} min={1} max={4} disabledValues={[4]} onChange={onChange} {...props} />);
    const up = buttons()[1];
    expect(up?.getAttribute('aria-disabled')).toBe('true');
    click(up as HTMLButtonElement);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('formats the displayed value with formatValue', () => {
    current = mount(
      <Stepper value={72} min={40} max={200} onChange={vi.fn()} formatValue={(n) => `${n} bpm`} {...props} />,
    );
    expect(q('.ui-stepper-value').textContent).toBe('72 bpm');
  });

  it('disabled blocks both directions', () => {
    const onChange = vi.fn();
    current = mount(<Stepper value={8} min={4} max={12} onChange={onChange} disabled {...props} />);
    for (const button of buttons()) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      click(button);
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});
