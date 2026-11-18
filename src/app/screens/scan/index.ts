import type { ScreenOverrides } from '../../routes.tsx';
import type { ScreenComponent } from '../../route-types.ts';
import { createElement } from 'react';
import { PerformScreen } from '../perform/PerformScreen.tsx';
import { ScanScreen } from './ScanScreen.tsx';
import { PracticeFlowServicesProvider, type PracticeFlowServices } from './services.ts';

export { ScanScreen } from './ScanScreen.tsx';
export { PracticeFlowServicesProvider, usePracticeFlowServices } from './services.ts';
export type { PracticeFlowServices, PracticeSessionPort } from './services.ts';
export * from './model.ts';

function bind(services: PracticeFlowServices, Screen: ScreenComponent): ScreenComponent {
  return function BoundPracticeScreen(props) {
    return createElement(PracticeFlowServicesProvider, { value: services }, createElement(Screen, props));
  };
}

/** Route overrides for `createRouteTable`: replaces the `practice.scan` and `practice.play` placeholders. */
export function practiceFlowScreenOverrides(services: PracticeFlowServices): ScreenOverrides {
  return { 'practice.scan': bind(services, ScanScreen), 'practice.play': bind(services, PerformScreen) };
}
