import type { ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';
import { cls } from '../form/cls.ts';
import type { PracticeMode } from './types.ts';
import './setup.css';

export interface ModePillProps {
  mode: PracticeMode;
  /**
   * The words after the dot: "no time limit", "seen before", "0:24 to read". Shown after the mode name and part of
   * the accessible name (which is the visible text).
   */
  detail?: string | null | undefined;
  /** Replaces the ring icon: the read-through's countdown ring (Ranked while reading). */
  ring?: ReactNode;
  /** `compact` for the try strip and inline in a sentence. */
  size?: 'default' | 'compact';
  className?: string | undefined;
  testId?: string | undefined;
}

/**
 * The mode pill (round 3, 01-ux-review §5, R79): one look for the mode everywhere it shows. Ranked is a solid brass
 * ring and border; Practice is a dashed neutral ring and border on the second surface. Shape, colour and the word all
 * differ, so neither colour nor shape alone carries the meaning.
 */
export function ModePill({ mode, detail, ring, size = 'default', className, testId = 'mode-pill' }: ModePillProps) {
  const name = copy(mode === 'ranked' ? 'mode.ranked' : 'mode.practice');
  return (
    <span className={cls('su-pill', size === 'compact' && 'su-pill-compact', className)} data-mode={mode} data-testid={testId}>
      {ring ?? (
        <svg className="su-pill-ring" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="7.5" fill="none" />
        </svg>
      )}
      <span className="su-pill-text">
        <span className="su-pill-name">{name}</span>
        {detail ? <span className="su-pill-detail">{` · ${detail}`}</span> : null}
      </span>
    </span>
  );
}
