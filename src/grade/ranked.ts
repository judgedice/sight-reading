/** Ranked eligibility (02 §5.2): maps `RankingInput` and the calibration flag to `RankedReason`s, in the table's order. */
import type { Configs, GradeInput, RankedReason } from '../core/types.ts';

export function rankedReasons(input: GradeInput): RankedReason[] {
  const { ranking, cfg, level, bpm, calibrationMeasured } = input;
  const r = cfg.grading.ranked;
  const out: RankedReason[] = [];
  if (ranking.mode !== 'ranked') out.push('practice-mode');
  if (ranking.seenBefore) out.push('seen-before');
  if (!ranking.scanStrict) out.push('scan-extended');
  if (bpm < r.minTempoFracOfLevelMin * levelMinBpm(cfg, level)) out.push('tempo-below-90pct');
  const calibrationFailed = !calibrationMeasured || ranking.gateFailures.includes('calibration-unmeasured');
  if (calibrationFailed) out.push('calibration');
  if (ranking.gateFailures.some((g) => g !== 'calibration-unmeasured')) out.push('measurement');
  if (ranking.familiarity >= r.familiarityBelow) out.push('familiar');
  if (ranking.skipLimitHit) out.push('skip-limit');
  return out;
}

function levelMinBpm(cfg: Configs, level: number): number {
  const def = cfg.levelByNumber[level];
  if (!def) throw new Error(`grade: unknown level ${level}`);
  return def.tempo.minBpm;
}
