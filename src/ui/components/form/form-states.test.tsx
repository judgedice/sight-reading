// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { click, mount, type Mounted } from '../../primitives/test-render.ts';
import { Button } from './Button.tsx';
import { SegmentedControl } from './SegmentedControl.tsx';
import { Stepper } from './Stepper.tsx';
import { Toggle } from './Toggle.tsx';
import { q } from './test-helpers.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});

describe('Toggle (switch)', () => {
  it('is role=switch, reflects state, toggles on click and draws a check for the on state', () => {
    let value = false;
    current = mount(<Toggle checked={value} label="Follow my progress" onChange={(v) => (value = v)} />);
    const input = q<HTMLInputElement>('input');
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.checked).toBe(false);
    expect(q('.ui-toggle-track use').getAttribute('href')).toBe('#check-ui');
    click(input);
    expect(value).toBe(true);
    current.render(<Toggle checked label="Follow my progress" onChange={() => undefined} />);
    expect(q<HTMLInputElement>('input').checked).toBe(true);
  });
});

describe('Button kinds', () => {
  it.each(['tonal', 'quiet'] as const)('maps %s', (variant) => {
    current = mount(<Button label="x" variant={variant} />);
    expect(q('button').classList.contains(`ui-button-${variant}`)).toBe(true);
  });

  it('shows a kbd hint outside the accessible name', () => {
    current = mount(<Button label="Start playing" variant="primary" size="hero" kbd="Space" />);
    const kbd = q('kbd');
    expect(kbd.textContent).toBe('Space');
    expect(kbd.getAttribute('aria-hidden')).toBe('true');
  });

  it('loading sets aria-busy and swaps the icon for a spinner', () => {
    current = mount(<Button label="Save" icon="play" loading />);
    expect(q('button').getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('.ui-form-spinner')).not.toBeNull();
    expect(document.querySelector('button svg')).toBeNull();
  });
});

describe('SegmentedControl caption', () => {
  it('renders a second line and keeps the name to the label', () => {
    current = mount(
      <SegmentedControl ariaLabel="Time" value="a" onChange={() => undefined} options={[{ value: 'a', label: 'Any', caption: '+8% XP' }, { value: 'b', label: '3/4' }]} />,
    );
    expect(q('.ui-segment-caption').textContent).toBe('+8% XP');
    const input = q('input');
    const described = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe('+8% XP');
  });
});

describe('Stepper value cell', () => {
  it('shows the muted suffix', () => {
    current = mount(<Stepper value={2} min={1} max={10} ariaLabel="Difficulty" valueSuffix="of 10" onChange={() => undefined} />);
    expect(q('.ui-stepper-value').textContent).toBe('2of 10');
    expect(q('.ui-stepper-suffix').textContent).toBe('of 10');
  });
});

