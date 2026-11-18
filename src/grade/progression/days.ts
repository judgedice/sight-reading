/** Calendar-day helpers on YYYY-MM-DD strings (02 §5.4). Pure; no clock. */

function toUtcMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function dayDiff(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);
}

/** The streak length that applies on `today`: 0 once a day has been missed. */
export function effectiveStreakDays(streak: { days: number; lastDay: string | null }, today: string): number {
  if (streak.lastDay === null || streak.days <= 0) return 0;
  return dayDiff(streak.lastDay, today) <= 1 ? streak.days : 0;
}
