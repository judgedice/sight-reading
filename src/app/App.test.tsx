// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../ui/copy/copy.ts';
import { act, click, mount, type Mounted } from '../ui/primitives/test-render.ts';
import { App } from './App.tsx';
import { applyAppearance, appearanceFromSettings, DEFAULT_APPEARANCE } from './appearance.tsx';
import type { LocationSource } from './router.tsx';

function fakeLocation(initial = ''): LocationSource & { hash: string } {
  const listeners = new Set<() => void>();
  const loc = {
    hash: initial,
    getHash: () => loc.hash,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    navigate(path: string) {
      loc.hash = `#${path}`;
      listeners.forEach((l) => l());
    },
  };
  return loc;
}

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-contrast');
  document.documentElement.removeAttribute('data-motion');
  document.documentElement.removeAttribute('data-paper');
});

const text = (sel: string): string => document.querySelector(sel)?.textContent ?? '';

describe('App shell', () => {
  it('renders Home with the app bar, three tabs and a settings link', () => {
    mounted = mount(<App location={fakeLocation('')} dev={false} />);
    expect(document.querySelector('[data-testid=screen-home]')).not.toBeNull();
    const tabs = Array.from(document.querySelectorAll('.app-tab'));
    expect(tabs.map((t) => t.textContent)).toEqual([copy('nav.practice'), copy('nav.progress'), copy('nav.history')]);
    expect(tabs[0]?.getAttribute('aria-current')).toBe('page');
    expect(tabs[1]?.hasAttribute('aria-current')).toBe(false);
    expect(document.querySelector('.app-gear')?.getAttribute('aria-label')).toBe(copy('nav.settings'));
    expect(document.querySelector('.app-gear use')?.getAttribute('href')).toBe('#settings');
    expect(document.title).toBe(`${copy('nav.practice')} | ${copy('app.name')}`);
  });

  it('follows hash changes and moves the current tab', () => {
    const loc = fakeLocation('#/progress');
    mounted = mount(<App location={loc} dev={false} />);
    expect(document.querySelector('[data-testid=screen-progress]')).not.toBeNull();
    expect(document.querySelector('.app-tab[aria-current=page]')?.textContent).toBe(copy('nav.progress'));
    act(() => loc.navigate('/history/abc', false));
    expect(document.querySelector('[data-route-id="history.attempt"]')).not.toBeNull();
    expect(document.querySelector('.app-tab[aria-current=page]')?.textContent).toBe(copy('nav.history'));
    expect(text('section p')).toBe('/history/abc');
  });

  it('moves focus to main after a navigation but not on first render', () => {
    const loc = fakeLocation('');
    mounted = mount(<App location={loc} dev={false} />);
    expect(document.activeElement).toBe(document.body);
    act(() => loc.navigate('/credits', false));
    expect(document.activeElement).toBe(document.querySelector('main'));
  });

  it('hides the app bar and tab bar during the take', () => {
    mounted = mount(<App location={fakeLocation('#/practice/play')} dev={false} />);
    expect(document.querySelector('header')).toBeNull();
    expect(document.querySelector('.app-tabs')).toBeNull();
    expect(document.querySelector('main')).not.toBeNull();
  });

  it('shows the not-found screen for an unknown route and for dev routes in production', () => {
    mounted = mount(<App location={fakeLocation('#/dev/components')} dev={false} />);
    expect(document.querySelector('[data-route-id=not-found]')).not.toBeNull();
    mounted.render(<App location={fakeLocation('#/zzz')} dev={false} />);
    expect(document.querySelector('[data-route-id=not-found]')).not.toBeNull();
  });

  it('offers the Start practice skip link first on Home and it focuses Start', () => {
    mounted = mount(<App location={fakeLocation('')} dev={false} />);
    const skip = document.querySelector<HTMLElement>('.app-skip-link');
    expect(skip?.textContent).toBe(copy('nav.skipToStart'));
    const focusables = document.querySelectorAll('button, a[href]');
    expect(focusables[0]).toBe(skip);
    click(skip as HTMLElement);
    expect(document.activeElement?.id).toBe('start-practice');
  });

  it('renders the component fixtures on /dev/components in dev and opens a modal that traps focus', () => {
    mounted = mount(<App location={fakeLocation('#/dev/components')} dev />);
    const first = document.querySelector<HTMLElement>('[data-testid=screen-dev-components] button');
    expect(first).not.toBeNull();
    click(first as HTMLElement);
    expect(document.querySelector('[role=dialog]')?.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.textContent).toBe(copy('action.keepReading'));
  });

  it('shows a toast from the fixtures page', () => {
    mounted = mount(<App location={fakeLocation('#/dev/components')} dev />);
    const buttons = document.querySelectorAll<HTMLElement>('[data-testid=screen-dev-components] button');
    click(buttons[4] as HTMLElement);
    expect(text('.ui-toast-region')).toContain(copy('toast.saved'));
  });
});

describe('appearance', () => {
  const root = (): HTMLElement => document.createElement('html');

  it('system theme leaves data-theme off and resolves paper from the system', () => {
    const el = root();
    expect(applyAppearance(el, DEFAULT_APPEARANCE, true)).toBe('dark');
    expect(el.hasAttribute('data-theme')).toBe(false);
    expect(el.getAttribute('data-paper')).toBe('dark');
    expect(applyAppearance(el, DEFAULT_APPEARANCE, false)).toBe('light');
    expect(el.getAttribute('data-paper')).toBe('light');
  });

  it('explicit themes win over the system', () => {
    const el = root();
    applyAppearance(el, { ...DEFAULT_APPEARANCE, theme: 'dark' }, false);
    expect(el.getAttribute('data-theme')).toBe('dark');
    expect(el.getAttribute('data-paper')).toBe('dark');
    applyAppearance(el, { ...DEFAULT_APPEARANCE, theme: 'light' }, true);
    expect(el.getAttribute('data-theme')).toBe('light');
    expect(el.getAttribute('data-paper')).toBe('light');
  });

  it('sets and clears high contrast and reduced motion', () => {
    const el = root();
    applyAppearance(el, { theme: 'system', highContrast: true, reduceMotion: 'on' }, false);
    expect(el.getAttribute('data-contrast')).toBe('high');
    expect(el.getAttribute('data-motion')).toBe('reduced');
    applyAppearance(el, { theme: 'system', highContrast: false, reduceMotion: 'off' }, false);
    expect(el.hasAttribute('data-contrast')).toBe(false);
    expect(el.getAttribute('data-motion')).toBe('full');
    applyAppearance(el, DEFAULT_APPEARANCE, false);
    expect(el.hasAttribute('data-motion')).toBe(false);
  });

  it('applies settings to <html> through the provider and updates on change', () => {
    const settings = {
      display: { theme: 'dark' as const, liveFeedback: 'full' as const, showCentsMs: false },
      accessibility: { reduceMotion: 'on' as const, highContrast: true, keyboardShortcuts: true, announceResults: false },
    };
    mounted = mount(<App location={fakeLocation('')} dev={false} appearance={appearanceFromSettings(settings)} />);
    const html = document.documentElement;
    expect(html.getAttribute('data-theme')).toBe('dark');
    expect(html.getAttribute('data-contrast')).toBe('high');
    expect(html.getAttribute('data-motion')).toBe('reduced');
    mounted.render(<App location={fakeLocation('')} dev={false} appearance={DEFAULT_APPEARANCE} />);
    expect(html.hasAttribute('data-theme')).toBe(false);
    expect(html.hasAttribute('data-motion')).toBe(false);
  });
});
