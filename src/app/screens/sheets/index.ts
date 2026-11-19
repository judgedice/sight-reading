import { useEffect, useSyncExternalStore } from 'react';
import { useNavigate } from '../../router.tsx';
import type { ScreenOverrides } from '../../routes.tsx';
import type { ScreenComponent } from '../../route-types.ts';
import type { TipsServices } from './services.ts';

export { StopSheet, stopVariant, type StopSheetProps, type StopVariant } from './StopSheet.tsx';
export { SkipSheet, type SkipSheetProps } from './SkipSheet.tsx';
export { RankUpCard, nextRankRequirement, type RankUpCardProps } from './RankUpCard.tsx';
export { InstallCoach, installCoachDue, type InstallCoachProps } from './InstallCoach.tsx';
export { SessionSummary, type SessionSummaryProps } from './SessionSummary.tsx';
export { attemptTitle, skipToastText, summarizeSession, summaryDue, type SessionSummaryData } from './summary.ts';
export type { TipsServices } from './services.ts';

/**
 * The tips step is gone from the loop: tips live in results as "One thing to try" (05 section 3.1, decision 13). The
 * route's own redirect sends `#/practice/tips` to the open result or to Practice before any screen renders; this
 * screen only backs that up (it draws nothing and moves on the same way) for a table built without the redirect.
 */
export function createTipsRedirect(services: Pick<TipsServices, 'session'>): ScreenComponent {
  return function TipsRedirect() {
    const navigate = useNavigate();
    const view = useSyncExternalStore(services.session.subscribe, services.session.getState, services.session.getState);
    const open = view.record !== null;
    useEffect(() => {
      navigate(open ? '/practice/results' : '/', { replace: true });
    }, [open, navigate]);
    return null;
  };
}

/** Route overrides for createRouteTable: `#/practice/tips` goes back to results or Practice. */
export function tipsScreenOverrides(services: TipsServices): ScreenOverrides {
  return { 'practice.tips': createTipsRedirect(services) };
}
