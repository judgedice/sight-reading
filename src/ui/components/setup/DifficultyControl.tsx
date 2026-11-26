import { useId, type ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';
import { DifficultyMeter } from '../domain/DifficultyMeter.tsx';
import { Stepper } from '../form/Stepper.tsx';
import { FewTag, NoteLine, SetupRowFrame } from './parts.tsx';
import { lineText, splitAt } from './text.ts';
import type { DifficultyRowView } from './types.ts';
import './setup.css';

export interface DifficultyControlProps {
  row: DifficultyRowView;
  onChange: (level: number) => void;
  /** Row label. Default "Difficulty". */
  label?: string;
  /** A `FallbackNote` for this row, shown above the label. */
  fallback?: ReactNode;
  /** "Not sure? Find my difficulty · 3 short pieces" (round 3, R75): runs placement. Absent: no link. */
  onFindLevel?: (() => void) | undefined;
  /** How many pieces placement plays, for the link's count. */
  placementCount?: number;
  /** A line under the row (the exhaustion offer, R77). */
  extra?: ReactNode;
}

/** The meter with a brass mark under the player's own difficulty. */
function Meter({ row }: { row: DifficultyRowView }) {
  const noMusic = row.segments.filter((s) => !s.hasMusic).map((s) => s.level);
  return (
    <span className="su-diff-meter" style={row.yourLevel ? { ['--su-yours' as string]: String(row.yourLevel) } : undefined} data-yours={row.yourLevel ?? undefined}>
      <DifficultyMeter level={row.value} noMusic={noMusic} />
      {row.yourLevel ? <span className="su-diff-yours" aria-hidden="true" /> : null}
    </span>
  );
}

/**
 * Difficulty (round 3, 01-ux-review §4.2, R76). Practice: the stepper "2 of 10", the meter with a brass mark at the
 * player's difficulty, the description, how the choice sits against the player's difficulty, and "Find my
 * difficulty". Ranked: a read-only row at the player's difficulty, and why it cannot be changed there.
 */
export function DifficultyControl({ row, onChange, label = copy('row.level'), fallback, onFindLevel, placementCount, extra }: DifficultyControlProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const skippedId = `${id}-skipped`;
  const [, suffix] = splitAt('setup.difficulty.value', { level: row.value, max: row.max }, 'level');

  if (row.locked) {
    const value = `${label} ${copy('setup.difficulty.value', { level: row.value, max: row.max })}`;
    return (
      <SetupRowFrame row="difficulty" labelId={labelId} label={label} before={fallback}>
        <div className="su-diff-locked" role="group" aria-labelledby={labelId} data-locked="true">
          <p className="su-diff-locked-value">
            <span className="ui-visually-hidden">{`${value}, ${copy('setup.difficulty.yours')}`}</span>
            <b aria-hidden="true">{value}</b>
          </p>
          <Meter row={row} />
          <p className="su-diff-locked-tag" aria-hidden="true">
            {copy('setup.difficulty.yours')}
          </p>
        </div>
        <p className="su-hint">{copy('setup.difficulty.rankedLocked')}</p>
        {extra}
      </SetupRowFrame>
    );
  }

  return (
    <SetupRowFrame row="difficulty" labelId={labelId} label={label} before={fallback}>
      <div className="su-diff-line" role="group" aria-labelledby={labelId} aria-describedby={row.skippedNote ? `${id}-desc ${skippedId}` : `${id}-desc`}>
        <Stepper value={row.value} min={1} max={row.max} disabledValues={row.skipped} ariaLabel={label} describedBy={`${id}-desc`} valueSuffix={suffix.trim()} onChange={(level) => onChange(level)} />
        <Meter row={row} />
      </div>
      <p className="su-hint su-hint-strong su-diff-desc" id={`${id}-desc`}>
        <span>{row.description}</span>
        {row.fewTag && row.fewNote ? (
          <>
            {' '}
            <FewTag tag={row.fewTag} full={row.fewNote} />
          </>
        ) : null}
        {row.relationNote ? (
          <>
            {' '}
            <b className="su-diff-relation">{lineText(row.relationNote)}</b>
          </>
        ) : null}
      </p>
      {onFindLevel ? (
        <div className="su-diff-foot">
          {onFindLevel ? (
            <p className="su-diff-find">
              <span className="su-muted">{`${copy('setup.difficulty.find.lead')} `}</span>
              <button type="button" className="su-link" data-testid="find-difficulty" onClick={onFindLevel}>
                {copy('action.runPlacementAgain')}
              </button>
              {placementCount ? <span className="su-muted">{` · ${copy('setup.difficulty.find.count', { count: placementCount })}`}</span> : null}
            </p>
          ) : null}
        </div>
      ) : null}
      {extra}
      {row.skippedNote ? <NoteLine id={skippedId} line={row.skippedNote} /> : null}
    </SetupRowFrame>
  );
}
