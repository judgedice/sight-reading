import type { ComponentType } from 'react';
import type { CopyKey } from '../ui/copy/copy.ts';
import type { MatchedRoute, PatternRoute, TabId } from './route-match.ts';

export interface RouteDef extends PatternRoute {
  /** Catalogue key of the screen title (document title, placeholder heading). Null: show the path. */
  titleKey: CopyKey | null;
  /** Which centre tab or bottom tab is current on this route. */
  tab: TabId | null;
  /** "none" hides the app bar and tab bar (the take, 04 section 3.2). */
  chrome: 'full' | 'none';
  Screen: ScreenComponent;
}

/** What a screen component receives. */
export interface ScreenProps {
  route: MatchedRoute<RouteDef>;
}

export type ScreenComponent = ComponentType<ScreenProps>;
