import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { copy } from '../../copy/copy.ts';
import { BeatUnitText } from '../domain/BeatUnitText.tsx';
import { Button } from '../form/Button.tsx';
import { Toggle } from '../form/Toggle.tsx';
import { Hint, SetupRowFrame, XpTag } from './parts.tsx';
import { lineText, splitAt } from './text.ts';
import type { TempoRowView } from './types.ts';
import './setup.css';

export interface TempoRowProps {
  row: TempoRowView;
  /** The set tempo, or `'random'` while "Any tempo in range" is on. */
  value: number | 'random';
  /** A tempo, or `'random'` when the switch is turned on. Turning it off sends the middle of the range. */
  onChange: (bpm: number | 'random') => void;
  /** "Hear the tempo": one bar at this tempo with the chosen click (05 section 9.5). Hidden when absent. */
  onHearTempo?: (bpm: number) => void;
  label?: string;
}

/** Beat units the music-text face draws; anything else (the half note) uses the drawn fallback. */
const FONT_UNITS = new Set(['♩', '♩.', '♪']);

const clamp = (n: number, r: { min: number; max: number }): number => Math.min(r.max, Math.max(r.min, Math.round(n)));

/** "♩ = 72": the unit from the music-text face, set close to "=" (designer's check: within 0.35 em). */
export function TempoMarking({ unit, bpm }: { unit: string; bpm: number }) {
  const [before, after] = splitAt('tempo.marking', { bpm }, 'unit');
  return (
    <span className="su-tempo-mark" data-tempo-mark="">
      {before}
      {FONT_UNITS.has(unit) ? (
        <span className="su-tempo-unit" data-tempo-unit="">
          {unit}
        </span>
      ) : (
        <BeatUnitText text={unit} />
      )}
      <span className="su-tempo-rest">{after}</span>
    </span>
  );
}

/** Tempo (05 section 5.6, 06 section 6.6): "Any tempo in range" switch; off shows the marking, slider and field. */
export function TempoRow({ row, value, onChange, onHearTempo, label = copy('row.tempo') }: TempoRowProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const [draft, setDraft] = useState<string | null>(null);
  const any = row.any || value === 'random';
  const bpm = value === 'random' ? clamp((row.range.min + row.range.max) / 2, row.range) : clamp(value, row.range);
  const span = row.range.max - row.range.min;
  const fill = { '--tempo-fill': `${span > 0 ? ((bpm - row.range.min) / span) * 100 : 0}%` } as CSSProperties;

  const commit = (): void => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    const parsed = Number(text);
    if (text === '' || !Number.isFinite(parsed)) return;
    const next = clamp(parsed, row.range);
    if (next !== bpm) onChange(next);
  };
  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') setDraft(null);
  };

  return (
    <SetupRowFrame
      row="tempo"
      labelId={labelId}
      label={label}
      aside={
        <span className="su-switch">
          <Toggle checked={any} label={lineText(row.anyLabel)} onChange={(on) => onChange(on ? 'random' : bpm)} />
          <XpTag line={row.xpTag} />
        </span>
      }
    >
      {any ? (
        <Hint>{lineText(row.anyValue)}</Hint>
      ) : (
        <>
          <div className="su-tempo-set" role="group" aria-labelledby={labelId}>
            <span className="su-tempo-value">
              <TempoMarking unit={row.beatUnit} bpm={bpm} />
            </span>
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
            <input
              type="number"
              inputMode="numeric"
              className="ui-tempo-field su-tempo-field"
              min={row.range.min}
              max={row.range.max}
              step={1}
              value={draft ?? bpm}
              aria-label={label}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={onFieldKey}
            />
          </div>
          {onHearTempo ? (
            <Button
              className="su-hear-tempo"
              variant="tonal"
              size="compact"
              icon="metronome"
              label={copy('action.hearTempo')}
              onClick={() => onHearTempo(bpm)}
            />
          ) : null}
        </>
      )}
    </SetupRowFrame>
  );
}
