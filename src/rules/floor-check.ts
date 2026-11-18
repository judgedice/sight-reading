/**
 * CI floor check (01 §0, §8; R2). Fails when any tolerance, window, cap or served range in the 02-owned configs
 * is below the architect's measurement budget (`config/measurement-budget.json`). When it reports a violation,
 * 02 widens the value in config; code is never tuned to make the check pass.
 *
 * Rules checked:
 *  - timing floors per onset class: tGood >= goodSigmas x sigma and tRed >= redSigmas x sigma on the worst ranked
 *    path, and never below the budget's per-class minimum (01 §8.2). A hard-onset instrument may play slurred notes,
 *    so its class must meet the strictest class its instruments can produce.
 *  - cents bands: good >= 2 x c90, red >= 3 x c90 + 5 (02 §4.2), the budget's cents table (01 §8.4), and the voice
 *    relative-pitch allowance.
 *  - `intonationMinSteadyMs` (150 / 180), live provisional window (>= 80 ms) and hysteresis (10 / 5 cents).
 *  - notes-per-second caps per window class: cap <= 1000 / pitch-change floor (01 §8.3).
 *  - served fundamentals per window class (01 §7.3), piano LH never below C2, launch instruments >= 80 Hz.
 */
import type { Configs, FloorViolation, Instrument, MeasurementBudget, TimingFloorClass, VibratoClass } from '../core/types.ts';

const EPS = 1e-9;
const WINDOW_KEYS = ['512', '1024', '2048'] as const;

const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** The timing-floor classes an instrument can produce (01 §8.2): voice is its own class, others play articulated or slurred notes. */
function floorClassesOf(inst: Instrument): TimingFloorClass[] {
  return inst.family === 'voice' ? ['voice'] : ['articulated', 'slurred'];
}

/** Lowest written MIDI the instrument is ever served, over the full range and every tier. */
function lowestWritten(inst: Instrument): number {
  return Math.min(inst.fullWrittenRange[0], ...Object.values(inst.tiers).map((b) => b[0]));
}

/** sigma on the worst ranked path for a floor class, taking the budget's table value (01 §8.2). */
function worstSigma(budget: MeasurementBudget, cls: TimingFloorClass): number {
  const path = budget.timingFloors.worstRankedPath;
  const row = budget.onsetError.totals.find((t) => t.floorClass === cls && t.path === path);
  return row?.sigmaMs ?? 0;
}

/** Required tGood and tRed for a floor class: the larger of the sigma rule and the budget's stated minimum. */
function requiredTiming(budget: MeasurementBudget, cls: TimingFloorClass): { good: number; red: number } {
  const sigma = worstSigma(budget, cls);
  const stated = budget.timingFloors.floorsMs[cls];
  return {
    good: Math.max(stated.goodMs, budget.timingFloors.goodSigmas * sigma),
    red: Math.max(stated.redMs, budget.timingFloors.redSigmas * sigma),
  };
}

