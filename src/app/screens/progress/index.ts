import { createElement } from 'react';
import type { ScreenOverrides } from '../../routes.tsx';
import type { ScreenComponent } from '../../route-types.ts';
import { ProgressScreen, ProgressServicesProvider } from './ProgressScreen.tsx';
import type { ProgressServices } from './services.ts';

export { ProgressScreen, ProgressServicesProvider } from './ProgressScreen.tsx';
export * from './model.ts';
export type { ProgressServices } from './services.ts';
export { text as progressText, PENDING_COPY as PROGRESS_PENDING_COPY } from './text.ts';

/** The progress route screen with its services bound. */
export function createProgressScreen(services: ProgressServices): ScreenComponent {
  return function BoundProgressScreen(props) {
    return createElement(ProgressServicesProvider, { value: services }, createElement(ProgressScreen, props));
  };
}

/** Route overrides for createRouteTable: replaces the progress placeholder. */
export function progressScreenOverrides(services: ProgressServices): ScreenOverrides {
  return { progress: createProgressScreen(services) };
}
