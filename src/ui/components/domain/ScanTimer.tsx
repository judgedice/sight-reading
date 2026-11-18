import './domain.css';
import { Glyph } from '../../primitives/Glyph.tsx';

export interface ScanTimerProps {
  remainingSec: number;
  totalSec: number;
  mode: 'ranked' | 'practice';
  /** Accessible name; supply from copy (for example scan.chip.ranked). */
  label?: string;
}

const RING_VIEWBOX = 28;
const RING_STROKE = 3;
const RING_RADIUS = (RING_VIEWBOX - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Fraction of scan time left, 0..1. */
export function scanFraction(remainingSec: number, totalSec: number): number {
  if (!(totalSec > 0)) return 0;
  return Math.min(1, Math.max(0, remainingSec / totalSec));
}

/** 28 px ring counting down; in practice at 0 the ring gives way to a check mark (04 7.5). */
export function ScanTimer({ remainingSec, totalSec, mode, label }: ScanTimerProps) {
  const fraction = scanFraction(remainingSec, totalSec);
  const done = remainingSec <= 0;
  const showCheck = done && mode === 'practice';
  const secs = Math.max(0, Math.ceil(remainingSec));
  return (
    <span className="dom-scan-timer" data-mode={mode} data-done={done ? 'true' : undefined} role={label ? 'img' : undefined} aria-label={label}>
      <svg className="dom-scan-ring" viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`} aria-hidden="true" focusable="false">
        <circle className="dom-scan-ring-track" cx={RING_VIEWBOX / 2} cy={RING_VIEWBOX / 2} r={RING_RADIUS} fill="none" strokeWidth={RING_STROKE} />
        {showCheck ? null : (
          <circle
            className="dom-scan-ring-fill"
            cx={RING_VIEWBOX / 2}
            cy={RING_VIEWBOX / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
            transform={`rotate(-90 ${RING_VIEWBOX / 2} ${RING_VIEWBOX / 2})`}
            data-fraction={fraction}
          />
        )}
      </svg>
      {showCheck ? <Glyph id="check" size={14} className="dom-scan-check" /> : <span className="dom-scan-number">{secs}</span>}
    </span>
  );
}
