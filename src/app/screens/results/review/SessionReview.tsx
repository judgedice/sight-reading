/**
 * The review bound to the session (D8b): the prepared excerpt from the session view, the expected notes and tolerances
 * from session's `planTake`, the settings for numbers and shortcuts. `createReviewRenderer` gives the results screen's
 * `renderReview` service.
 */
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSettings, AttemptRecord, Configs, PreparedExcerpt } from '../../../../core/types.ts';
import { planTake, type SessionView, type TakePlan } from '../../../../session/index.ts';
import type { FrameNotation } from '../../../../ui/score-frame/index.ts';
import type { Readable } from '../../home/services.ts';
import type { ReviewBus } from './bus.ts';
import type { GhostSpeller } from './model.ts';
import { Review } from './Review.tsx';

export interface ReviewDeps {
  configs: Configs;
  session: StoreApi<SessionView>;
  settings: Readable<AppSettings>;
  loadNotation: () => Promise<FrameNotation>;
  /** follow's `ghostPitch` (the composition root may import follow/; app/ may not). */
  spell: GhostSpeller;
  /** Shared with the results panel's counts line (`reviewPanelHandlers(bus)`). */
  bus?: ReviewBus;
  /** For an attempt that is not the session's current one (history): its prepared excerpt, when the caller has it. */
  preparedFor?: (record: AttemptRecord) => PreparedExcerpt | null;
}

function safePlan(p: PreparedExcerpt, cfg: Configs): TakePlan | null {
  try {
    return planTake(p, cfg);
  } catch {
    return null;
  }
}

/** What the results screen adds around the review: the Listen bar wash, bar taps and the toolbar's right end. */
export interface ReviewExtras {
  highlightBar?: number | null;
  onBarTap?: (barIndex: number) => void;
  toolbarEnd?: ReactNode;
}

export function SessionReview({ record, deps, extras = {} }: { record: AttemptRecord; deps: ReviewDeps; extras?: ReviewExtras }) {
  const view = useSyncExternalStore(deps.session.subscribe, deps.session.getState, deps.session.getState);
  const settings = useSyncExternalStore(deps.settings.subscribe, deps.settings.get, deps.settings.get);
  const current = view.prepared && view.prepared.excerptId === record.excerptId ? view.prepared : null;
  const prepared = current ?? deps.preparedFor?.(record) ?? null;
  const plan = useMemo(() => (prepared ? safePlan(prepared, deps.configs) : null), [prepared, deps.configs]);
  // Nothing to draw without a score (an attempt from another session). A void take, or one with no judgments, shows
  // the clean score with no marks (05 section 16 item 17).
  if (!prepared || !plan) return null;
  const clean = record.endReason === 'void' || record.judgments.length === 0;
  return (
    <Review
      record={record}
      prepared={prepared}
      expected={plan.expected}
      tolerances={plan.tolerances}
      configs={deps.configs}
      loadNotation={deps.loadNotation}
      spell={deps.spell}
      showNumbers={settings.display.showCentsMs}
      keyboardShortcuts={settings.accessibility.keyboardShortcuts}
      {...(deps.bus ? { bus: deps.bus } : {})}
      clean={clean}
      {...(extras.highlightBar !== undefined ? { highlightBar: extras.highlightBar } : {})}
      {...(extras.onBarTap ? { onBarTap: extras.onBarTap } : {})}
      {...(extras.toolbarEnd ? { toolbarEnd: extras.toolbarEnd } : {})}
    />
  );
}

/** `ResultsServices.renderReview` for the composition root. */
export function createReviewRenderer(deps: ReviewDeps): (record: AttemptRecord, extras?: ReviewExtras) => ReactNode {
  return function renderReview(record, extras) {
    return <SessionReview key={record.id} record={record} deps={deps} {...(extras ? { extras } : {})} />;
  };
}
