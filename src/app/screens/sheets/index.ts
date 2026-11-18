import { createElement } from 'react';
import type { ScreenOverrides } from '../../routes.tsx';
import type { ScreenComponent } from '../../route-types.ts';
import { TipsScreen, TipsServicesProvider } from './TipsScreen.tsx';
import type { TipsServices } from './services.ts';

export { TipsScreen, TipsServicesProvider } from './TipsScreen.tsx';
export { StopSheet, stopVariant, type StopSheetProps, type StopVariant } from './StopSheet.tsx';
export { SkipSheet, type SkipSheetProps } from './SkipSheet.tsx';
export { RankUpCard, nextRankRequirement, type RankUpCardProps } from './RankUpCard.tsx';
export { InstallCoach, installCoachDue, type InstallCoachProps } from './InstallCoach.tsx';
export { SessionSummary, type SessionSummaryProps } from './SessionSummary.tsx';
export { attemptTitle, skipToastText, summarizeSession, summaryDue, type SessionSummaryData } from './summary.ts';
export type { TipsServices } from './services.ts';

/** The tips interstitial route screen with its services bound. */
export function createTipsScreen(services: TipsServices): ScreenComponent {
  return function BoundTipsScreen(props) {
    return createElement(TipsServicesProvider, { value: services }, createElement(TipsScreen, props));
  };
}

/** Route overrides for createRouteTable: replaces the tips placeholder. */
export function tipsScreenOverrides(services: TipsServices): ScreenOverrides {
  return { 'practice.tips': createTipsScreen(services) };
}
