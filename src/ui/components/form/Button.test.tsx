// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../../primitives/test-render.ts';
import { Button } from './Button.tsx';
import { q } from './test-helpers.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});

describe('Button', () => {
  it('renders a native button of type button with its label as the accessible name', () => {
    current = mount(<Button label="Start" variant="primary" />);
    const button = q<HTMLButtonElement>('button');
    expect(button.type).toBe('button');
    expect(button.textContent).toBe('Start');
    expect(button.classList.contains('ui-button-primary')).toBe(true);
    expect(button.classList.contains('ui-button-default')).toBe(true);
  });

  it('defaults to the secondary variant', () => {
    current = mount(<Button label="Credits" />);
    expect(q('button').classList.contains('ui-button-secondary')).toBe(true);
  });

  it.each([
    ['primary', 'ui-button-primary'],
    ['secondary', 'ui-button-secondary'],
    ['tertiary', 'ui-button-tertiary'],
    ['danger', 'ui-button-danger'],
  ] as const)('maps variant %s to %s', (variant, className) => {
    current = mount(<Button label="x" variant={variant} />);
    expect(q('button').classList.contains(className)).toBe(true);
  });

  it.each([
    ['compact', 'ui-button-compact'],
    ['default', 'ui-button-default'],
    ['hero', 'ui-button-hero'],
  ] as const)('maps size %s to %s', (size, className) => {
    current = mount(<Button label="x" size={size} />);
    expect(q('button').classList.contains(className)).toBe(true);
  });

  it('calls onClick when activated', () => {
    const onClick = vi.fn();
    current = mount(<Button label="Go" onClick={onClick} />);
    click(q('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled uses aria-disabled, stays focusable and ignores activation', () => {
    const onClick = vi.fn();
    current = mount(<Button label="Go" disabled onClick={onClick} />);
    const button = q<HTMLButtonElement>('button');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading shows a spinner, sets aria-busy and ignores activation', () => {
    const onClick = vi.fn();
    current = mount(<Button label="Save" loading onClick={onClick} />);
    const button = q<HTMLButtonElement>('button');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.ui-form-spinner')).not.toBeNull();
    click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders the icon as a decorative glyph reference', () => {
    current = mount(<Button label="Stop" icon="stop" />);
    const use = q('button svg use');
    expect(use.getAttribute('href')).toBe('#stop');
    expect(q('button svg').getAttribute('aria-hidden')).toBe('true');
  });
});
