/**
 * What the results screen needs from the composition root. The app layer may not import grade/, tips/ or platform/,
 * so level changes, calibration and navigation arrive here (01 section 4.2).
 */
import type { ReactNode } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSettings, AttemptRecord, Configs, PlayerProfile, ProgressEvent } from '../../../core/types.ts';
import type { ListenOptions, SessionView, SoundView } from '../../../session/index.ts';
import type { Readable, Writable } from '../home/services.ts';
import type { DiagnosticsServices } from '../states/services.ts';
import type { ReviewExtras } from './review/SessionReview.tsx';

export interface ResultsActions {
  /** Start the next excerpt (after the tips interstitial when on). Return true when handled; the default goes to the scan. */
  next?(): boolean | void;
  /** Same excerpt, practice, cover skipped. Return true when handled; the default goes to the scan. */
  tryAgain?(): boolean | void;
  /** "Next scale" after a scale try (PLAN ruling 68). Return true when handled; the default goes to the scan. */
  nextScale?(): boolean | void;
  /** Accept a level-up offer. */
  moveUp(instrumentId: string, to: number): void;
  /** Decline an offer, or keep the level after a level-down suggestion. */
  stayAt(instrumentId: string, level: number): void;
  /** Undo an auto level-up (progression `setInstrumentLevel(from)`). */
  undoLevelUp(instrumentId: string, from: number): void;
  goToLevel(instrumentId: string, level: number): void;
  /** Opens calibration. The default navigates to #/calibrate. */
  recalibrate?(): void;
  /** The source sheet (04 section 5.12), owned by Settings. */
  openSource?(record: AttemptRecord): void;
}

/** Once-per-rank memory for the rank-up card. */
export interface RankUpMemory {
  seen(rank: number): boolean;
  mark(rank: number): void;
}

export interface ResultsServices {
  configs: Configs;
  session: StoreApi<SessionView>;
  profile: Readable<PlayerProfile | undefined>;
  settings: Writable<AppSettings>;
  actions: ResultsActions;
  /** Review content for the left column: the score frame with D8b's interactions, and the Listen extras. */
  renderReview?(record: AttemptRecord, extras?: ReviewExtras): ReactNode;
  rankUps?: RankUpMemory;
  /** Wait before a rank-up or install sheet opens, so the panel settles first (ms; default 600). */
  settleMs?: number;
  /**
   * Attempts of this practice session, oldest first. With it, Next after every 10th attempt opens the session summary
   * first (02 section 6.1 item 8, 04 section 5.10); Keep going then moves on as Next would.
   */
  sessionAttempts?(): readonly AttemptRecord[];
  /** The player pressed Finish in the summary (Home follows). */
  onFinish?(): void;
  /**
   * Listen (05 §9.3): one bar of clicks, then the excerpt at the take's tempo, from `fromBar` (a tapped bar), at 75%
   * with `slower`, with the clicks kept through with `clickAlong`. Call from the click.
   */
  listen?(o: ListenOptions): Promise<void>;
  /** "Hear bar n" or "Hear bars n to m": one bar of clicks, then the bars twice. */
  hearBar?(from: number, to?: number, o?: { slower?: boolean }): Promise<void>;
  /** Tries stored for a piece, those that reached bar 1: "2 tries at this piece · See all tries". */
  triesAtPiece?(excerptId: string): Promise<number>;
  diagnostics?: DiagnosticsServices;
  /** Stops any sound at once (Stop, leaving the screen). */
  stopSounds?(): void;
  /** What is sounding: "Playing bar n of m" and the bar highlight. */
  sounds?: StoreApi<SoundView>;
}

export type { ProgressEvent };
