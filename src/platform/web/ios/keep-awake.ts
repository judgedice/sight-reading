/**
 * Keep-awake controller and persist trigger (05 IOS4; W11 wake lock, W12 `persist()` request).
 *
 * The wake lock is held while the player is in the practice flow, so the screen does not lock mid-scan (a lock
 * hides the page, W4 stops the stream, and the next Start needs a new prompt and recalibration). Rules (W11):
 *   - requested in the Start-scan gesture (`keepAwake(true)` from the session), never outside practice;
 *   - re-requested when the page becomes visible again while in practice (the browser releases it on hide);
 *   - released on leaving practice (`keepAwake(false)`), and after five minutes idle on results;
 *   - a rejected request raises the Auto-Lock hint flag once per session and is otherwise silent.
 *
 * `PersistTrigger` calls `navigator.storage.persist()` once, after the first completed attempt (W12). The
 * once-per-install guard lives in `requestPersistOnce` (src/platform/web/store/persist.ts); this adds the
 * once-per-session guard so the call is not repeated from every attempt save.
 *
 * Browser globals are not read here: the wake-lock object, the timers and the visibility events are injected, so
 * the module is testable with fakes. `keepAwakeFromNavigator` is the one place that reads `navigator.wakeLock`.
 */
import type { KeyValue } from '../../../core/platform.ts';
import { requestPersistOnce, type PersistApi } from '../store/persist.ts';
import { IDLE_CLOSE_MS } from './interruption.ts';

/** The part of a `WakeLockSentinel` this controller uses. */
export interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  /** Optional: the browser fires `release` when it drops the lock (e.g. on visibility change). */
  addEventListener?(type: 'release', listener: () => void): void;
}

/** The part of `navigator.wakeLock` this controller uses. */
export interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export interface KeepAwakeTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface KeepAwakeOptions {
  /** `navigator.wakeLock`, or undefined when the API is missing (every request then rejects as unsupported). */
  wakeLock: WakeLockLike | undefined;
  timers: KeepAwakeTimers;
  /** Results-screen idle time before the lock is released (W11). Default: the W2 idle close, five minutes. */
  idleMs?: number;
}

export class KeepAwakeController {
  private readonly wakeLock: WakeLockLike | undefined;
  private readonly timers: KeepAwakeTimers;
  private readonly idleMs: number;

  /** In the practice flow (set by `keepAwake(true)`, cleared by `keepAwake(false)`). */
  private practice = false;
  /** On the results screen. */
  private results = false;
  /** Results idle timeout has fired: the lock is released and not re-requested until the player touches the page. */
  private idle = false;
  private held: WakeLockSentinelLike | null = null;
  private inFlight: Promise<boolean> | null = null;
  private idleTimer: unknown = undefined;
  private hintRaised = false;
  private disposed = false;

  constructor(opts: KeepAwakeOptions) {
    this.wakeLock = opts.wakeLock;
    this.timers = opts.timers;
    this.idleMs = opts.idleMs ?? IDLE_CLOSE_MS;
  }

  /** `PlatformServices.keepAwake` adapter. `true` starts practice (Start scan), `false` leaves it. Never rejects. */
  async keepAwake(on: boolean): Promise<void> {
    if (on) this.startPractice();
    else this.leavePractice();
  }

  /** Start scan: the player entered the practice flow inside a gesture. Requests the lock. */
  startPractice(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    this.practice = true;
    this.idle = false;
    return this.acquire();
  }

  /** The player left the practice flow. Releases the lock and cancels the idle timer. */
  leavePractice(): void {
    this.practice = false;
    this.results = false;
    this.idle = false;
    this.cancelIdle();
    void this.releaseHeld();
  }

  /** The results screen is showing: start the five-minute idle countdown (W11). */
  enterResults(): void {
    if (!this.practice || this.disposed) return;
    this.results = true;
    this.armIdle();
  }

