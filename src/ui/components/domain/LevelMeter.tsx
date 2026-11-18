import './domain.css';
import { copy } from '../../copy/copy.ts';

export interface LevelMeterProps {
  levelDb: number;
  gateDb: number;
  clipping: boolean;
  /** Floor of the scale in dB. */
  minDb?: number;
  /** Height of the clipping zone at the top of the scale, in dB (04 5.4.5). */
  clipZoneDb?: number;
  /** aria-hidden during takes (04 5.4.5); false for a labelled meter elsewhere. */
  decorative?: boolean;
  label?: string;
}

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

/** 64 x 8 input meter with three zones (04 5.4.5). The "!" shows only while clipping. */
export function LevelMeter({
  levelDb,
  gateDb,
  clipping,
  minDb = METER_MIN_DB,
  clipZoneDb = METER_CLIP_ZONE_DB,
  decorative = true,
  label,
}: LevelMeterProps) {
  const zone = meterZone(levelDb, gateDb, clipping, clipZoneDb);
  const fill = meterFraction(levelDb, minDb);
  const gate = meterFraction(gateDb, minDb);
  const clipStart = meterFraction(-clipZoneDb, minDb);
  const a11y = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'meter', 'aria-label': label, 'aria-valuemin': minDb, 'aria-valuemax': 0, 'aria-valuenow': Math.max(minDb, Math.min(0, levelDb)) };
  return (
    <span className="dom-meter" data-zone={zone} {...a11y}>
      <span className="dom-meter-track">
        <span className="dom-meter-clip" style={{ insetInlineStart: `${clipStart * 100}%` }} />
        <span className="dom-meter-fill" style={{ inlineSize: `${fill * 100}%` }} />
        <span className="dom-meter-gate" style={{ insetInlineStart: `${gate * 100}%` }} />
      </span>
      {zone === 'clipping' ? <span className="dom-meter-bang">{copy('play.meter.clip')}</span> : null}
    </span>
  );
}
