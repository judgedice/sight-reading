import { useId, useState, type ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import { Popover } from '../../primitives/Popover.tsx';
import { cls } from '../form/cls.ts';
import { TimeSignatureMark } from './MusicMarks.tsx';
import { SetupRowFrame } from './parts.tsx';
import { SegmentRadios, type SegmentRadio } from './SegmentRadios.tsx';
import { lineText } from './text.ts';
import type { TimeOptionView, TimeRowView } from './types.ts';
import './setup.css';

export interface TimeSegmentsProps {
  row: TimeRowView;
  /** The chosen meter ("3/4"), or `'random'` for Any. */
  onChange: (meter: string | 'random') => void;
  /** Every meter in place (the phone setup sheet). Default: above seven meters the rest open from "More". */
  expanded?: boolean;
  label?: string;
  fallback?: ReactNode;
}

const ANY = 'random';

/** A meter segment: the drawn numerals, and a small caution dot with the tooltip "Few pieces" when music is thin. */
function meterSegment(o: TimeOptionView, fewTip: string): SegmentRadio {
  return {
    id: o.meter,
    content: (
      <span className="su-meter" title={o.few ? fewTip : undefined}>
        <TimeSignatureMark beats={o.beats} unit={o.unit} />
        {o.few ? <span className="su-few-dot" aria-hidden="true" /> : null}
      </span>
    ),
    // The spoken name always names the meter: "3/4, few pieces" (01-ux 16.5).
    ariaLabel: lineText(o.a11y),
    selected: o.selected,
  };
}

/**
 * Time signature (round 2: 01-ux sections 6 and 8, 04-design section 1): Any and the meters with music as one
 * segmented row, with "No 2/4 at difficulty 1 yet." on the same line. Above seven meters: Any, the five most used and
 * "More", which opens the rest; a meter chosen there joins the row.
 */
export function TimeSegments({ row, onChange, expanded = false, label = copy('row.time'), fallback }: TimeSegmentsProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const hiddenId = `${id}-hidden`;
  const popId = `${id}-more`;
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const fewTip = lineText(row.fewTip);
  const folded = !expanded && row.more.length > 0;
  const chosenMore = folded ? row.more.find((o) => o.selected) : undefined;
  const shown = folded ? [...row.top, ...(chosenMore ? [chosenMore] : [])] : row.options;
  const rest = folded ? row.more.filter((o) => !o.selected) : [];
  const pick = (v: string): void => onChange(v === ANY ? 'random' : v);

  return (
    <SetupRowFrame row="time" labelId={labelId} label={label} before={fallback}>
      <div className="su-time-line">
        <span className="su-seg-wrap">
          <SegmentRadios
            className="su-seg-time"
            labelledBy={labelId}
            describedBy={row.hiddenNote ? hiddenId : undefined}
            onSelect={pick}
            options={[{ id: ANY, content: lineText(row.any.label), selected: row.any.selected }, ...shown.map((o) => meterSegment(o, fewTip))]}
          />
          {folded ? (
            <button
              ref={setAnchor}
              type="button"
              className={cls('su-more', open && 'su-more-open')}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={open ? popId : undefined}
              data-time-more=""
              onClick={() => setOpen((v) => !v)}
            >
              <span>{copy('setup.time.more')}</span>
              <span className="su-more-count">{rest.length}</span>
              <Glyph id="chevron-down" size={16} />
            </button>
          ) : null}
        </span>
        {row.hiddenNote ? (
          <p id={hiddenId} className="su-hint su-time-hidden">
            {lineText(row.hiddenNote)}
          </p>
        ) : null}
      </div>
      {folded ? (
        <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label={label} id={popId}>
          <div className="su-time-pop" data-time-popover="">
            <SegmentRadios
              className="su-seg-time su-seg-pop"
              labelledBy={labelId}
              onSelect={(v) => {
                pick(v);
                setOpen(false);
                anchor?.focus();
              }}
              options={rest.map((o) => meterSegment(o, fewTip))}
            />
          </div>
        </Popover>
      ) : null}
    </SetupRowFrame>
  );
}
