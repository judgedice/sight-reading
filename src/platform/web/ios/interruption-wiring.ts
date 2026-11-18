/**
 * Web wiring for the interruption policy (05 IOS2; W2 idle close, W4, W7).
 *
 * The audio backend reports raw interruptions (`onInterruption`) and route changes (`onRouteChange`). This
 * controller feeds them, with the session state, to the pure `interruptionPolicy` and carries out the result:
 * it tells the session to void the take (the session writes the record: no grade, no XP, burned excerpt),
 * stops tracks by closing the backend, marks calibrations stale, and closes the audio session after five idle
 * minutes on results and on leaving practice (W2).
 *
 * Gesture rule (W1, W4): after a void, and after any close, nothing here calls `resume()` or `unlock()` unless the
 * caller says the call happens inside a user gesture. `unlockFromGesture(false)` returns `needs-gesture`.
 *
 * Browser globals are not touched; the timers and the audio backend are injected.
 */
import type { AudioRouteInfo } from '../../../core/platform.ts';
import type { SessionState } from '../../../core/types.ts';
import { IDLE_CLOSE_MS, interruptionPolicy, isTakeState, type InterruptionEvent, type PolicyAction } from './interruption.ts';

/** The slice of `AudioBackend` this controller needs. `WebAudioBackend` satisfies it. */
export interface InterruptionAudio {
  onInterruption(cb: (reason: 'interrupted' | 'hidden' | 'track-ended' | 'device-change') => void): () => void;
  onRouteChange(cb: (r: AudioRouteInfo) => void): () => void;
  close(): Promise<void>;
  unlock(): Promise<AudioRouteInfo>;
}

export type VoidAction = Extract<PolicyAction, { kind: 'void' }>;

/** What the session (P16) implements. */
export interface InterruptionSink {
  /** Abort the take now with `VoidReason`; burn the excerpt; count as a skip when `countsAsSkip`. */
  onVoid(action: VoidAction): void;
  /** Between takes the route changed: the calibration for `routeKey` is stale (W6, W7). `null` when unknown. */
  onStaleCalibration(routeKey: string | null): void;
  /** Audio was closed (tracks stopped, context closed). `cause` is the event that closed it. */
  onAudioClosed?(cause: InterruptionEvent['type']): void;
}

export interface InterruptionTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface InterruptionControllerOptions {
  audio: InterruptionAudio;
  sink: InterruptionSink;
  timers: InterruptionTimers;
  /** True once the follower has seen the first played note of the current take. */
  firstNotePlayed(): boolean;
  /** Default 5 minutes (W2). */
  idleMs?: number;
}

export type GestureUnlock = { ok: true; route: AudioRouteInfo } | { ok: false; reason: 'needs-gesture' };

const BACKEND_EVENT: Record<'interrupted' | 'hidden' | 'track-ended' | 'device-change', InterruptionEvent> = {
  interrupted: { type: 'context-interrupted' },
  hidden: { type: 'hidden' },
  'track-ended': { type: 'track-ended' },
  'device-change': { type: 'device-change', keyChanged: true },
};

export class InterruptionController {
  private readonly o: InterruptionControllerOptions;
  private session: SessionState = 'idle';
  private voided = false;
  private gestureRequired = false;
  private idleTimer: unknown = null;
  private unsubs: (() => void)[] = [];

  constructor(o: InterruptionControllerOptions) {
    this.o = o;
  }

  /** True after a void or a close until `unlockFromGesture(true)` succeeds. */
  get needsGesture(): boolean {
    return this.gestureRequired;
  }

  start(): void {
    if (this.unsubs.length > 0) return;
    this.unsubs = [
      this.o.audio.onInterruption((r) => this.handle(BACKEND_EVENT[r])),
      this.o.audio.onRouteChange((r) => this.handle({ type: 'device-change', keyChanged: true }, r.routeKey)),
    ];
  }

  dispose(): void {
    for (const u of this.unsubs.splice(0)) u();
    this.clearIdle();
  }

  /** The session calls this on every state change. */
  setSession(state: SessionState): void {
    this.session = state;
    if (!isTakeState(state)) this.voided = false;
    this.clearIdle();
    if (state === 'results') this.armIdle();
  }

  /** Any interaction on the results screen restarts the idle clock (W2). */
  touch(): void {
    if (this.session === 'results') {
      this.clearIdle();
      this.armIdle();
    }
  }

  /** The player left the practice flow (W2): stop all tracks and close the context. */
  leavePractice(): void {
    this.handle({ type: 'left-practice' });
  }

  /** Feed an event directly (tests, and wiring that sees browser events the backend does not forward). */
  handle(event: InterruptionEvent, routeKey: string | null = null): PolicyAction {
    const action = interruptionPolicy({ session: this.session, firstNotePlayed: isTakeState(this.session) && this.o.firstNotePlayed() }, event);
    switch (action.kind) {
      case 'void':
        // Hide fires visibilitychange, freeze and pagehide together; one void per take.
        if (this.voided) return { kind: 'ignore' };
        this.voided = true;
        this.gestureRequired = true;
        this.o.sink.onVoid(action);
        if (action.stopTracks) this.closeAudio(event.type);
        return action;
      case 'stale-calibration':
        this.o.sink.onStaleCalibration(routeKey);
        return action;
      case 'close-audio':
        this.closeAudio(event.type);
        return action;
      case 'ignore':
        return action;
    }
  }

  /**
   * Restart audio. Pass `true` only from inside a user-gesture handler, synchronously. Without a gesture this never
   * reaches the backend, so `resume()` is never called (W4).
   */
  unlockFromGesture(inGesture: boolean): Promise<GestureUnlock> {
    if (!inGesture) return Promise.resolve({ ok: false, reason: 'needs-gesture' });
    const p = this.o.audio.unlock();
    this.gestureRequired = false;
    return p.then((route) => ({ ok: true as const, route }));
  }

  private closeAudio(cause: InterruptionEvent['type']): void {
    this.gestureRequired = true;
    this.clearIdle();
    void this.o.audio.close().then(
      () => this.o.sink.onAudioClosed?.(cause),
      () => this.o.sink.onAudioClosed?.(cause),
    );
  }

  private armIdle(): void {
    this.idleTimer = this.o.timers.setTimeout(() => {
      this.idleTimer = null;
      this.handle({ type: 'idle-timeout' });
    }, this.o.idleMs ?? IDLE_CLOSE_MS);
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) this.o.timers.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
