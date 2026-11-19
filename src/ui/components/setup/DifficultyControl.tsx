import { useId, type ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';
import { DifficultyMeter } from '../domain/DifficultyMeter.tsx';
import { Stepper } from '../form/Stepper.tsx';
import { Toggle } from '../form/Toggle.tsx';
import { Hint, NoteLine, SetupRowFrame } from './parts.tsx';
import { lineText, splitAt } from './text.ts';
import type { DifficultyRowView } from './types.ts';
import './setup.css';

export interface DifficultyControlProps {
  row: DifficultyRowView;
  /** A difficulty, or `'random'` when "Follow my progress" is turned on. Turning it off sends the current value. */
  onChange: (level: number | 'random') => void;
  /** Onboarding: no "Follow my progress" switch. */
  hideFollow?: boolean;
  /** Row label. Default "Difficulty". */
  label?: string;
  /** A `FallbackNote` for this row, shown above the label. */
  fallback?: ReactNode;
}

/** Difficulty (05 section 5.3, 06 section 6.4): switch on the label row, stepper "2 of 10", meter, then the lines. */
export function DifficultyControl({ row, onChange, hideFollow = false, label = copy('row.level'), fallback }: DifficultyControlProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const skippedId = `${id}-skipped`;
  const follow = row.follow && !hideFollow;
  const [, suffix] = splitAt('setup.difficulty.value', { level: row.value, max: row.max }, 'level');
  const noMusic = row.segments.filter((s) => !s.hasMusic).map((s) => s.level);

  return (
    <SetupRowFrame
      row="difficulty"
      labelId={labelId}
      label={label}
      before={fallback}
      aside={
        hideFollow ? null : (
          <span className="su-switch">
            <Toggle
              checked={row.follow}
              label={copy('setup.difficulty.follow')}
              onChange={(on) => onChange(on ? 'random' : row.value)}
            />
          </span>
        )
      }
    >
      <div className="su-diff-line" role="group" aria-labelledby={labelId} aria-describedby={row.skippedNote ? skippedId : undefined}>
        {follow ? (
          <p className="su-diff-follow">{row.followValue ? lineText(row.followValue) : null}</p>
        ) : (
          <Stepper
            value={row.value}
            min={1}
            max={row.max}
            disabledValues={row.skipped}
            ariaLabel={label}
            valueSuffix={suffix.trim()}
            onChange={(level) => onChange(level)}
          />
        )}
        <DifficultyMeter level={row.value} noMusic={noMusic} />
      </div>
      {follow && row.followHint ? <Hint>{lineText(row.followHint)}</Hint> : null}
      <Hint strong>{row.description}</Hint>
      <p className="su-hint su-hint-tight">{lineText(row.servedLine)}</p>
      {row.fewNote ? <Hint strong>{lineText(row.fewNote)}</Hint> : null}
      {row.skippedNote ? <NoteLine id={skippedId} line={row.skippedNote} /> : null}
    </SetupRowFrame>
  );
}
