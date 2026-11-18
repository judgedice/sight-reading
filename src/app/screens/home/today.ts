import type { Configs, PlayerProfile } from '../../../core/types.ts';
import type { TodayStats } from './services.ts';

/** A streak is alive when its last day is today or yesterday (02 section 5.4). */
export function liveStreakDays(profile: PlayerProfile | undefined, today: string): number {
  if (!profile || !profile.streak.lastDay) return 0;
  const last = Date.parse(`${profile.streak.lastDay}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return 0;
  return now - last <= 86_400_000 ? profile.streak.days : 0;
}

/** Ranked takes still needed today to keep the streak: only when 1 or 2 are done and a streak exists. */
export function streakAtRisk(profile: PlayerProfile | undefined, today: string, stats: TodayStats): { n: number; days: number } | null {
  const days = liveStreakDays(profile, today);
  if (days <= 0 || stats.ranked < 1 || stats.ranked > 2) return null;
  if (profile?.streak.lastDay === today) return null;
  return { n: 3 - stats.ranked, days };
}

export interface RankProgress {
  rank: number;
  name: string;
  total: number;
  xp: number;
  next: { name: string; xp: number; minLevel: number } | null;
  /** 0..1 within the current rank band; 1 at the top rank. */
  fraction: number;
}

export function rankProgress(cfg: Configs, profile: PlayerProfile | undefined): RankProgress {
  const table = cfg.progression.ranks.table;
  const rank = Math.min(table.length, Math.max(1, profile?.rank ?? 1));
  const cur = table.find((r) => r.rank === rank) ?? table[0]!;
  const nxt = table.find((r) => r.rank === rank + 1) ?? null;
  const xp = profile?.xp ?? 0;
  const fraction = nxt ? Math.min(1, Math.max(0, (xp - cur.xp) / Math.max(1, nxt.xp - cur.xp))) : 1;
  return { rank, name: cur.name, total: table.length, xp, next: nxt, fraction };
}
