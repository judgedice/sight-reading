/**
 * The Zustand store screens read (04 §3.3: "React reads them; it never drives audio"). It folds `SessionEvent`s into
 * a small view: state, the prepared excerpt, scan and count-in progress, the current bar and status message, and the
 * results. Per-note follower events (judgments, ghosts, missed) are not stored: the overlay subscribes to
 * `PracticeSession.events` directly, so a take never re-renders React per note (01 §10).
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type {
  AttemptRecord,
  Emitter,
  PracticeSettings,
  PreparedExcerpt,
  ProgressEvent,
  SessionErrorCode,
  SessionEvent,
  SessionState,
  Tip,
  VoidReason,
} from '../core/types.ts';
import { barOfBeat } from './take-plan.ts';

/** One status message at a time, highest first (04 §5.4.1). */
export type SessionStatus =
  | { kind: 'no-signal' }
  | { kind: 'lost-place' }
  | { kind: 'come-in-at'; bar: number }
  | { kind: 'restarting-count-in'; reason: 'first-click-missing' | 'stop-before-first-note' | 'rotation' };

export interface SessionView {
  state: SessionState;
  prepared: PreparedExcerpt | null;
  /** Strict scan countdown (04 §5.3); null outside the scan. */
  scan: { remainingSec: number; expired: boolean } | null;
  /** Count-in beat k of n (1-based); null outside the count-in. */
  countIn: { beat: number; of: number } | null;
  /** Displayed bar under the playhead during a take (pickup = 0); null outside a take. */
  bar: number | null;
  status: SessionStatus | null;
  /** A note was detected in this take (Stop confirm variants, 04 §5.10). */
  firstNoteHeard: boolean;
  record: AttemptRecord | null;
  tips: Tip[];
  progress: ProgressEvent[];
  voidReason: VoidReason | null;
  /** `kind` is set when a try could not start: the sound (`audio-start`) or the microphone (`mic-start`). */
  error: { code: SessionErrorCode; detail?: string; kind?: 'audio-start' | 'mic-start' } | null;
  emptyPoolSuggestions: Partial<PracticeSettings>[] | null;
  /** Route key whose calibration the results screen should offer to redo (R31). */
  recalibrateRouteKey: string | null;
  /**
   * Mode of the excerpt on screen as it stands now (Try again and Listen first make it practice); null before an
   * excerpt is prepared. The session sets it; no `SessionEvent` carries it.
   */
  mode: 'ranked' | 'practice' | null;
  /** The player listened first in a ranked read-through, so this take is practice (`listened-first`, decision 7). */
  listenedFirst: boolean;
}

export const initialSessionView = (): SessionView => ({
  state: 'idle',
  prepared: null,
  scan: null,
  countIn: null,
  bar: null,
  status: null,
  firstNoteHeard: false,
  record: null,
  tips: [],
  progress: [],
  voidReason: null,
  error: null,
  emptyPoolSuggestions: null,
  recalibrateRouteKey: null,
  mode: null,
  listenedFirst: false,
});

const STATUS_RANK: Record<SessionStatus['kind'], number> = { 'no-signal': 0, 'lost-place': 1, 'come-in-at': 2, 'restarting-count-in': 3 };

/** Applies one session event to the view. Pure; exported for tests and replay. */
export function reduceSessionView(v: SessionView, e: SessionEvent): SessionView {
  switch (e.type) {
    case 'state': {
      const next: SessionView = { ...v, state: e.state };
      if (e.state === 'loading') return { ...initialSessionView(), state: 'loading' };
      if (e.state === 'covered' || e.state === 'scanning') Object.assign(next, { countIn: null, bar: null, status: null, firstNoteHeard: false, record: null, tips: [], progress: [], voidReason: null, error: null, recalibrateRouteKey: null });
      if (e.state === 'count-in') Object.assign(next, { scan: null, countIn: null, bar: null, firstNoteHeard: false });
      if (e.state === 'performing') next.countIn = null;
      if (e.state === 'finishing' || e.state === 'results') Object.assign(next, { countIn: null, status: null });
      return next;
    }
    case 'prepared':
      return { ...v, prepared: e.excerpt, emptyPoolSuggestions: null, error: null };
    case 'empty-pool':
      return { ...v, emptyPoolSuggestions: e.suggestions };
    case 'scan-tick':
      return { ...v, scan: { remainingSec: e.remainingSec, expired: e.remainingSec <= 0 } };
    case 'count-in': {
      // "Restarting the count-in" says why the count starts again; from the new count-in's second click it has been
      // read, and the strip goes back to "Count-in" (it used to stay to bar 1, PLAN R70).
      const status = v.status?.kind === 'restarting-count-in' && e.beat >= 2 ? null : v.status;
      return { ...v, countIn: { beat: e.beat, of: e.of }, status };
    }
    case 'count-in-restart':
      return { ...v, countIn: null, firstNoteHeard: false, status: { kind: 'restarting-count-in', reason: e.reason } };
    case 'follower':
      return reduceFollower(v, e.event);
    case 'void':
      return { ...v, voidReason: e.reason };
    case 'record':
      return { ...v, record: e.record };
    case 'progress':
      return { ...v, progress: e.events };
    case 'tips':
      return { ...v, tips: e.tips };
    case 'recalibrate-prompt':
      return { ...v, recalibrateRouteKey: e.routeKey };
    case 'error':
      return { ...v, error: { code: e.code, ...(e.detail !== undefined ? { detail: e.detail } : {}), ...(e.kind ? { kind: e.kind } : {}) } };
  }
}

function withStatus(v: SessionView, s: SessionStatus): SessionView {
  const cur = v.status;
  if (cur && cur.kind !== s.kind && STATUS_RANK[cur.kind] < STATUS_RANK[s.kind]) return v;
  return { ...v, status: s };
}

function reduceFollower(v: SessionView, f: Extract<SessionEvent, { type: 'follower' }>['event']): SessionView {
  switch (f.type) {
    case 'clock': {
      const p = v.prepared;
      if (!p) return v;
      const bar = barOfBeat(f.scoreBeat, p.meter.countsPerBar, p.pickupTicks > 0);
      return bar === v.bar ? v : { ...v, bar };
    }
    case 'note-start': {
      const status = v.status && (v.status.kind === 'come-in-at' || v.status.kind === 'restarting-count-in') ? null : v.status;
      return v.firstNoteHeard && status === v.status ? v : { ...v, firstNoteHeard: true, status };
    }
    case 'status':
      if (f.kind === 'rejoined') return v.status?.kind === 'lost-place' ? { ...v, status: null } : v;
      if (f.kind === 'come-in-at') return withStatus(v, { kind: 'come-in-at', bar: f.bar });
      return withStatus(v, { kind: f.kind });
    default:
      return v;
  }
}

/** A vanilla Zustand store fed by a session's events. Returns the store and an unsubscribe. */
export function createSessionStore(events: Emitter<SessionEvent>): { store: StoreApi<SessionView>; detach: () => void } {
  const store = createStore<SessionView>()(() => initialSessionView());
  const detach = events.on((e) => {
    const prev = store.getState();
    const next = reduceSessionView(prev, e);
    if (next !== prev) store.setState(next, true);
  });
  return { store, detach };
}
