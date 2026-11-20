import { copy } from '../../copy/copy.ts';
import { cls } from '../form/cls.ts';
import type { SureLevel } from './sure.ts';
import './diagnostics.css';

export interface SureLineProps {
  level: SureLevel;
  /** Marks that may be wrong (the `mostly` text). */
  n?: number;
  /** Notes that were steady and clear, and all notes (the `clear` text, when both are known). */
  steady?: number;
  total?: number;
  className?: string;
}

const BARS: Record<SureLevel, number> = { clear: 3, mostly: 2, unsure: 1 };

/** The "How sure we are" line in a quiet box with a three-bar level glyph (04-design section 8). */
export function SureLine({ level, n = 0, steady, total, className }: SureLineProps) {
  const text =
    level === 'clear'
      ? steady !== undefined && total !== undefined
        ? copy('sure.clear', { steady, total })
        : copy('sure.clear.plain')
      : level === 'mostly'
        ? copy('sure.mostly', { n })
        : copy('sure.unsure');
  return (
    <div className={cls('dg-sure', className)} data-level={level} data-testid="sure-line">
      <span className="dg-sure-bars" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <i key={i} data-on={i <= BARS[level] ? 'true' : 'false'} />
        ))}
      </span>
      <div className="dg-sure-text">
        <p>{text}</p>
        {level === 'unsure' ? <p className="dg-sure-help">{copy('sure.unsure.help')}</p> : null}
      </div>
    </div>
  );
}
