/**
 * What the scan and performance screens need from the composition root (01 section 4.2). The screens read the
 * session's view store and call the session's gesture methods; they never drive audio themselves (04 section 3.3).
 * The per-note follower events reach the overlay straight from `session.events`, never through React state.
 */
import { createContext, useContext } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSettings, AttemptRecord, AudioRouteInfo, Configs, Emitter, PreparedExcerpt, SessionEvent, SessionState } from '../../../core/types.ts';
import type { SessionView, SoundView } from '../../../session/index.ts';
import type { FrameNotation } from '../../../ui/score-frame/index.ts';
import type { Readable } from '../home/services.ts';

/** The part of `PracticeSession` the screens call. A structural subset, so the real session fits and tests can fake it. */
export interface PracticeSessionPort {
  readonly events: Emitter<SessionEvent>;
  readonly state: SessionState;
  readonly prepared: PreparedExcerpt | null;
  /** Ranking facts of the excerpt on screen (scan chip, cover notice). */
  readonly pending: { mode: 'ranked' | 'practice'; seenBefore: boolean; skipLimitHit: boolean; revealed: boolean; scanSec: number; listenedFirst?: boolean } | null;
  /** Call synchronously from the first gesture (Start scan). */
  ensureAudio(): Promise<AudioRouteInfo>;
  revealScan(): void;
  startTake(): Promise<void>;
  stop(): Promise<AttemptRecord | null>;
  skip(): Promise<void>;
  /** Cents; winds, brass, strings. */
  captureTuningNote(): Promise<number>;
  playVoiceReference(): Promise<void>;
  /** 04 section 4.4: a rotation during the count-in cancels and restarts it. Not on `PracticeSession` yet. */
  restartCountIn?(reason: 'rotation'): void;
}

export interface PracticeFlowServices {
  configs: Configs;
  session: PracticeSessionPort;
  /** The session's store (`createSessionStore(session.events)`), read by both screens. */
  view: StoreApi<SessionView>;
  /** `() => import('../notation/index.ts').then(bindNotation)`: keeps notation a lazy chunk (PLAN ruling 39). */
  loadNotation: () => Promise<FrameNotation>;
  settings: Readable<AppSettings>;
  /** Switches the cover's ranked take to practice for the same settings ("Practice instead", 04 section 5.3). */
  practiceInstead(): void | Promise<void>;
  /** True when a skip now would exceed the post-reveal limit, so the next excerpt is practice (04 section 5.10). */
  skipLimitReached?(): boolean;
  /** One bar of clicks at the take tempo ("Hear the tempo"). Absent: the button is not shown. */
  hearTempo?(): Promise<void>;
  /**
   * "Listen first" (05 §4.3, §9.4): in practice it plays at once; in ranked (after the screen's confirm) the take
   * becomes practice now, `view.mode` turns 'practice', the countdown runs on without auto start, and the attempt
   * records `listened-first`. Call from the click (it unlocks audio).
   */
  listenFirst?(): Promise<void>;
  /** "Hear the key" (instruments, 05 §10): the concert home chord, root at or below the first note. Never changes the take. */
  hearKey?(): Promise<void>;
  /** "Hear starting pitch" (voice): the key chord, then the first note. Same as `session.playVoiceReference`. */
  hearStartingPitch?(): Promise<void>;
  /** Stops any sound at once ("Stop", leaving the screen). Never touches a take. */
  stopSounds?(): void;
  /** What is sounding now: the playing button, the live caption and the bar highlight (05 §8.8). */
  sounds?: StoreApi<SoundView>;
  /** iOS only: true once the wake lock request failed, which shows the Auto-Lock hint. */
  wakeLockFailed?: Readable<boolean>;
  /** Input meter gate, dBFS (the no-signal gate). */
  inputGateDb?: number;
  reducedMotion?: () => boolean;
  highContrast?: () => boolean;
}

const Services = createContext<PracticeFlowServices | null>(null);

export const PracticeFlowServicesProvider = Services.Provider;

export function usePracticeFlowServices(): PracticeFlowServices {
  const s = useContext(Services);
  if (!s) throw new Error('The practice screens need PracticeFlowServicesProvider');
  return s;
}
