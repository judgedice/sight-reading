/**
 * What History needs from the composition root. Takes come from the store repositories; the profile (for the
 * results panel's XP block) and the attributions file (for the source sheet) are optional.
 */
import type { StoreApi } from 'zustand/vanilla';
import type { StoreRepos } from '../../../core/platform.ts';
import type { AttemptRecord, AttributionsFile, Configs, PlayerProfile, PreparedExcerpt } from '../../../core/types.ts';
import type { ListenOptions, SoundView } from '../../../session/index.ts';
import type { Readable } from '../home/services.ts';

export interface HistoryServices {
  configs: Configs;
  repos: Pick<StoreRepos, 'attempts'>;
  /** The device's local calendar day, YYYY-MM-DD (PlatformServices.localDay). */
  localDay(): string;
  profile?: Readable<PlayerProfile | undefined>;
  /** Resolves the attributions file for the source sheet. Omitted: the sheet shows what the take records. */
  loadAttributions?(): Promise<AttributionsFile>;
  /** Practice the same excerpt again. Omitted: the action is not shown. */
  playAgain?(record: AttemptRecord): void;
  /**
   * The attempt's excerpt as it was served (for the read-only marked score and Listen). Null when the excerpt is
   * withdrawn or no longer prepares the same way: the score and Listen are not shown.
   */
  preparedFor?(record: AttemptRecord): Promise<PreparedExcerpt | null>;
  /** Listen on attempt detail (05 §8.12): as results, at the take's tempo. Call from the click. */
  listen?(record: AttemptRecord, o: ListenOptions): Promise<void>;
  /** "Hear bar n" on attempt detail. */
  hearBar?(record: AttemptRecord, from: number, to?: number, o?: { slower?: boolean }): Promise<void>;
  /** Stops any sound at once (leaving the screen). */
  stopSounds?(): void;
  /** What is sounding (`attemptId` says which attempt). */
  sounds?: StoreApi<SoundView>;
}
