/**
 * What the results screen needs from the composition root. The app layer may not import grade/, tips/ or platform/,
 * so level changes, calibration and navigation arrive here (01 section 4.2).
 */
import type { ReactNode } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSettings, AttemptRecord, Configs, PlayerProfile, ProgressEvent } from '../../../core/types.ts';
import type { SessionView } from '../../../session/index.ts';
import type { Readable, Writable } from '../home/services.ts';

export interface ResultsActions {
  /** Start the next excerpt (after the tips interstitial when on). Return true when handled; the default goes to the scan. */
  next?(): boolean | void;
  /** Same excerpt, practice, cover skipped. Return true when handled; the default goes to the scan. */
  tryAgain?(): boolean | void;
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
  /** Review content for the left column: the score frame with D8b's interactions. */
  renderReview?(record: AttemptRecord): ReactNode;
  rankUps?: RankUpMemory;
  /** Wait before a rank-up or install sheet opens, so the panel settles first (ms; default 600). */
  settleMs?: number;
}

export type { ProgressEvent };
