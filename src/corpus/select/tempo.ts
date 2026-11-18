/**
 * Tempo eligibility (01 §6.3 step 6, §8.3; 02 §2.4; 03 §7.5 rule 5): the excerpt's tempo range met with the level's,
 * clipped from above so every pitch-change IOI clears the window-class floor, every same-pitch repeat clears the
 * repeat floor for the instrument's onset profile, and the peak notes per second stays within the effective NPS cap
 * `min(levelCap, 1000 / pitchChangeFloorMs)`.
 */
import type { Configs, Instrument, LevelDef, Meter, Ticks } from '../../core/types.ts';
import { levelTempo, softRepeats, windowClass } from './levels.ts';

const EPS = 1e-9;

/** What tempo clipping reads; a manifest entry or an excerpt doc supplies it. */
export interface TempoFacts {
  meter: Meter;
  minBpm: number;
  maxBpm: number;
  /** Shortest pitch-change IOI, ticks. */
  minIoiTicks: Ticks;
  /** Shortest same-pitch repeat IOI, ticks; null when there are none. */
  minRepeatIoiTicks: Ticks | null;
  /** Peak notes per metronome beat in any one-beat window (`ManifestEntry.peakNotesPerBeat`). */
  peakNotesPerBeat: number;
}

/** Fastest metronome tempo the detector floors and the NPS cap allow, bpm (Infinity when nothing limits it). */
export function hardMaxBpm(x: TempoFacts, inst: Instrument, def: LevelDef, cfg: Configs): number {
  const floors = cfg.budget.ioiFloors;
  const wc = windowClass(inst);
  const beat = x.meter.countUnitTicks;
  let max = Infinity;
  // IOI(ms) = ioiTicks / beat * 60000 / bpm >= floor  ⇔  bpm <= 60000 * ioiTicks / (beat * floor).
  if (x.minIoiTicks > 0) max = Math.min(max, (60000 * x.minIoiTicks) / (beat * floors.pitchChangeMs[wc]));
  if (x.minRepeatIoiTicks !== null && x.minRepeatIoiTicks > 0) {
    const rep = softRepeats(inst) ? floors.repeatMs.voiceOrBowed : floors.repeatMs.tonguedOrStruck;
    max = Math.min(max, (60000 * x.minRepeatIoiTicks) / (beat * rep));
  }
  if (x.peakNotesPerBeat > 0) {
    const cap = Math.min(def.npsCap[wc], 1000 / floors.pitchChangeMs[wc]);
    max = Math.min(max, (cap * 60) / x.peakNotesPerBeat);
  }
  return max;
}

/** The eligible tempo range at this level for this instrument, or null when it is empty (03 §7.5 rule 5). */
export function clippedTempo(x: TempoFacts, inst: Instrument, def: LevelDef, cfg: Configs): { minBpm: number; maxBpm: number } | null {
  const lv = levelTempo(cfg, def, x.meter);
  const minBpm = Math.max(lv.minBpm, x.minBpm);
  const maxBpm = Math.min(lv.maxBpm, x.maxBpm, hardMaxBpm(x, inst, def, cfg));
  return minBpm <= maxBpm + EPS ? { minBpm, maxBpm: Math.max(minBpm, maxBpm) } : null;
}

/** Whether a fixed requested tempo is playable on this excerpt: within the detector and NPS limits. */
export function bpmPlayable(bpm: number, x: TempoFacts, inst: Instrument, def: LevelDef, cfg: Configs): boolean {
  return bpm <= hardMaxBpm(x, inst, def, cfg) + EPS;
}
