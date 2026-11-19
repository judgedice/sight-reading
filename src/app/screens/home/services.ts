/**
 * What Home needs from the composition root. The app layer may not import corpus/ or platform/, so the counts, the
 * stores and the banner facts arrive here (01 section 4.2). Every `Readable` is a store snapshot: `get` returns a
 * stable value until something changes.
 */
import type { StoreApi } from 'zustand/vanilla';
import type { AppSettings, Configs, PlayerProfile, PracticeSettings } from '../../../core/types.ts';
import type { RankedAvailability, SessionView, SoundView } from '../../../session/index.ts';
import type { MicBrowser } from '../states/mic.ts';

export interface Readable<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

export interface Writable<T> extends Readable<T> {
  /** Replaces the value and persists it. */
  set(next: T): void;
}

/** Today's totals (04 section 5.2 Today strip). `takes` counts every attempt; `ranked` the ranked ones. */
export interface TodayStats {
  takes: number;
  ranked: number;
  xp: number;
}

/** Banner kinds in priority order, highest first (04 section 5.2). */
export type HomeBanner =
  | { kind: 'storage-loss' }
  | { kind: 'mic-off' }
  | { kind: 'calibrate'; seconds: number }
  | { kind: 'bluetooth' }
  | { kind: 'level-up'; instrumentId: string; from: number; to: number };

export const BANNER_PRIORITY: readonly HomeBanner['kind'][] = ['storage-loss', 'mic-off', 'calibrate', 'bluetooth', 'level-up'];

export interface HomeServices {
  configs: Configs;
  /** `countEligible` from corpus/ with the manifest and configs bound (04 section 5.2). */
  countEligible(instrumentId: string, level: number, meter: string | null): number;
  /** The browser whose steps the blocked-microphone notice gives (as onboarding). Omitted: Chromium's. */
  micBrowser?: MicBrowser;
  settings: Writable<AppSettings>;
  profile: Readable<PlayerProfile | undefined>;
  today: Readable<TodayStats>;
  /** Banners that apply now, any order; Home shows the highest-priority one. */
  banners: Readable<readonly HomeBanner[]>;
  dismissBanner(kind: HomeBanner['kind']): void;
  /** Accept a level-up offer (moves the instrument up). */
  moveUp(instrumentId: string, to: number): void;
  /** The session's view store, for empty-pool suggestions after a failed selection. */
  session?: StoreApi<SessionView>;
  /** The profile's local day, YYYY-MM-DD (PlatformServices.localDay). */
  localDay(): string;
  /**
   * Called by Start with the final settings, after they are saved. Return true when handled (the default navigates
   * to the scan).
   */
  onStart?(settings: PracticeSettings): boolean | void;
  /**
   * "Hear the tempo" on the tempo row (05 §9.1, §9.5): one bar of the chosen metronome sound at `bpm`, downbeat
   * accented if on. Call from the click (it unlocks audio). Absent: the button is not shown.
   */
  hearTempo?(bpm: number, beatsPerBar: number): Promise<void>;
  /** A range-picture note button ("Hear C3"): that sounding MIDI note for 1 s. Call from the click. */
  playNote?(concertMidi: number): Promise<void>;
  /** Stops any sound at once (leaving the screen, pressing a playing button again). */
  stopSounds?(): void;
  /** What is sounding now (the playing state of the sound buttons). */
  sounds?: StoreApi<SoundView>;
  /**
   * Can Ranked be chosen (05 §4.5, §5.8): the `calibration-unmeasured` gate predicate for the route plus the
   * microphone. `block` names the visible reason: `mic` ("Turn on microphone") first, then `calibration`.
   */
  rankedAvailability?: Readable<RankedAvailability>;
  /** "Turn on microphone": turns listening on and runs the permission request. Call from the click. */
  turnOnMic?(): Promise<{ ok: boolean }>;
}
