/**
 * `follow/` public surface (01 §5.7). P10a: the live follower, the shared cost function and the displacement
 * detector. P10b: the final alignment (`finalAlign`, `alignFinal`), its relabel pass, the live outcome it compares
 * against, and the `FollowApi` conformance object.
 */
import type { FollowApi } from '../core/api.ts';
import { finalAlign } from './final-align.ts';
import { LiveFollower } from './live-follower.ts';

export { LiveFollower } from './live-follower.ts';
export * from './cost.ts';
export {
  DisplacementDetector,
  DISPLACEMENT_COST_RATIO,
  DISPLACEMENT_MAX_AHEAD_BARS,
  DISPLACEMENT_MAX_BACK_BARS,
  DISPLACEMENT_MIN_MATCHES,
  DISPLACEMENT_WINDOW_NOTES,
  type DisplacementHit,
  type WindowFit,
  type WindowNote,
} from './displacement.ts';
export { ghostPitch } from './ghost-spelling.ts';
export {
  alignDp,
  alignFinal,
  alignFinalWithReference,
  alignNotes,
  differsFromLive,
  finalAlign,
  finalMatchCost,
  oneThirdSec,
  soundedSec,
  type VoiceReferenceValues,
} from './final-align.ts';
export { relabel, type AlignNote } from './relabel.ts';
export { liveOutcomeOf, replayLive, type LiveNoteOutcome, type LiveOutcome } from './live-outcome.ts';

/** Compile-time conformance with the frozen `FollowApi`. */
export const followApi: FollowApi = { LiveFollower, finalAlign };
