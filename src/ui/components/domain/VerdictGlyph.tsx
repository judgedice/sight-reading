import './domain.css';
import type { GlyphId } from '../../glyph-ids.ts';
import { PLUS_N_SLOT } from '../../glyph-ids.ts';

export interface VerdictGlyphProps {
  id: GlyphId;
  size?: 9 | 12 | 14;
  /** For `plus-n`: the overflow count drawn in the glyph's number slot. */
  count?: number;
  /** Accessible name; the glyph is decorative when omitted. */
  label?: string;
}

/** A sprite glyph coloured by currentColor at a lane size (04 7.4). */
export function VerdictGlyph({ id, size = 12, count, label }: VerdictGlyphProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <svg className="dom-verdict" width={size} height={size} viewBox="0 0 24 24" focusable="false" data-glyph={id} {...a11y}>
      <use href={`#${id}`} />
      {id === 'plus-n' && count !== undefined ? (
        <text
          className="dom-verdict-count"
          x={PLUS_N_SLOT.x + PLUS_N_SLOT.w / 2}
          y={PLUS_N_SLOT.y + PLUS_N_SLOT.h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={PLUS_N_SLOT.h}
          fill="currentColor"
        >
          {count}
        </text>
      ) : null}
    </svg>
  );
}
