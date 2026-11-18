import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppSettings } from '../core/types.ts';

/** The slice of AppSettings that drives the root attributes (04 section 7.6, 7.3, 7.1). */
export interface AppearanceSettings {
  theme: AppSettings['display']['theme'];
  highContrast: boolean;
  reduceMotion: AppSettings['accessibility']['reduceMotion'];
}

export const DEFAULT_APPEARANCE: AppearanceSettings = { theme: 'system', highContrast: false, reduceMotion: 'system' };

export function appearanceFromSettings(s: Pick<AppSettings, 'display' | 'accessibility'>): AppearanceSettings {
  return { theme: s.display.theme, highContrast: s.accessibility.highContrast, reduceMotion: s.accessibility.reduceMotion };
}

export type ResolvedTheme = 'light' | 'dark';

/**
 * Sets the attributes tokens.css keys on:
 * - data-theme: only for an explicit light or dark; absent means "follow the system".
 * - data-paper: the resolved theme (dark theme always uses dark paper in v1).
 * - data-contrast="high" when high contrast is on.
 * - data-motion="reduced" for Reduce motion On (zeroes every --dur-* token); "full" for Off, which
 *   tokens.css uses to restore the durations under a system reduced-motion preference; absent for System.
 */
export function applyAppearance(root: HTMLElement, settings: AppearanceSettings, systemDark: boolean): ResolvedTheme {
  const resolved: ResolvedTheme = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;
  if (settings.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', settings.theme);
  root.setAttribute('data-paper', resolved);
  if (settings.highContrast) root.setAttribute('data-contrast', 'high');
  else root.removeAttribute('data-contrast');
  if (settings.reduceMotion === 'on') root.setAttribute('data-motion', 'reduced');
  else if (settings.reduceMotion === 'off') root.setAttribute('data-motion', 'full');
  else root.removeAttribute('data-motion');
  return resolved;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemDarkQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
}

const ResolvedThemeContext = createContext<ResolvedTheme>('light');

/** The theme in effect (system resolved). Score renderers that need explicit colours re-render on change. */
export function useResolvedTheme(): ResolvedTheme {
  return useContext(ResolvedThemeContext);
}

export interface AppearanceProviderProps {
  settings?: AppearanceSettings;
  /** Element that carries the attributes. Defaults to <html>. */
  root?: HTMLElement;
  children: ReactNode;
}

export function AppearanceProvider({ settings = DEFAULT_APPEARANCE, root, children }: AppearanceProviderProps) {
  const [systemDark, setSystemDark] = useState(() => systemDarkQuery()?.matches ?? false);
  useEffect(() => {
    const mq = systemDarkQuery();
    if (!mq) return undefined;
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    setSystemDark(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const { theme, highContrast, reduceMotion } = settings;
  const resolved: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  useEffect(() => {
    applyAppearance(root ?? document.documentElement, { theme, highContrast, reduceMotion }, systemDark);
  }, [root, theme, highContrast, reduceMotion, systemDark]);

  return <ResolvedThemeContext.Provider value={resolved}>{children}</ResolvedThemeContext.Provider>;
}
