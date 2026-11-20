/** `session/` public surface (01 §5.9; P16). */
import type { SessionApi } from '../core/api.ts';
import { PracticeSession } from './practice-session.ts';

export {
  PracticeSession,
  SessionError,
  listenedFirstReasons,
  type ListenRequest,
  type PracticeSessionOptions,
  type SessionTimers,
  type SoundPrefs,
} from './practice-session.ts';
export {
  LISTEN,
  barAt,
  chordLengthSec,
  keyChordTones,
  listenSourceOf,
  planBars,
  planClickBar,
  planListen,
  type ChordTone,
  type ListenBar,
  type ListenClick,
  type ListenFacts,
  type ListenNote,
  type ListenOptions,
  type ListenPlan,
  type ListenSource,
} from './listen-plan.ts';
export { SoundPlayer, idleSoundView, SOUND_FAILED_MS, type SoundCaption, type SoundKind, type SoundView } from './sounds.ts';
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
// Diagnostics per try (round 2 detection): the trace, its export file and the device-local store.
export {
  DIAG_AUDIO_KEEP,
  DIAG_KEEP,
  DIAGNOSTICS_FORMAT,
  DiagnosticsStore,
  TRACE_FORMAT,
  buildTryTrace,
  decodePcm16,
  diagnosticsFile,
  diagnosticsFileName,
  encodePcm16,
  type DiagnosticsFile,
  type DiagnosticsSettings,
  type TracedDspConfig,
  type TracedFollowConfig,
  type TryTrace,
} from './diagnostics.ts';
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
