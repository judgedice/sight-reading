import './domain.css';
import type { LetterGrade } from '../../../core/types.ts';
import { copy } from '../../copy/copy.ts';
import { Glyph } from '../../primitives/Glyph.tsx';

export type GradeBadgeKind = 'ranked' | 'practice' | 'not-graded' | 'incomplete';

interface LetterProps {
  kind?: undefined;
  grade: LetterGrade;
  score: number;
  size?: 32 | 72;
  /** With stars the badge carries the full accessible name "Grade B, 85 out of 100, 2 stars" (04 5.5.2). */
  stars?: 0 | 1 | 2 | 3;
}

interface PillProps {
  /** A status pill (06 6.15): Ranked is an ink pill; Practice, Not graded and Incomplete sit on `surface-2`. */
  kind: GradeBadgeKind;
  /** Incomplete only: the score cap named in its explanation. */
  cap?: number;
}

export type GradeBadgeProps = LetterProps | PillProps;

const PILL_COPY = {
  ranked: 'badge.ranked',
  practice: 'badge.practice',
  'not-graded': 'results.badge.notGraded',
  incomplete: 'badge.incomplete',
} as const;

/** Letter in a square (04 5.5.2), or with `kind` a status pill. */
export function GradeBadge(props: GradeBadgeProps) {
  if (props.kind !== undefined) {
    const { kind, cap } = props;
    const why = kind === 'incomplete' && cap !== undefined ? copy('badge.incomplete.tooltip', { cap }) : undefined;
    return (
      <span className="dom-pill" data-kind={kind} title={why}>
        {kind === 'incomplete' ? <Glyph id="caution" size={14} className="dom-pill-icon" /> : null}
        {copy(PILL_COPY[kind])}
        {why ? <span className="dom-sr">{why}</span> : null}
      </span>
    );
  }
  const { grade, score, size = 32, stars } = props;
  const name = stars === undefined ? undefined : copy('a11y.grade.heading', { grade, score, stars });
  return (
    <span className="dom-grade" data-size={size} role={name ? 'img' : undefined} aria-label={name}>
      <span className="dom-grade-letter" aria-hidden={name ? 'true' : undefined}>
        {grade}
      </span>
      {size === 72 ? (
        <span className="dom-grade-score" aria-hidden={name ? 'true' : undefined}>
          {Math.round(score)}
        </span>
      ) : null}
    </span>
  );
}
