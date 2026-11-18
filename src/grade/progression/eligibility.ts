/**
 * Ranked eligibility helpers (02 §5.2, §5.3; 05 §4). The reasons themselves come from `grade()`; this module owns the
 * profile-derived inputs (seen, skip limit, XP context) and the measurement gate mapping.
 */
import type { Calibration, Configs, GateId, PlayerProfile, RankedReason, XpInput, AppliedProcessing, AttemptRecheck } from '../../core/types.ts';
import { effectiveStreakDays } from './days.ts';

/** `seen-before`: the player has revealed this dedupeGroup on any instrument (02 §5.3). */
export const hasSeen = (p: PlayerProfile, dedupeGroup: string): boolean => dedupeGroup in p.seenGroups;

/**
 * Post-reveal skip allowance: one per 5 ranked attempts. A replacement served when this is false is practice
 * (`skip-limit`). Pass the result of this check *before* recording the skip.
 */
export function postRevealSkipAllowed(p: PlayerProfile, cfg: Configs): boolean {
  if (p.lastSkipRankedIndex === null) return true;
  return p.rankedIndex - p.lastSkipRankedIndex >= cfg.progression.skip.postRevealPerRanked;
}

/** XP inputs the profile supplies for the next attempt (02 §5.4). `today` is the local day. */
export function xpInputFor(
  p: PlayerProfile,
  a: { instrumentId: string; excerptId: string; randomized: XpInput['randomized']; placement: boolean },
  today: string,
): XpInput {
  const sameDay = p.daily.day === today;
  const prev = sameDay ? p.daily.repeats[a.excerptId] : undefined;
  return {
    playerLevel: p.instruments[a.instrumentId]?.level ?? 1,
    randomized: a.randomized,
    streakDays: effectiveStreakDays(p.streak, today),
    dailyCountBefore: sameDay ? p.daily.attemptCount : 0,
    repeatIndexToday: prev === undefined ? 0 : prev + 1,
    placement: a.placement,
  };
}

/** Mapping of a gate failure to 02's ranked reason (05 §4). */
export const reasonForGate = (g: GateId): RankedReason => (g === 'calibration-unmeasured' ? 'calibration' : 'measurement');

export interface GateInput {
  /** Stored calibration for the current route, or null. */
  calibration: Calibration | null;
  applied: AppliedProcessing;
  /** The context sample rate matched after at most one recreate and the clock-rate check passed. */
  sampleRateOk: boolean;
  /** Speakers only; null in headphone modes. */
  recheck: AttemptRecheck | null;
  /** Largest gap in CaptureBlock.seq plus pool-empty drops. */
  captureGaps: number;
  /** What follow/ subtracted this take, ms. */
  latencyCompensationMs: number;
}

/** Per-take measurement gate (05 §4), thresholds from config. Returns failures in table order. */
export function evaluateGate(g: GateInput, cfg: Configs): GateId[] {
  const out: GateId[] = [];
  const r = cfg.grading.ranked;
  const cal = g.calibration;
  if (!g.sampleRateOk) out.push('sample-rate');
  if (!cal || cal.stale || (cal.method !== 'loopback' && cal.method !== 'play-along')) out.push('calibration-unmeasured');
  else {
    const maxMad = cal.method === 'loopback' ? r.loopbackMaxMadMs : r.playAlongMaxMadMs;
    const b = cfg.budget.calibration;
    const spec = cal.method === 'loopback' ? b.loopback : b.playAlong;
    const minClicks = cal.method === 'loopback' ? b.loopback.minFound : 1;
    if (cal.spreadMs > maxMad || cal.clicksDetected < minClicks || cal.roundTripMs < spec.minRtlMs || cal.roundTripMs > spec.maxRtlMs) out.push('calibration-quality');
    if (cal.aecSuspected || (cal.sanityToneCents !== null && Math.abs(cal.sanityToneCents) > b.sanityToneCents)) out.push('aec-suspected');
  }
  if (g.applied.echoCancellation === true || g.applied.noiseSuppression === true || g.applied.autoGainControl === true) out.push('processing-on');
  if (g.recheck && g.recheck.status === 'unmeasured') out.push('recheck');
  if (g.captureGaps > 0) out.push('capture-gap');
  if (g.latencyCompensationMs > r.maxRtlMs) out.push('rtl-high');
  return out;
}
