import { createElement } from 'react';
import type { ScreenOverrides } from '../../routes.tsx';
import type { ScreenComponent, ScreenProps } from '../../route-types.ts';
import { CreditsScreen } from './CreditsScreen.tsx';
import type { CreditsServices } from './services.ts';

export { CreditsScreen } from './CreditsScreen.tsx';
export { SourceSheet, type SourceSheetProps } from './SourceSheet.tsx';
export * from './attribution.ts';
export type { CreditsServices } from './services.ts';
export { text as aboutText } from './text.ts';

/** The credits route screen with its services bound. */
export function createCreditsScreen(services: CreditsServices): ScreenComponent {
  return function BoundCreditsScreen(props: ScreenProps) {
    return createElement(CreditsScreen, { ...props, services });
  };
}

/** Route overrides for createRouteTable: replaces the credits placeholder. */
export function creditsScreenOverrides(services: CreditsServices): ScreenOverrides {
  return { credits: createCreditsScreen(services) };
}