  /** Left results for another practice screen: the idle countdown no longer applies. */
  leaveResults(): void {
    this.results = false;
    this.cancelIdle();
  }

  /**
   * Player interaction (a tap or key on the page). On results it restarts the idle countdown, and if the lock was
   * released by the idle timeout it is requested again.
   */
  touch(): void {
    if (!this.practice || this.disposed) return;
    if (this.results) this.armIdle();
    if (this.idle) {
      this.idle = false;
      void this.acquire();
    }
  }

  /** Visibility change from the page lifecycle. Hidden: the browser has released the lock. Visible: re-request it. */
  onVisibility(visible: boolean): void {
    if (this.disposed) return;
    if (!visible) {
      this.held = null;
      return;
    }
    if (this.practice && !this.idle) void this.acquire();
  }

  /** True once a request has been rejected in this session. The Auto-Lock hint is shown from this flag (IOS5). */
  autoLockHintRaised(): boolean {
    return this.hintRaised;
  }

  /** Whether the controller currently believes the lock is held. */
  isHeld(): boolean {
    return this.held !== null && !this.held.released;
  }

  /** Releases any lock and stops every timer. Later calls do nothing. */
  dispose(): void {
    if (this.disposed) return;
    this.leavePractice();
    this.disposed = true;
  }

  private acquire(): Promise<boolean> {
    if (!this.practice || this.disposed) return Promise.resolve(false);
    if (this.isHeld()) return Promise.resolve(true);
    if (this.inFlight) return this.inFlight;
    if (!this.wakeLock) {
      this.raiseHint();
      return Promise.resolve(false);
    }
    const attempt = this.wakeLock.request('screen').then(
      (sentinel) => {
        this.inFlight = null;
        if (!this.practice || this.disposed) {
          // Practice ended while the request was in flight: give the lock straight back.
          void sentinel.release().catch(() => undefined);
          return false;
        }
        this.held = sentinel;
        sentinel.addEventListener?.('release', () => {
          if (this.held === sentinel) this.held = null;
        });
        return true;
      },
      () => {
        this.inFlight = null;
        this.raiseHint();
        return false;
      },
    );
    this.inFlight = attempt;
    return attempt;
  }

  private async releaseHeld(): Promise<void> {
    const sentinel = this.held;
    this.held = null;
    if (!sentinel || sentinel.released) return;
    try {
      await sentinel.release();
    } catch {
      // A lock the browser already dropped cannot be released again; nothing to undo.
    }
  }

  private raiseHint(): void {
    this.hintRaised = true;
  }

  private armIdle(): void {
    this.cancelIdle();
    this.idleTimer = this.timers.setTimeout(() => {
      this.idleTimer = undefined;
      if (!this.results || this.disposed) return;
      this.idle = true;
      void this.releaseHeld();
    }, this.idleMs);
  }

  private cancelIdle(): void {
    if (this.idleTimer !== undefined) this.timers.clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }
}

/** Once per session: the first completed attempt calls `navigator.storage.persist()`; later attempts do not. */
export interface PersistTrigger {
  /** Call after each completed attempt is saved. Resolves the grant on the first call, null afterwards. */
  attemptCompleted(): Promise<boolean | null>;
}

export function createPersistTrigger(kv: KeyValue, storage: PersistApi | undefined): PersistTrigger {
  let called = false;
  return {
    attemptCompleted(): Promise<boolean | null> {
      if (called) return Promise.resolve(null);
      called = true;
      return requestPersistOnce(kv, storage);
    },
  };
}

/** The browser's wake lock, if the API exists. The only reader of `navigator.wakeLock` in this module. */
export function wakeLockFromNavigator(nav: { readonly wakeLock?: WakeLockLike | undefined } | undefined): WakeLockLike | undefined {
  const wl = nav?.wakeLock;
  return wl && typeof wl.request === 'function' ? wl : undefined;
}
