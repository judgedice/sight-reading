import { useId, type CSSProperties, type ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import { BeatUnitText } from '../domain/BeatUnitText.tsx';
import { SetupRowFrame } from './parts.tsx';
import { SegmentRadios } from './SegmentRadios.tsx';
import { lineText, splitAt } from './text.ts';
import type { TempoRowView } from './types.ts';
import './setup.css';

export interface TempoRowProps {
  row: TempoRowView;
  /** The set tempo, or `'random'` for Any. */
  value: number | 'random';
  /** A tempo, or `'random'` for Any. Choosing the set segment from Any sends the middle of the range. */
  onChange: (bpm: number | 'random') => void;
  /** "Hear the tempo": one bar at this tempo with the chosen click (05 section 9.5). Hidden when absent. */
  onHearTempo?: ((bpm: number) => void) | undefined;
  /** Something that shares the row at its right end (Length when only one length exists, 04-design section 1). */
  end?: ReactNode;
  label?: string;
}

/** Beat units the music-text face draws; anything else (the half note) uses the drawn fallback. */
const FONT_UNITS = new Set(['♩', '♩.', '♪']);
const ANY = 'random';
const SET = 'set';

const clamp = (n: number, r: { min: number; max: number }): number => Math.min(r.max, Math.max(r.min, Math.round(n)));

function Unit({ unit }: { unit: string }) {
  return FONT_UNITS.has(unit) ? (
    <span className="su-tempo-unit" data-tempo-unit="">
      {unit}
    </span>
  ) : (
    <BeatUnitText text={unit} />
  );
}

/** "♩ = 72": the unit from the music-text face, set close to "=" (designer's check: within 0.35 em). */
export function TempoMarking({ unit, bpm }: { unit: string; bpm: number | string }) {
  const [before, after] = splitAt('tempo.marking', { bpm }, 'unit');
  return (
    <span className="su-tempo-mark" data-tempo-mark="">
      {before}
      <Unit unit={unit} />
      <span className="su-tempo-rest">{after}</span>
    </span>
  );
}

/**
 * Tempo (round 2: 01-ux section 6, 04-design section 1): a segmented Any or the set tempo ("♩ = 72"). Any shows the
 * range ("♩ = 60 to 76"); a set tempo shows a slider over the range and "Hear the tempo". `end` (Length) sits at the
 * right of the same row.
 */
export function TempoRow({ row, value, onChange, onHearTempo, end, label = copy('row.tempo') }: TempoRowProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const any = row.any || value === 'random';
  const bpm = value === 'random' ? clamp((row.range.min + row.range.max) / 2, row.range) : clamp(value, row.range);
  const span = row.range.max - row.range.min;
  const fill = { '--tempo-fill': `${span > 0 ? ((bpm - row.range.min) / span) * 100 : 0}%` } as CSSProperties;
  const rangeText = copy('range.cardText', { low: row.range.min, high: row.range.max });

  return (
    <SetupRowFrame row="tempo" labelId={labelId} label={label}>
      <div className="su-tempo-line">
        <SegmentRadios
          className="su-seg-tempo"
          labelledBy={labelId}
          onSelect={(v) => onChange(v === ANY ? 'random' : bpm)}
          options={[
            { id: ANY, content: copy('setup.time.any'), ariaLabel: lineText(row.anyLabel), selected: any },
            {
              id: SET,
              content: <TempoMarking unit={row.beatUnit} bpm={bpm} />,
              ariaLabel: copy('tempo.spoken', { unit: row.beatUnit, bpm }),
              selected: !any,
            },
          ]}
        />
        {any ? (
          <p className="su-hint su-tempo-range-text" data-tempo-range="">
            <TempoMarking unit={row.beatUnit} bpm={rangeText} />
          </p>
        ) : (
          <span className="su-tempo-set" role="group" aria-labelledby={labelId}>
            <input
              type="range"
              className="ui-tempo-range su-tempo-range"
              min={row.range.min}
              max={row.range.max}
              step={1}
              value={bpm}
              aria-label={label}
              aria-valuetext={copy('tempo.spoken', { unit: row.beatUnit, bpm })}
              style={fill}
              onChange={(event) => onChange(Number(event.target.value))}
            />
            {onHearTempo ? (
              <button type="button" className="su-icon-btn" data-hear-tempo="" title={copy('action.hearTempo')} onClick={() => onHearTempo(bpm)}>
                <Glyph id="metronome" size={20} />
                <span className="ui-visually-hidden">{copy('action.hearTempo')}</span>
              </button>
            ) : null}
          </span>
        )}
        {end ? <span className="su-row-end">{end}</span> : null}
      </div>
    </SetupRowFrame>
  );
}
