import { createElement } from 'react';
import type { ScreenOverrides, ScreenProps } from '../../routes.tsx';
import { MatchScreen, MatchServicesProvider } from './MatchScreen.tsx';
import type { MatchServices } from './services.ts';

export { MatchScreen, MatchServicesProvider } from './MatchScreen.tsx';
export { MatchPanel } from './MatchPanel.tsx';
export { useMatch, type MatchController, type MatchEngine, type MicGate } from './use-match.ts';
export type { MatchServices } from './services.ts';

/** Route overrides for `createRouteTable`: `#/match` bound to its services. */
export function matchScreenOverrides(services: MatchServices): ScreenOverrides {
  return {
    match: function MatchRoute(props: ScreenProps) {
      return createElement(MatchServicesProvider, { value: services }, createElement(MatchScreen, props));
    },
  };
}
