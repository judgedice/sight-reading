import { createElement } from 'react';
import type { ScreenOverrides } from '../../routes.tsx';
import type { ScreenComponent } from '../../route-types.ts';
import { HistoryScreen, HistoryServicesProvider } from './HistoryScreen.tsx';
import { AttemptScreen, AttemptServicesProvider, type AttemptServices } from './AttemptScreen.tsx';
import type { HistoryServices } from './services.ts';

export { HistoryScreen, HistoryServicesProvider } from './HistoryScreen.tsx';
export { AttemptScreen, AttemptServicesProvider, type AttemptServices } from './AttemptScreen.tsx';
export * from './model.ts';
export type { HistoryServices } from './services.ts';
export { text as historyText, PENDING_COPY as HISTORY_PENDING_COPY } from './text.ts';

/** The history list route with its services bound. */
export function createHistoryScreen(services: HistoryServices): ScreenComponent {
  return function BoundHistoryScreen(props) {
    return createElement(HistoryServicesProvider, { value: services }, createElement(HistoryScreen, props));
  };
}

/** The attempt detail route with its services bound. */
export function createAttemptScreen(services: AttemptServices): ScreenComponent {
  return function BoundAttemptScreen(props) {
    return createElement(AttemptServicesProvider, { value: services }, createElement(AttemptScreen, props));
  };
}

/** Route overrides for createRouteTable: replaces the history and attempt placeholders. */
export function historyScreenOverrides(services: AttemptServices): ScreenOverrides {
  return { history: createHistoryScreen(services), 'history.attempt': createAttemptScreen(services) };
}
