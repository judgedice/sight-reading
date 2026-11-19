import { useId } from 'react';
import { copy } from '../../copy/copy.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import { Button } from '../form/Button.tsx';
import { cls } from '../form/cls.ts';
import { SegmentRadios } from './SegmentRadios.tsx';
import type { PracticeMode, RankedBlock } from './types.ts';
import './setup.css';

export interface ModeControlProps {
  value: PracticeMode;
  onChange: (mode: PracticeMode) => void;
  /** Why Ranked cannot be chosen, or null. The reason and its fix are shown, not hidden in a tooltip (05 section 5.8). */
  rankedBlock?: RankedBlock | null;
  /** "Calibrate now" or "Turn on microphone". Required for the fix button to show. */
  onFix?: (block: RankedBlock) => void;
  /** Desktop setup foot: the label sits left of the segments. Default: label above. */
  inlineLabel?: boolean;
  label?: string;
}

const REASON = { calibration: 'setup.mode.blocked.calibration', mic: 'setup.mode.blocked.mic' } as const;
const FIX = { calibration: 'action.calibrateNow', mic: 'action.turnOnMic' } as const;

/** Mode (05 section 5.8): Ranked and Practice with the selected option's hint; a blocked Ranked stays focusable. */
export function ModeControl({ value, onChange, rankedBlock = null, onFix, inlineLabel = false, label = copy('row.mode') }: ModeControlProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const reasonId = `${id}-reason`;
  const hint = copy(value === 'ranked' ? 'setup.mode.ranked.hint' : 'setup.mode.practice.hint');
  return (
    <div className={cls('su-row', 'su-mode', inlineLabel && 'su-mode-inline')} data-setup-row="mode">
      <p id={labelId} className="su-label">
        {label}
      </p>
      <SegmentRadios
        stretch
        labelledBy={labelId}
        onSelect={(v) => onChange(v as PracticeMode)}
        options={[
          {
            id: 'ranked',
            content: rankedBlock ? (
              <span className="su-mode-blocked-label">
                <Glyph id="alert-triangle" size={16} />
                {copy('mode.ranked')}
              </span>
            ) : (
              copy('mode.ranked')
            ),
            selected: value === 'ranked',
            blocked: rankedBlock !== null,
            describedBy: rankedBlock ? reasonId : undefined,
          },
          { id: 'practice', content: copy('mode.practice'), selected: value === 'practice' },
        ]}
      />
      <div className="su-mode-hints">
        {rankedBlock ? (
          <>
            <p id={reasonId} className="su-hint su-hint-strong">
              {copy(REASON[rankedBlock])}
            </p>
            {onFix ? (
              <Button className="su-mode-fix" size="compact" variant="secondary" label={copy(FIX[rankedBlock])} onClick={() => onFix(rankedBlock)} />
            ) : null}
          </>
        ) : null}
        <p className="su-hint">{hint}</p>
      </div>
    </div>
  );
}
