/** `session/` public surface (01 §5.9; P16). */
import type { SessionApi } from '../core/api.ts';
import { PracticeSession } from './practice-session.ts';

export { PracticeSession, SessionError, type PracticeSessionOptions, type SessionTimers } from './practice-session.ts';
export { createSessionStore, initialSessionView, reduceSessionView, type SessionStatus, type SessionView } from './view-store.ts';
export {
  barOfBeat,
  countInBarsFor,
  creditOf,
  dspConfigFor,
  followConfigFor,
  planTake,
  referenceLengthSec,
  repeatHints,
  takesTuningNote,
  tuningOffsetFrom,
  voiceReferenceTones,
  VOICE_REFERENCE,
  type ReferenceTone,
  type TakePlan,
} from './take-plan.ts';
export * from './gates/index.ts';
// The session summary (02 §6.1 item 8) lives in tips/; app/ reaches it through session/ (01 §4.2 boundaries).
export {
  attemptTitle,
  focusPatternId,
  summarizeSession,
  summaryDue,
  type SessionSummary,
  type SessionSummaryInput,
  type SummaryPattern,
} from '../tips/index.ts';

/** Compile-time conformance with the frozen `SessionApi`. */
export const sessionApi: SessionApi = { PracticeSession };
