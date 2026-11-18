import './domain.css';
import type { RankGlyphId } from '../../glyph-ids.ts';

export interface RankEmblemProps {
  rank: number;
  /** achieved: `--text`; current: ringed `--accent`; future: outlined `--border-strong` (04 7.4). */
  state: 'achieved' | 'current' | 'future';
  size?: 24 | 64 | 96;
  label?: string;
}

export function rankGlyphId(rank: number): RankGlyphId {
  const n = Math.min(10, Math.max(1, Math.round(rank)));
  return `rank-${n}` as RankGlyphId;
}

/** Geometric rank emblem from the sprite; stroke scales with size (size / 32). */
export function RankEmblem({ rank, state, size = 64, label }: RankEmblemProps) {
  const id = rankGlyphId(rank);
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <span className="dom-rank" data-state={state} data-size={size} data-rank={id} {...a11y}>
      <svg width={size} height={size} viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <use href={`#${id}`} />
      </svg>
    </span>
  );
}
