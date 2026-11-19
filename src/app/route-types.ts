import type { ComponentType } from 'react';
import type { CopyKey } from '../ui/copy/copy.ts';
import type { MatchedRoute, PatternRoute, TabId } from './route-match.ts';

export type RouteChrome = 'full' | 'onboarding' | 'loop' | 'none';

/** What a redirect may depend on. */
export interface RedirectContext {
  /** True while a take's result is open (a result the player has not left). */
  resultOpen: boolean;
}

export interface RouteDef extends PatternRoute {
  /** Catalogue key of the screen title (document title, placeholder heading). Null: show the path. */
  titleKey: CopyKey | null;
  /** Which centre tab or bottom tab is current on this route. */
  tab: TabId | null;
  /**
   * `full`: brand, tabs and settings gear. `onboarding`: brand only (the screen holds its own Back). `loop`: no app bar and
   * no tabs; the screen's toolbar has Home at left. `none`: nothing at all (the take).
   */
  chrome: RouteChrome;
  /**
   * Where a visit to this route goes instead. The router replaces the history entry, so Back does not return here.
   * Resolved before the screen renders; the screen of a redirecting route is never shown.
   */
  redirect?: ((ctx: RedirectContext) => string) | undefined;
  Screen: ScreenComponent;
}

/** What a screen component receives. */
export interface ScreenProps {
  route: MatchedRoute<RouteDef>;
}

export type ScreenComponent = ComponentType<ScreenProps>;
