export { OnboardingScreen } from './OnboardingScreen.tsx';
export { OnboardingServicesProvider, useOnboardingServices } from './services.ts';
export type { MicOutcome, OnboardingResult, OnboardingServices } from './services.ts';
export { initialOnboarding, onboardingReducer, restoreProgress, resumeState, STEP_COUNT, type OnboardingEvent, type OnboardingProgress, type OnboardingState, type OnboardingStep } from './flow.ts';

import type { ScreenOverrides } from '../../routes.tsx';
import { OnboardingScreen } from './OnboardingScreen.tsx';

/** Route overrides for `createRouteTable` (D1 notes): the welcome route. */
export const onboardingRoutes: ScreenOverrides = { welcome: OnboardingScreen };
