import type { CSSProperties } from 'react';
import type { MidiRange } from './types.ts';
import './range.css';

/** The shared ruler axis, C1 to C8 in sounding pitch (06 D3). Same numbers as `RULER_AXIS` in the range model. */
export const RULER_LOW = 24;
export const RULER_HIGH = 108;
const MIDDLE_C = 60;

/** Position of a sounding MIDI number on the axis, as a percentage. */
export function rulerPercent(midi: number): number {
  const f = (midi - RULER_LOW) / (RULER_HIGH - RULER_LOW);
  return Math.round(Math.min(1, Math.max(0, f)) * 10000) / 100;
}

function span(range: MidiRange): CSSProperties {
  const left = rulerPercent(range[0]);
  return { left: `${left}%`, width: `${rulerPercent(range[1]) - left}%` };
}

const C_TICKS: readonly number[] = [24, 36, 48, 72, 84, 96, 108];

export interface RulerBarProps {
  /** Sounding full range. */
  full: MidiRange;
  /** Sounding served range at the difficulty; omit while the served data is not known (05 section 8.2). */
  served?: MidiRange | undefined;
  /** Fixed width in px (the phone summary row uses 64 or 88); default fills the container. */
  width?: number | undefined;
  className?: string | undefined;
}

/**
 * The small range picture (05 section 7.3, 06 section 6.11): a 22 px ruler on the shared C1 to C8 axis with a tick at
 * every C, middle C as a full-height tick on top, the full range light and the served range dark. Decorative: the
 * card's text range carries the meaning, so the whole bar is `aria-hidden`.
 */
export function RulerBar({ full, served, width, className }: RulerBarProps) {
  const style: CSSProperties | undefined = width === undefined ? undefined : { width: `${width}px` };
  return (
    <span className={['rp-ruler', className].filter(Boolean).join(' ')} style={style} aria-hidden="true" data-testid="ruler-bar">
      <span className="rp-ruler-track" />
      {C_TICKS.map((m) => (
        <span key={m} className="rp-ruler-tick" style={{ left: `${rulerPercent(m)}%` }} />
      ))}
      <span className="rp-ruler-full" style={span(full)} data-testid="ruler-full" />
      {served ? <span className="rp-ruler-served" style={span(served)} data-testid="ruler-served" /> : null}
      <span className="rp-ruler-middle-c" style={{ left: `${rulerPercent(MIDDLE_C)}%` }} />
    </span>
  );
}
