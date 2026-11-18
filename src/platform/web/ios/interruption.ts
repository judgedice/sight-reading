/**
 * Interruption and route policy (05 IOS2; W2 idle close, W4, W7; 02 §5.3, §4.7; PLAN ruling 33).
 *
 * `interruptionPolicy(state, event)` is pure: it maps (session state, event) to one action. The web wiring that
 * feeds it events and carries out the actions is in `interruption-wiring.ts`.
 *
 * Take states are `count-in` and `performing`. In them every interruption voids the take (`interrupted`, or
 * `device-change` for a route change), burns the excerpt, and needs a gesture to restart. A void after the first
 * played note also counts against the post-reveal skip limit (`countsAsSkip`, R33). Hide-class events and a dead
 * track also stop every track. Outside a take, hide-class events close the audio session (W2); a route change
 * only marks the calibration stale (W7); everything else is ignored.
 */
import type { SessionState, VoidReason } from '../../../core/types.ts';

/** Everything the policy reacts to. The web events are the browser's names (05 W4). */
export type InterruptionEvent =
  | { type: 'hidden' } // visibilitychange to hidden
  | { type: 'pagehide' }
  | { type: 'freeze' }
  | { type: 'context-interrupted' } // AudioContext state 'interrupted' (iOS call, Siri, alarm)
  | { type: 'context-suspended'; requested: boolean } // 'suspended' (or 'closed') the app did / did not request
  | { type: 'track-mute' }
  | { type: 'track-ended' }
  /** `devicechange`; `keyChanged` is whether the recomputed routeKey differs from the previous one (W7). */
  | { type: 'device-change'; keyChanged: boolean }
  /** Five minutes on the results screen with no interaction (W2). */
  | { type: 'idle-timeout' }
  /** The player left the practice flow (W2). */
  | { type: 'left-practice' };

export interface PolicyState {
  session: SessionState;
  /** True once the follower has seen the first played note of the take (02 §4.7). Only read in take states. */
  firstNotePlayed?: boolean;
}

export type PolicyAction =
  | {
      kind: 'void';
      reason: Extract<VoidReason, 'interrupted' | 'device-change'>;
      /** The excerpt is burned for ranked play (02 §5.3). Always true for a void. */
      burnExcerpt: true;
      /** The void counts against the post-reveal skip limit: it happened after the first played note (R33). */
      countsAsSkip: boolean;
      /** Stop every track and close the context now (W4: on hide, and a dead track). */
      stopTracks: boolean;
      /** The next start needs a user gesture; `resume()` must not be called without one (W1, W4). */
      requireGesture: true;
    }
  /** Between takes: the calibration for the current route is stale, the next take is unranked until recalibrated (W6, W7). */
  | { kind: 'stale-calibration' }
  /** Stop all tracks and close the context (W2). */
  | { kind: 'close-audio' }
  | { kind: 'ignore' };

export const TAKE_STATES: readonly SessionState[] = ['count-in', 'performing'];

export const isTakeState = (s: SessionState): boolean => s === 'count-in' || s === 'performing';

/** Events that mean the page is going away; they close the audio session even between takes (W2). */
const HIDE_CLASS = new Set<InterruptionEvent['type']>(['hidden', 'pagehide', 'freeze']);

const IGNORE: PolicyAction = { kind: 'ignore' };

/** Seconds of results-screen idleness before the audio session closes (W2). */
export const IDLE_CLOSE_MS = 5 * 60 * 1000;

export function interruptionPolicy(state: PolicyState, event: InterruptionEvent): PolicyAction {
  if (event.type === 'left-practice' || event.type === 'idle-timeout') {
    // W2. An idle timeout only applies on results; elsewhere the timer is not running, so a stray one is ignored.
    if (event.type === 'idle-timeout' && state.session !== 'results') return IGNORE;
    return { kind: 'close-audio' };
  }

  if (isTakeState(state.session)) {
    const countsAsSkip = state.firstNotePlayed === true;
    const base = { kind: 'void' as const, burnExcerpt: true as const, countsAsSkip, requireGesture: true as const };
    switch (event.type) {
      case 'hidden':
      case 'pagehide':
      case 'freeze':
        return { ...base, reason: 'interrupted', stopTracks: true };
      case 'track-ended':
        return { ...base, reason: 'interrupted', stopTracks: true };
      case 'context-interrupted':
      case 'track-mute':
        return { ...base, reason: 'interrupted', stopTracks: false };
      case 'context-suspended':
        // A suspend the app asked for (its own cancel or close) is not an interruption.
        return event.requested ? IGNORE : { ...base, reason: 'interrupted', stopTracks: false };
      case 'device-change':
        // W7: mid-take any device change voids, whatever the new key.
        return { ...base, reason: 'device-change', stopTracks: false };
    }
  }

  // Between takes (idle, loading, covered, scanning, finishing, results, error).
  if (HIDE_CLASS.has(event.type)) return { kind: 'close-audio' };
  if (event.type === 'device-change') return event.keyChanged ? { kind: 'stale-calibration' } : IGNORE;
  // Context interruption, unrequested suspend, mute and a dead track outside a take: nothing to void. The backend
  // reuses a live stream and rebuilds a dead one at the next gesture-bound unlock (W2).
  return IGNORE;
}
