import { useCallback, useId, type ReactNode } from 'react';
import { cls } from '../form/cls.ts';
import { useRadioGroup } from './use-radio-group.ts';
import './setup.css';

export interface SegmentRadio {
  id: string;
  /** What the segment shows. */
  content: ReactNode;
  /** Accessible name when the content is not plain text (a drawn meter). */
  ariaLabel?: string | undefined;
  /** Second line, read as the description ("+8% XP", "few pieces"). */
  caption?: ReactNode | undefined;
  selected: boolean;
  /** Not selectable; stays focusable. `describedBy` must name the visible reason. */
  blocked?: boolean | undefined;
  describedBy?: string | undefined;
}

export interface SegmentRadiosProps {
  options: readonly SegmentRadio[];
  onSelect: (id: string) => void;
  labelledBy: string;
  describedBy?: string | undefined;
  /** Segments share the full width (Mode). */
  stretch?: boolean;
  className?: string;
}

/** The segmented radio group of the setup rows (06 section 6.2). Wraps to a second line; never scrolls sideways. */
export function SegmentRadios({ options, onSelect, labelledBy, describedBy, stretch = false, className }: SegmentRadiosProps) {
  const base = useId();
  const selected = options.findIndex((o) => o.selected);
  const blocked = useCallback((i: number) => options[i]?.blocked === true, [options]);
  const select = useCallback(
    (i: number) => {
      const o = options[i];
      if (o) onSelect(o.id);
    },
    [options, onSelect],
  );
  const item = useRadioGroup(options.length, selected, blocked, select);
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={cls('su-seg', stretch && 'su-seg-stretch', className)}
    >
      {options.map((o, i) => {
        const capId = o.caption ? `${base}-cap-${i}` : undefined;
        const described = [o.describedBy, capId].filter(Boolean).join(' ') || undefined;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.selected}
            aria-disabled={o.blocked ? 'true' : undefined}
            aria-label={o.ariaLabel}
            aria-describedby={described}
            className={cls('su-seg-btn', o.selected && 'su-seg-on', o.blocked && 'su-seg-blocked')}
            data-value={o.id}
            {...item(i)}
          >
            <span className="su-seg-main">{o.content}</span>
            {o.caption ? (
              <span id={capId} className="su-seg-caption">
                {o.caption}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
