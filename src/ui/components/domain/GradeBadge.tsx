import './domain.css';
import type { LetterGrade } from '../../../core/types.ts';
import { copy } from '../../copy/copy.ts';

export interface GradeBadgeProps {
  grade: LetterGrade;
  score: number;
  size?: 32 | 72;
  /** With stars the badge carries the full accessible name "Grade B, 85 out of 100, 2 stars" (04 5.5.2). */
  stars?: 0 | 1 | 2 | 3;
}

/** Letter in a square; at 72 the numeric score sits beside it at 32 px tabular (04 5.5.2). */
export function GradeBadge({ grade, score, size = 32, stars }: GradeBadgeProps) {
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
