/** Session summary data (04 section 5.10; 02 section 6.1 item 8). Pure: attempts in, numbers and ids out. */
import type { AttemptRecord, Configs, PlayerProfile } from '../../../core/types.ts';
import { attemptTitle, summarizeSession as buildSummary, summaryDue as tipsSummaryDue, type SessionSummary } from '../../../session/index.ts';
import { text } from '../results/text.ts';

/** The sheet's data: tips/'s `SessionSummary` (02 section 6.1 item 8), each pattern with its tip. */
export type SessionSummaryData = SessionSummary;

export { attemptTitle };

/** True after every Nth attempt of the session (02 section 6.1 item 8: every 10). */
export function summaryDue(attemptsThisSession: number, cfg: Configs): boolean {
  return tipsSummaryDue(attemptsThisSession, cfg.tips);
}

export function summarizeSession(
  attempts: readonly AttemptRecord[],
  cfg: Configs,
  profile: PlayerProfile | undefined,
  /** Primary pattern per recent attempt on the active instrument, most recent first. */
  recentPrimaries: readonly string[] = profile?.instruments[profile.activeInstrumentId]?.recentPrimaryPatterns ?? [],
): SessionSummaryData {
  return buildSummary({ attempts, catalog: cfg.tips, recentPrimaries, streakDays: profile?.streak.days ?? 0, familyOf: (id) => cfg.instrumentById[id]?.family });
}

/** The skip toast ends with "That was: {credit}" (04 section 5.10). */
export const skipToastText = (credit: string): string => text('credit.that-was', { credit });
