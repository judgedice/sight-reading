import { createElement } from 'react';
import type { ScreenOverrides } from '../../routes.tsx';
import type { ScreenComponent } from '../../route-types.ts';
import { ResultsScreen, ResultsServicesProvider } from './ResultsScreen.tsx';
import type { ResultsServices } from './services.ts';

export { ResultsScreen, ResultsServicesProvider } from './ResultsScreen.tsx';
export { ResultsPanel, cardId, type ResultsHandlers, type ResultsPanelProps } from './ResultsPanel.tsx';
export * from './model.ts';
export type { ResultsActions, ResultsServices, RankUpMemory } from './services.ts';
export { text, PENDING_COPY, type TextKey, type PendingKey } from './text.ts';

/** The results route screen with its services bound. */
export function createResultsScreen(services: ResultsServices): ScreenComponent {
  return function BoundResultsScreen(props) {
    return createElement(ResultsServicesProvider, { value: services }, createElement(ResultsScreen, props));
  };
}

/** Route overrides for createRouteTable: replaces the results placeholder. */
export function resultsScreenOverrides(services: ResultsServices): ScreenOverrides {
  return { 'practice.results': createResultsScreen(services) };
}
