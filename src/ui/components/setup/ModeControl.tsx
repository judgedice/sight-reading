import { useId } from 'react';
import { copy } from '../../copy/copy.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import { cls } from '../form/cls.ts';
import { SegmentRadios } from './SegmentRadios.tsx';
import { splitAt } from './text.ts';
import type { PracticeMode, RankedBlock } from './types.ts';
import './setup.css';

export interface ModeControlProps {
  value: PracticeMode;
  onChange: (mode: PracticeMode) => void;
  /** Why Ranked cannot be chosen, or null. The reason is on the hint line, never only in a tooltip (05 section 5.8). */
  rankedBlock?: RankedBlock | null;
  /**
   * The fix, as a link inside the hint line: "Calibrate" or "Turn on microphone" (round 2, 01-ux section 4). Absent:
   * the reason has no link (the phone summary card's calibration row is the one Calibrate control there).
   */
  onFix?: ((block: RankedBlock) => void) | undefined;
  /** Kept for callers; the setup form's label column places the label. */
  inlineLabel?: boolean;
  label?: string;
}

/** The blocked reason with its fix as an inline link: "Ranked needs calibration on this device. Calibrate". */
function Reason({ id, block, onFix }: { id: string; block: RankedBlock; onFix?: ((block: RankedBlock) => void) | undefined }) {
  const [lead, tail] =
    block === 'calibration'
      ? splitAt('setup.mode.blocked.calibration.link', { link: '' }, 'link')
      : [`${copy('setup.mode.blocked.mic')} `, ''];
  const action = copy(block === 'calibration' ? 'calStatus.action.calibrate' : 'action.turnOnMic');
  return (
    <span className="su-mode-reason">
      <span id={id}>{lead.trimEnd()}</span>
      {onFix ? (
        <>
          {' '}
          <button type="button" className="su-link" data-mode-fix={block} onClick={() => onFix(block)}>
            {action}
          </button>
        </>
      ) : null}
      {tail.trim() ? tail : null}
    </span>
  );
}

/**
 * Mode (round 2: 01-ux section 6, 04-design section 1): Ranked and Practice, then one hint line. When Ranked is
 * blocked the line carries the reason and its fix as a link; there is no second button.
 */
export function ModeControl({ value, onChange, rankedBlock = null, onFix, inlineLabel = false, label = copy('row.mode') }: ModeControlProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const reasonId = `${id}-reason`;
  const hint = copy(value === 'ranked' ? 'setup.mode.ranked.hint' : 'setup.mode.practice.hint');
  return (
    <div className={cls('su-row', 'su-mode', inlineLabel && 'su-mode-inline')} data-setup-row="mode">
      <div className="su-row-head">
        <p id={labelId} className="su-label">
          {label}
        </p>
      </div>
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
      <p className="su-hint su-mode-hint">
        <span>{hint}</span>
        {rankedBlock ? (
          <>
            {' '}
            <Reason id={reasonId} block={rankedBlock} onFix={onFix} />
          </>
        ) : null}
      </p>
    </div>
  );
}
