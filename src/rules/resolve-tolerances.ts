/**
 * Tolerance resolution (02 §4.1, §4.2; 01 §5.4, §8). One pure resolver for the follower, the renderer and the
 * grader, so live and final verdicts cannot disagree on thresholds.
 *
 * Every number comes from `cfg.grading`. This file contains no tolerance constants: the only literals are unit
 * conversions (ms per second, ms per minute).
 */
import type { RulesApi } from '../core/api.ts';
import type {
  Configs,
  ExpectedNote,
  GradingConfig,
  Instrument,
  IntonationBand,
  LevelRange,
  ResolvedTolerance,
  TimingLevelBand,
  TimingTerm,
} from '../core/types.ts';

const MS_PER_SEC = 1000;
const MS_PER_MIN = 60_000;

const inRange = (level: number, r: LevelRange): boolean => level >= r[0] && level <= r[1];

/** Intonation band group of an instrument (02 §4.2): voice is relative pitch; piano and guitar are fixed pitch. */
export function intonationGroup(inst: Instrument): IntonationBand['group'] {
  if (inst.relativePitch || inst.family === 'voice') return 'voice';
  return inst.pitchKind === 'fixed' ? 'fixed' : 'continuous';
}

/** Timing level band for a served level; throws when config has no band (a config error, not a runtime case). */
export function timingBandFor(level: number, g: GradingConfig): TimingLevelBand {
  const band = g.timing.levelBands.find((b) => inRange(level, b.levels));
  if (!band) throw new RangeError(`grading-config has no timing band for level ${level}`);
  return band;
}

/** Intonation band for an instrument at a level (02 §4.2). */
export function intonationBandFor(inst: Instrument, level: number, g: GradingConfig): IntonationBand {
  const group = intonationGroup(inst);
  const band = g.intonation.bands.find((b) => b.group === group && inRange(level, b.levels));
  if (!band) throw new RangeError(`grading-config has no intonation band for ${group} at level ${level}`);
  return band;
}

/** Smaller neighbouring IOI of a note, ms, or null when it has no neighbour (02 §4.2). */
export function minIoiMs(n: ExpectedNote): number | null {
  const prev = n.ioiPrevSec;
  const next = n.ioiNextSec;
  if (prev === null && next === null) return null;
  if (prev === null) return (next as number) * MS_PER_SEC;
  if (next === null) return prev * MS_PER_SEC;
  return Math.min(prev, next) * MS_PER_SEC;
}

/**
 * Expected steady duration of a note, ms: written duration minus the family's attack exclusion. Drives the
 * vibrato widening (02 §4.2) and live sharp/flat eligibility (02 §4.8).
 */
export function expectedSteadyMs(n: ExpectedNote, tol: Pick<ResolvedTolerance, 'attackExcludeMs'>): number {
  return n.durSec * MS_PER_SEC - tol.attackExcludeMs;
}

/** 02 §4.2: t = max(abs, frac × beat); t = min(t, cap × minIOI); t = max(t, family floor). */
function timingTerm(term: TimingTerm, beatMs: number, cap: number, minIoi: number | null, floorMs: number): number {
  let t = Math.max(term.absMs, term.fracBeat * beatMs);
  if (minIoi !== null) t = Math.min(t, cap * minIoi);
  return Math.max(t, floorMs);
}

/** 02 §4.1: W = max(tBad, min(max(minMs, minBeats × beat), ioiFrac × minIOI)); the IOI term is skipped without neighbours. */
function matchWindowMs(tBadMs: number, beatMs: number, minIoi: number | null, g: GradingConfig): number {
  const mw = g.matchWindow;
  let inner = Math.max(mw.minMs, mw.minBeats * beatMs);
  if (minIoi !== null) inner = Math.min(inner, mw.ioiFrac * minIoi);
  return Math.max(tBadMs, inner);
}

/** Resolve one tolerance per expected note (01 §5.4, 02 §4.2). Pure; reads `cfg.grading` only. */
export const resolveTolerances: RulesApi['resolveTolerances'] = (notes, ctx, cfg: Configs) => {
  const g = cfg.grading;
  const inst = ctx.instrument;
  if (!(ctx.bpm > 0) || !Number.isFinite(ctx.bpm)) throw new RangeError(`bpm must be a positive number, got ${ctx.bpm}`);
  const band = timingBandFor(ctx.level, g);
  const floor = g.timing.onsetClassFloors[inst.onsetClass];
  const cap = g.timing.ioiCap;
  const ib = intonationBandFor(inst, ctx.level, g);
  const beatMs = MS_PER_MIN / ctx.bpm;
  const attackExcludeMs = g.intonation.attackExcludeMsByFamily[inst.family];
  const vibrato = inst.detection.vibratoClass === 'vibrato';
  const minSteadyMs = g.intonation.minSteadyMs[inst.detection.vibratoClass];
  const widen = g.intonation.vibratoWiden;

  return notes.map((n): ResolvedTolerance => {
    const minIoi = minIoiMs(n);
    const good = timingTerm(band.good, beatMs, cap.good, minIoi, floor.goodMs);
    const red = timingTerm(band.red, beatMs, cap.red, minIoi, floor.redMs);
    const bad = timingTerm(band.bad, beatMs, cap.bad, minIoi, floor.badMs);
    const w = matchWindowMs(bad, beatMs, minIoi, g);

    let goodCents = ib.goodCents;
    let redCents = ib.redCents;
    // Vibrato families with less than `belowSteadyMs` of expected steady pitch widen to at least the floor bands.
    if (goodCents !== null && redCents !== null && vibrato && n.durSec * MS_PER_SEC - attackExcludeMs < widen.belowSteadyMs) {
      goodCents = Math.max(goodCents, widen.minGoodCents);
      redCents = Math.max(redCents, widen.minRedCents);
    }
    if ((goodCents === null) !== (redCents === null)) goodCents = redCents = null;

    return {
      tGoodSec: good / MS_PER_SEC,
      tRedSec: red / MS_PER_SEC,
      tBadSec: bad / MS_PER_SEC,
      matchWindowSec: w / MS_PER_SEC,
      goodCents,
      redCents,
      attackExcludeMs,
      minSteadyMs,
      liveProvisionalMs: g.live.provisionalMs,
      liveHysteresisCents: g.live.hysteresisCents,
    };
  });
};

/**
 * Intonation-graded for this played note (02 §4.2, §4.3): the band exists (not fixed pitch) and the played note
 * reached `intonationMinSteadyMs`. The semitone is graded either way.
 */
export function isIntonationGraded(tol: ResolvedTolerance, playedSteadyMs: number): boolean {
  return tol.goodCents !== null && tol.redCents !== null && playedSteadyMs >= tol.minSteadyMs;
}

/** Tuning-note offset for winds, brass and strings (02 §4.5): the measured deviation, capped at ±maxOffsetCents. */
export function tuningOffsetCents(measuredCents: number | null, cfg: Configs): number {
  if (measuredCents === null || !Number.isFinite(measuredCents)) return 0;
  const m = cfg.grading.tuning.maxOffsetCents;
  return Math.max(-m, Math.min(m, measuredCents));
}
