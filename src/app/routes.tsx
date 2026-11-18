import type { CopyKey } from '../ui/copy/copy.ts';
import { SETTINGS_SECTIONS, type RouteId, type TabId } from './route-match.ts';
import type { RouteDef, ScreenComponent } from './route-types.ts';
import { DevComponentsScreen } from './screens/DevComponents.tsx';
import { NotFoundScreen, PlaceholderScreen } from './screens/Placeholder.tsx';

type Spec = Omit<RouteDef, 'Screen'>;

const specs: readonly Spec[] = [
  { id: 'welcome', pattern: '/welcome', titleKey: 'welcome.headline', tab: null, chrome: 'full', devOnly: false },
  { id: 'home', pattern: '/', titleKey: 'nav.practice', tab: 'practice', chrome: 'full', devOnly: false },
  { id: 'practice.scan', pattern: '/practice/scan', titleKey: 'nav.practice', tab: 'practice', chrome: 'full', devOnly: false },
  { id: 'practice.play', pattern: '/practice/play', titleKey: 'nav.practice', tab: 'practice', chrome: 'none', devOnly: false },
  { id: 'practice.results', pattern: '/practice/results', titleKey: 'nav.practice', tab: 'practice', chrome: 'full', devOnly: false },
  { id: 'practice.tips', pattern: '/practice/tips', titleKey: 'nav.practice', tab: 'practice', chrome: 'full', devOnly: false },
  { id: 'progress', pattern: '/progress', titleKey: 'nav.progress', tab: 'progress', chrome: 'full', devOnly: false },
  { id: 'history', pattern: '/history', titleKey: 'nav.history', tab: 'history', chrome: 'full', devOnly: false },
  { id: 'history.attempt', pattern: '/history/:attemptId', titleKey: 'nav.history', tab: 'history', chrome: 'full', devOnly: false },
  { id: 'settings', pattern: '/settings', titleKey: 'settings.title', tab: null, chrome: 'full', devOnly: false },
  {
    id: 'settings',
    pattern: '/settings/:section',
    titleKey: 'settings.title',
    tab: null,
    chrome: 'full',
    devOnly: false,
    validate: (p) => (SETTINGS_SECTIONS as readonly string[]).includes(p['section'] ?? ''),
  },
  { id: 'calibrate', pattern: '/calibrate', titleKey: 'action.calibrate', tab: null, chrome: 'full', devOnly: false },
  { id: 'credits', pattern: '/credits', titleKey: 'common.credits', tab: null, chrome: 'full', devOnly: false },
  { id: 'dev.components', pattern: '/dev/components', titleKey: null, tab: null, chrome: 'full', devOnly: true },
  { id: 'dev.replay', pattern: '/dev/replay', titleKey: null, tab: null, chrome: 'full', devOnly: true },
];

/** Shown for a path no route matches. Never listed in the table. */
export const notFoundRoute: RouteDef = {
  id: 'not-found',
  pattern: '/*',
  titleKey: 'notFound.title',
  tab: null,
  chrome: 'full',
  devOnly: false,
  Screen: NotFoundScreen,
};

export type { RouteDef, ScreenComponent, ScreenProps } from './route-types.ts';

export type ScreenOverrides = Partial<Record<RouteId, ScreenComponent>>;

/**
 * The typed route table. Later packages replace placeholders by passing overrides keyed by route id
 * (the composition root does this), never by editing this file.
 */
export function createRouteTable(overrides: ScreenOverrides = {}): readonly RouteDef[] {
  return specs.map((spec) => ({
    ...spec,
    Screen: overrides[spec.id] ?? (spec.id === 'dev.components' ? DevComponentsScreen : PlaceholderScreen),
  }));
}

export const routeTable: readonly RouteDef[] = createRouteTable();

/** Routes that appear in the app bar tabs, in order. */
export const TABS: readonly { id: TabId; path: string; labelKey: CopyKey }[] = [
  { id: 'practice', path: '/', labelKey: 'nav.practice' },
  { id: 'progress', path: '/progress', labelKey: 'nav.progress' },
  { id: 'history', path: '/history', labelKey: 'nav.history' },
];
