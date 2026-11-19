/** XP for one attempt (02 §5.4). `grade/` returns the factor list; the UI shows every factor that is not 1.00. */
import type { GradeInput, XpBreakdown } from '../core/types.ts';
import { levelTempo } from '../rules/level-tempo.ts';

export function computeXp(input: GradeInput, score: number, status: 'ok' | 'incomplete', ranked: boolean): XpBreakdown {
  const x = input.cfg.progression.xp;
  const { level, bpm, xp: ctx, ranking } = input;
  const def = input.cfg.levelByNumber[level];
  if (!def) throw new Error(`grade: unknown level ${level}`);
  const base = x.basePerLevel * level + x.baseOffset;
  // The mid tempo is in the take's beat unit: compound meters on the dotted-beat levels use the dotted range (02 §2.4).
  const range = levelTempo(input.cfg, def, input.meter);
  const mid = (range.minBpm + range.maxBpm) / 2;
  const randomCount = Number(ctx.randomized.key) + Number(ctx.randomized.meter) + Number(ctx.randomized.tempo);
  const factors: { id: string; value: number }[] = [
    { id: 'q', value: score < x.qMinScore ? 0 : score / 100 },
    { id: 'm_tempo', value: Math.min(x.tempoClamp[1], Math.max(x.tempoClamp[0], bpm / mid)) },
    { id: 'm_random', value: Math.min(x.randomCap, 1 + x.randomPerSetting * randomCount) },
    { id: 'm_mode', value: ranking.metronome === 'countInOnly' && level >= x.countInOnlyFromLevel ? x.countInOnlyMult : 1 },
    { id: 'm_streak', value: 1 + x.streakPerDay * Math.min(ctx.streakDays, x.streakMaxDays) },
    { id: 'm_daily', value: ctx.dailyCountBefore < x.dailyFullCount ? 1 : x.dailyAfterMult },
    { id: 'm_below', value: level <= ctx.playerLevel - x.belowGap ? x.belowMult : 1 },
  ];
  if (!ranked) {
    // A practice attempt earns 25% of the formula; a repeat of the excerpt replaces that share (25% the first
    // repeat of the day, 0 after), so the two never multiply.
    if (ctx.repeatIndexToday <= 0) factors.push({ id: 'practice', value: x.practiceMult });
    else factors.push({ id: 'repeat', value: ctx.repeatIndexToday === 1 ? x.repeatFirstMult : x.repeatLaterMult });
  }
  if (status === 'incomplete') return { total: 0, base, factors };
  const product = factors.reduce((p, f) => p * f.value, base);
  return { total: Math.round(product), base, factors };
}
