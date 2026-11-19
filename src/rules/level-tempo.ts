/**
 * The tempo range a level serves for a meter (02 §2.4), in metronome beats per minute. Compound meters (6/8, 9/8,
 * 12/8: the beat is a dotted quarter) at `compound.dottedBeatLevels` are counted in dotted-quarter beats and use
 * `compound.dottedBpm`; every other meter and level uses the level's own range. Selection, the ranked tempo check,
 * the XP tempo factor and the level window's mid-tempo test all read this one rule, so the served tempo and the
 * range it is judged against are always in the same unit.
 */
import type { Configs, LevelDef, Meter } from '../core/types.ts';

/** Compound x/8 meters counted in dotted quarters (02 conventions, `makeMeter`). */
export function isCompound(meter: Meter): boolean {
  return meter.countsPerBar !== meter.beats;
}

/** The level's tempo range for the meter; compound meters at `compound.dottedBeatLevels` use the dotted-beat range. */
export function levelTempo(cfg: Configs, def: LevelDef, meter: Meter): { minBpm: number; maxBpm: number } {
  const [from, to] = cfg.levels.compound.dottedBeatLevels;
  if (isCompound(meter) && def.level >= from && def.level <= to) return { ...cfg.levels.compound.dottedBpm };
  return { ...def.tempo };
}
