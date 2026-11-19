import './domain.css';

export interface DifficultyMeterProps {
  /** Difficulty 1..10: that many segments are filled. */
  level: number;
  /** 1-based segments with no music for this instrument: hollow with a dashed edge. */
  noMusic?: readonly number[];
}

export const DIFFICULTY_SEGMENTS = 10;

export type DifficultySegmentState = 'filled' | 'empty' | 'no-music';

/** State of each of the ten segments, in order. No music wins over filled or empty. */
export function difficultySegments(level: number, noMusic: readonly number[] = []): DifficultySegmentState[] {
  const filled = Number.isFinite(level) ? Math.min(DIFFICULTY_SEGMENTS, Math.max(0, Math.round(level))) : 0;
  return Array.from({ length: DIFFICULTY_SEGMENTS }, (_, i) => {
    const n = i + 1;
    if (noMusic.includes(n)) return 'no-music';
    return n <= filled ? 'filled' : 'empty';
  });
}

/** Ten segments (06 6.4): filled `accent`, empty `track`, hollow dashed where there is no music. Decorative: the stepper reads "2 of 10". */
export function DifficultyMeter({ level, noMusic }: DifficultyMeterProps) {
  return (
    <span className="dom-diff" aria-hidden="true">
      {difficultySegments(level, noMusic).map((state, i) => (
        <span key={i} className="dom-diff-seg" data-state={state} />
      ))}
    </span>
  );
}
