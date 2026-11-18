// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../../copy/copy.ts';
import { click, mount, type Mounted } from '../../primitives/test-render.ts';
import { Banner } from './Banner.tsx';
import { q } from '../form/test-helpers.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});

describe('Banner', () => {
  it('defaults to info: polite status, info icon, accent bar', () => {
    current = mount(<Banner text="Heads up" />);
    const banner = q('.ui-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.classList.contains('ui-banner-info')).toBe(true);
    expect(q('.ui-banner-icon use').getAttribute('href')).toBe('#info');
    expect(q('.ui-banner-text').textContent).toBe('Heads up');
  });

  it.each([
    ['caution', '#alert-triangle', 'status'],
    ['danger', '#alert-octagon', 'alert'],
  ] as const)('%s tone uses icon %s and role %s', (tone, href, role) => {
    current = mount(<Banner tone={tone} text="Check" />);
    expect(q('.ui-banner').getAttribute('role')).toBe(role);
    expect(q('.ui-banner-icon use').getAttribute('href')).toBe(href);
  });

  it('runs its action when clicked', () => {
    const onClick = vi.fn();
    current = mount(<Banner text="Mic off" action={{ label: 'Allow microphone', onClick }} />);
    const button = q('.ui-banner button');
    expect(button.textContent).toBe('Allow microphone');
    click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows no close control unless dismissible', () => {
    current = mount(<Banner text="Static" />);
    expect(document.querySelector('.ui-banner-dismiss')).toBeNull();
  });

  it('dismissible hides itself and calls onDismiss', () => {
    const onDismiss = vi.fn();
    current = mount(<Banner text="Closable" dismissible onDismiss={onDismiss} />);
    const close = q('.ui-banner-dismiss');
    expect(close.getAttribute('aria-label')).toBe(copy('shortcuts.escSheet'));
    click(close);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ui-banner')).toBeNull();
  });
});