export function checkFloors(cfg: Configs, budget: MeasurementBudget): FloorViolation[] {
  const out: FloorViolation[] = [];
  const seen = new Set<string>();
  const add = (v: FloorViolation): void => {
    const key = `${v.file}|${v.path}|${v.rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };
  const atLeast = (file: FloorViolation['file'], path: string, value: number, floor: number, rule: string): void => {
    if (value < floor - EPS) add({ file, path, value, floor, rule });
  };
  const atMost = (file: FloorViolation['file'], path: string, value: number, ceiling: number, rule: string): void => {
    if (value > ceiling + EPS) add({ file, path, value, floor: ceiling, rule });
  };

  const { grading, levels, instruments } = cfg;

  // ---- timing: family floors by onset class (01 §8.2) ----
  const needed: Record<'hard' | 'soft', { good: number; red: number; goodCls: string; redCls: string }> = {
    hard: { good: 0, red: 0, goodCls: '', redCls: '' },
    soft: { good: 0, red: 0, goodCls: '', redCls: '' },
  };
  for (const inst of instruments.instruments) {
    for (const cls of floorClassesOf(inst)) {
      const req = requiredTiming(budget, cls);
      const slot = needed[inst.onsetClass];
      if (req.good > slot.good) {
        slot.good = req.good;
        slot.goodCls = cls;
      }
      if (req.red > slot.red) {
        slot.red = req.red;
        slot.redCls = cls;
      }
    }
  }
  for (const onset of ['hard', 'soft'] as const) {
    const floors = grading.timing.onsetClassFloors[onset];
    const n = needed[onset];
    const gs = budget.timingFloors.goodSigmas;
    const rs = budget.timingFloors.redSigmas;
    if (n.good > 0) atLeast('grading-config', `timing.onsetClassFloors.${onset}.goodMs`, floors.goodMs, n.good, `timing tGood >= ${gs} sigma (${n.goodCls}, ${onset} onset)`);
    if (n.red > 0) atLeast('grading-config', `timing.onsetClassFloors.${onset}.redMs`, floors.redMs, n.red, `timing tRed >= ${rs} sigma (${n.redCls}, ${onset} onset)`);
    atLeast('grading-config', `timing.onsetClassFloors.${onset}.badMs`, floors.badMs, floors.redMs, 'timing tBad >= tRed');
  }
  // Level-band absolute terms must not sit below the weakest floor class either (the family floor then wins for the rest).
  const minGood = Math.min(...(['articulated', 'slurred', 'voice'] as const).map((c) => requiredTiming(budget, c).good));
  const minRed = Math.min(...(['articulated', 'slurred', 'voice'] as const).map((c) => requiredTiming(budget, c).red));
  grading.timing.levelBands.forEach((band, i) => {
    atLeast('grading-config', `timing.levelBands[${i}].good.absMs`, band.good.absMs, minGood, 'timing tGood >= smallest class floor');
    atLeast('grading-config', `timing.levelBands[${i}].red.absMs`, band.red.absMs, minRed, 'timing tRed >= smallest class floor');
    atLeast('grading-config', `timing.levelBands[${i}].red.absMs`, band.red.absMs, band.good.absMs, 'timing tRed >= tGood');
    atLeast('grading-config', `timing.levelBands[${i}].bad.absMs`, band.bad.absMs, band.red.absMs, 'timing tBad >= tRed');
  });

  // ---- cents (02 §4.2, 01 §8.4) ----
  const c90 = budget.cents.c90Cents;
  const vibratoRow = (cls: VibratoClass, from: number, to: number | null) =>
    budget.cents.table.filter((r) => r.vibratoClass === cls && r.goodCents !== null && r.redCents !== null && r.minSteadyMs >= from && (to === null || (r.maxSteadyMs !== null && r.maxSteadyMs <= to)));
  const worstOf = (rows: ReturnType<typeof vibratoRow>) => ({
    good: Math.max(0, ...rows.map((r) => r.goodCents ?? 0)),
    red: Math.max(0, ...rows.map((r) => r.redCents ?? 0)),
  });
  // Long-steady rows set the floor for the bands. Voice and strings are vibrato families; winds and brass are not.
  const longVibrato = worstOf(vibratoRow('vibrato', 360, null));
  const longPlain = worstOf(vibratoRow('none', 360, null));
  grading.intonation.bands.forEach((band, i) => {
    if (band.goodCents === null || band.redCents === null) return;
    const path = `intonation.bands[${i}]`;
    atLeast('grading-config', `${path}.goodCents`, band.goodCents, 2 * c90, 'cents good >= 2 x c90');
    atLeast('grading-config', `${path}.redCents`, band.redCents, 3 * c90 + 5, 'cents red >= 3 x c90 + 5');
    if (band.group === 'voice') {
      const extra = budget.cents.voiceRelativeExtraCents;
      atLeast('grading-config', `${path}.goodCents`, band.goodCents, longVibrato.good + extra, 'voice cents good >= vibrato floor + relative-pitch allowance');
      atLeast('grading-config', `${path}.redCents`, band.redCents, longVibrato.red + extra, 'voice cents red >= vibrato floor + relative-pitch allowance');
    } else {
      // The continuous group covers vibrato strings and plain winds and brass: the stricter row applies.
      atLeast('grading-config', `${path}.goodCents`, band.goodCents, Math.max(longVibrato.good, longPlain.good), 'cents good >= budget cents floor');
      atLeast('grading-config', `${path}.redCents`, band.redCents, Math.max(longVibrato.red, longPlain.red), 'cents red >= budget cents floor');
    }
    atLeast('grading-config', `${path}.redCents`, band.redCents, band.goodCents, 'cents red >= good');
  });
  atLeast('grading-config', 'intonation.minSteadyMs.none', grading.intonation.minSteadyMs.none, budget.cents.minSteadyMs.none, 'intonationMinSteadyMs (non-vibrato) >= 150 ms');
  atLeast('grading-config', 'intonation.minSteadyMs.vibrato', grading.intonation.minSteadyMs.vibrato, budget.cents.minSteadyMs.vibrato, 'intonationMinSteadyMs (vibrato) >= 180 ms');
  const widened = worstOf(vibratoRow('vibrato', budget.cents.minSteadyMs.vibrato, grading.intonation.vibratoWiden.belowSteadyMs));
  atLeast('grading-config', 'intonation.vibratoWiden.minGoodCents', grading.intonation.vibratoWiden.minGoodCents, widened.good, 'vibrato widened band good >= budget cents floor');
  atLeast('grading-config', 'intonation.vibratoWiden.minRedCents', grading.intonation.vibratoWiden.minRedCents, widened.red, 'vibrato widened band red >= budget cents floor');

  // ---- live provisional sharp/flat (01 §8.4) ----
  atLeast('grading-config', 'live.provisionalMs', grading.live.provisionalMs, budget.live.minProvisionalMs, 'live provisional window >= 80 ms');
  const hysteresisFloor = grading.live.provisionalMs < budget.live.shortBelowMs ? budget.live.shortHysteresisCents : budget.live.longHysteresisCents;
  atLeast('grading-config', 'live.hysteresisCents', grading.live.hysteresisCents, hysteresisFloor, 'live hysteresis >= 10 cents (window under 150 ms) or 5 cents');

  // ---- notes per second per window class (01 §8.3) ----
  levels.levels.forEach((lvl, i) => {
    for (const w of WINDOW_KEYS) {
      atMost('levels', `levels[${i}].npsCap.${w}`, lvl.npsCap[w], 1000 / budget.ioiFloors.pitchChangeMs[w], `notes per second <= 1000 / pitch-change floor (${w} window)`);
    }
  });

  // ---- served fundamentals (01 §7.3) ----
  instruments.instruments.forEach((inst, i) => {
    const low = lowestWritten(inst);
    const lowSounding = low - inst.semis;
    const hz = midiToHz(lowSounding);
    const win = String(inst.detection.windowSamples) as (typeof WINDOW_KEYS)[number];
    atLeast('instruments', `instruments[${i}].fullWrittenRange[0]`, hz, budget.fundamentals.minHzByWindow[win], `served fundamental >= 3 periods of the ${win} window (${inst.id})`);
    if (inst.status === 'launch') {
      atLeast('instruments', `instruments[${i}].fullWrittenRange[0]`, hz, grading.components.lowFundamentalHz, `launch instrument served at or above ${grading.components.lowFundamentalHz} Hz (02 §1.2 criterion 3, ${inst.id})`);
    }
    if (inst.id === 'piano-lh') {
      atLeast('instruments', `instruments[${i}].fullWrittenRange[0]`, low, budget.fundamentals.pianoLhMinMidi, 'piano-lh served below C2 (R18)');
    }
  });

  return out;
}
