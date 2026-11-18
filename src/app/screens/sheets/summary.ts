/** Session summary data (04 section 5.10; 02 section 6.1 item 8). Pure: attempts in, numbers and ids out. */
import type { AttemptRecord, Configs, PlayerProfile } from '../../../core/types.ts';
import { text } from '../results/text.ts';

export interface SessionSummaryData {
  takes: number;
  /** Mean of the graded scores, rounded; null when nothing was graded. */
  averageScore: number | null;
  xp: number;
  best: { attemptId: string; score: number; title: string } | null;
  /** Up to `topPatterns` patterns by times fired, with their headlines. */
  patterns: { id: string; name: string; count: number }[];
  /** Streak days now (0 when none). */
  streakDays: number;
  /** Pattern name for the focus card, or null. */
  focus: { id: string; name: string } | null;
}

export const attemptTitle = (a: AttemptRecord): string => (a.credit.movement ? `${a.credit.work}: ${a.credit.movement}` : a.credit.work);

/** True after every Nth attempt of the session (02 section 6.1 item 8: every 10). */
export function summaryDue(attemptsThisSession: number, cfg: Configs): boolean {
  const every = cfg.tips.selection.summary.every;
  return attemptsThisSession > 0 && attemptsThisSession % every === 0;
}

export function summarizeSession(
  attempts: readonly AttemptRecord[],
  cfg: Configs,
  profile: PlayerProfile | undefined,
  /** Primary pattern per recent attempt on the active instrument, most recent first. */
  recentPrimaries: readonly string[] = profile?.instruments[profile.activeInstrumentId]?.recentPrimaryPatterns ?? [],
): SessionSummaryData {
  const sel = cfg.tips.selection.summary;
  const graded = attempts.filter((a) => a.score !== null && a.listening);
  const average = graded.length ? Math.round(graded.reduce((n, a) => n + (a.score?.score ?? 0), 0) / graded.length) : null;
  const xp = attempts.reduce((n, a) => n + (a.score?.xp.total ?? 0), 0);
  let best: SessionSummaryData['best'] = null;
  for (const a of graded) {
    const score = a.score?.score ?? 0;
    if (!best || score > best.score) best = { attemptId: a.id, score, title: attemptTitle(a) };
  }
  const counts = new Map<string, number>();
  for (const a of attempts) for (const p of a.score?.patterns ?? []) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  const name = (id: string): string => cfg.tips.patterns.find((p) => p.id === id)?.name ?? id;
  const patterns = [...counts.entries()]
    .filter(([id]) => id !== cfg.tips.selection.cleanReadPatternId)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, sel.topPatterns)
    .map(([id, count]) => ({ id, name: name(id), count }));
  const window = recentPrimaries.slice(0, sel.focus.ofLast);
  const tally = new Map<string, number>();
  for (const id of window) tally.set(id, (tally.get(id) ?? 0) + 1);
  let focus: SessionSummaryData['focus'] = null;
  for (const [id, n] of tally) if (n >= sel.focus.minPrimary && (!focus || n > (tally.get(focus.id) ?? 0))) focus = { id, name: name(id) };
  return { takes: attempts.length, averageScore: average, xp, best, patterns, streakDays: profile?.streak.days ?? 0, focus };
}

/** The skip toast ends with "That was: {credit}" (04 section 5.10). */
export const skipToastText = (credit: string): string => text('credit.that-was', { credit });
