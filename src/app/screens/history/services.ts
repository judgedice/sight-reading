/**
 * What History needs from the composition root. Takes come from the store repositories; the profile (for the
 * results panel's XP block) and the attributions file (for the source sheet) are optional.
 */
import type { StoreRepos } from '../../../core/platform.ts';
import type { AttemptRecord, AttributionsFile, Configs, PlayerProfile } from '../../../core/types.ts';
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
}
