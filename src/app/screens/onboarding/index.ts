export { OnboardingScreen } from './OnboardingScreen.tsx';
export { OnboardingServicesProvider, useOnboardingServices } from './services.ts';
export type { LevelChoice, MicOutcome, OnboardingResult, OnboardingServices } from './services.ts';
export { initialOnboarding, onboardingReducer, STEP_COUNT, type OnboardingEvent, type OnboardingState, type OnboardingStep } from './flow.ts';

import type { ScreenOverrides } from '../../routes.tsx';
import { OnboardingScreen } from './OnboardingScreen.tsx';

/** Route overrides for `createRouteTable` (D1 notes): the welcome route. */
export const onboardingRoutes: ScreenOverrides = { welcome: OnboardingScreen };
