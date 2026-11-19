import type { ScreenOverrides } from '../../routes.tsx';
import type { ScreenComponent } from '../../route-types.ts';
import { createElement } from 'react';
import { HomeScreen, HomeServicesProvider } from './HomeScreen.tsx';
import type { HomeServices } from './services.ts';

export { HomeScreen, HomeServicesProvider, WIDE_QUERY } from './HomeScreen.tsx';
export * from './services.ts';
export * from './today.ts';

/** The Home route screen with its services bound. */
export function createHomeScreen(services: HomeServices): ScreenComponent {
  return function BoundHomeScreen(props) {
    return createElement(HomeServicesProvider, { value: services }, createElement(HomeScreen, props));
  };
}

/** Route overrides for createRouteTable: replaces the Home placeholder. */
export function homeScreenOverrides(services: HomeServices): ScreenOverrides {
  return { home: createHomeScreen(services) };
}
