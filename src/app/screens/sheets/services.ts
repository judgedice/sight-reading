/** What the tips interstitial and the sheets need from the composition root. */
import type { StoreApi } from 'zustand/vanilla';
import type { AppSettings, AttemptRecord, Configs, PlayerProfile } from '../../../core/types.ts';
import type { SessionView, SoundView } from '../../../session/index.ts';
import type { Readable, Writable } from '../home/services.ts';

export interface TipsServices {
  configs: Configs;
  session: StoreApi<SessionView>;
  settings: Writable<AppSettings>;
  profile: Readable<PlayerProfile | undefined>;
  /** Attempts of this practice session, oldest first (for the summary). */
  sessionAttempts(): readonly AttemptRecord[];
  /** Start the next excerpt. Return true when handled (the default navigates to the scan). */
  onNext?(): boolean | void;
  /** The player pressed Finish in the summary. */
  onFinish?(): void;
  /** "Hear bar n" from a tip ("Hear bar 3", "Hear bars 3 to 5"): one bar of clicks, then the bars twice. */
  hearBar?(from: number, to?: number): Promise<void>;
  /** Stops any sound at once (leaving the sheet). */
  stopSounds?(): void;
  sounds?: StoreApi<SoundView>;
}
