import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { copy } from '../../copy/copy.ts';
import './form.css';

export interface TempoSliderProps {
  /** Beats per minute. */
  value: number;
  min: number;
  max: number;
  /** Beat unit as shown in the marking, for example a quarter-note glyph or a dotted quarter. */
  beatUnit: string;
  onChange: (bpm: number) => void;
  /** Accessible name for both the slider and the numeric field (the setup row's label). */
  ariaLabel: string;
  disabled?: boolean;
}

/**
 * A slider plus a numeric field, so no control needs a drag (04 section 8.1, 2.5.7). The field
 * accepts typed values; it commits on blur or Enter, clamps to [min, max] and Escape reverts.
 */
export function TempoSlider({ value, min, max, beatUnit, onChange, ariaLabel, disabled = false }: TempoSliderProps) {
  // Non-null only while the field holds text the player is typing and has not committed yet.
  const [draft, setDraft] = useState<string | null>(null);

  const span = max - min;
  const fillPercent = span > 0 ? ((value - min) / span) * 100 : 0;
  const fill = { '--tempo-fill': `${fillPercent}%` } as CSSProperties;

  const commit = (): void => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (text === '') return;
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return;
    const next = Math.min(max, Math.max(min, Math.round(parsed)));
    if (next !== value) onChange(next);
  };

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      setDraft(null);
    }
  };

  return (
    <div className="ui-tempo">
      <span className="ui-tempo-marking">{copy('tempo.marking', { unit: beatUnit, bpm: value })}</span>
      <div className="ui-tempo-row">
        <input
          type="range"
          className="ui-tempo-range"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-valuetext={copy('tempo.spoken', { unit: beatUnit, bpm: value })}
          style={fill}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          type="number"
          inputMode="numeric"
          className="ui-tempo-field"
          min={min}
          max={max}
          step={1}
          value={draft ?? value}
          disabled={disabled}
          aria-disabled={disabled ? 'true' : undefined}
          aria-label={ariaLabel}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onFieldKey}
        />
      </div>
    </div>
  );
}
