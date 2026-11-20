import { useId, type ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';
import { DifficultyMeter } from '../domain/DifficultyMeter.tsx';
import { Stepper } from '../form/Stepper.tsx';
import { Toggle } from '../form/Toggle.tsx';
import { FewTag, Hint, NoteLine, SetupRowFrame } from './parts.tsx';
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
  /** Opens "Match a note". With it, difficulty 1 shows "Simpler? Match a note first." beside the switch. */
  onMatch?: (() => void) | undefined;
}

/** "Simpler? Match a note first.": the words before the link stay plain, the rest is the link (04-design section 1). */
function MatchHint({ line, onMatch }: { line: NonNullable<DifficultyRowView['matchHint']>; onMatch: () => void }) {
  const text = lineText(line);
  const cut = text.indexOf('? ');
  const lead = cut >= 0 ? text.slice(0, cut + 2) : '';
  const link = cut >= 0 ? text.slice(cut + 2).replace(/\.$/, '') : text;
  return (
    <p className="su-diff-match" data-setup-match="">
      {lead ? <span className="su-muted">{lead}</span> : null}
      <button type="button" className="su-link" onClick={onMatch}>
        {link}
      </button>
    </p>
  );
}

/**
 * Difficulty (round 2: 01-ux section 6, 04-design section 1): stepper "2 of 10" and the meter on one line; the
 * description with a "Few pieces" tag; "Follow my progress" with "Simpler? Match a note first" across from it.
 */
export function DifficultyControl({ row, onChange, hideFollow = false, label = copy('row.level'), fallback, onMatch }: DifficultyControlProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const skippedId = `${id}-skipped`;
  const follow = row.follow && !hideFollow;
  const [, suffix] = splitAt('setup.difficulty.value', { level: row.value, max: row.max }, 'level');
  const noMusic = row.segments.filter((s) => !s.hasMusic).map((s) => s.level);
  const match = onMatch && row.matchHint ? <MatchHint line={row.matchHint} onMatch={onMatch} /> : null;

  return (
    <SetupRowFrame row="difficulty" labelId={labelId} label={label} before={fallback}>
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
      <p className="su-hint su-hint-strong su-diff-desc">
        <span>{row.description}</span>
        {row.fewTag && row.fewNote ? (
          <>
            {' '}
            <FewTag tag={row.fewTag} full={row.fewNote} />
          </>
        ) : null}
      </p>
      {follow && row.followHint ? <Hint>{lineText(row.followHint)}</Hint> : null}
      {hideFollow && !match ? null : (
        <div className="su-diff-foot">
          {hideFollow ? null : (
            <span className="su-switch">
              <Toggle checked={row.follow} label={copy('setup.difficulty.follow')} onChange={(on) => onChange(on ? 'random' : row.value)} />
            </span>
          )}
          {match}
        </div>
      )}
      {row.skippedNote ? <NoteLine id={skippedId} line={row.skippedNote} /> : null}
    </SetupRowFrame>
  );
}
