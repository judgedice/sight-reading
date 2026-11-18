/** Rank ladder (02 §5.5). Rank needs both XP and a minimum current level on at least one instrument; it never goes down. */
import type { GradeApi } from '../../core/api.ts';
import type { Configs, PlayerProfile, Rank } from '../../core/types.ts';

export const rankFor: GradeApi['rankFor'] = (xp, maxLevelAnyInstrument, cfg) => {
  const table = cfg.progression.ranks.table;
  let idx = 0;
  for (let i = 0; i < table.length; i++) {
    const row = table[i]!;
    if (xp >= row.xp && maxLevelAnyInstrument >= row.minLevel) idx = i;
  }
  const cur = table[idx]!;
  const next = table[idx + 1] ?? null;
  let progress = 1;
  if (next) {
    const span = next.xp - cur.xp;
    progress = span > 0 ? Math.min(1, Math.max(0, (xp - cur.xp) / span)) : 1;
  }
  return { rank: cur.rank, name: cur.name, next: next ? { rank: next.rank, name: next.name, xp: next.xp, minLevel: next.minLevel } : null, progress };
};

/** The highest current level over the player's instruments (beta included), 1 when none. */
export function maxLevelOf(p: PlayerProfile): number {
  let m = 1;
  for (const inst of Object.values(p.instruments)) m = Math.max(m, inst.level);
  return m;
}

/** Rank for a profile, never below the stored rank. */
export function profileRank(p: PlayerProfile, cfg: Configs): Rank {
  const r = rankFor(p.xp, maxLevelOf(p), cfg);
  if (r.rank >= p.rank) return r;
  const row = cfg.progression.ranks.table.find((t) => t.rank === p.rank);
  return row ? rankFor(row.xp, row.minLevel, cfg) : r;
}
