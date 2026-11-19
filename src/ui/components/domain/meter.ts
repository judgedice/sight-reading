// The microphone meter's scale (04 5.4.5): where a level in dB sits on the bar and which zone it is in. The performance
// screen draws the bar itself; the zones are shared so the screen and its tests agree. (The unused LevelMeter component
// that used to live beside this was deleted by the QA wave.)

export const METER_MIN_DB = -60;
export const METER_CLIP_ZONE_DB = 3;

/** Fraction 0..1 of the scale for a dB value. */
export function meterFraction(db: number, minDb: number = METER_MIN_DB): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db - minDb) / (0 - minDb)));
}

export type MeterZone = 'below-gate' | 'good' | 'clipping';

export function meterZone(levelDb: number, gateDb: number, clipping: boolean, clipZoneDb: number = METER_CLIP_ZONE_DB): MeterZone {
  if (clipping || levelDb >= -clipZoneDb) return 'clipping';
  return levelDb < gateDb ? 'below-gate' : 'good';
}
