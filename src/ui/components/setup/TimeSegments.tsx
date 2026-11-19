import { useId, type ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';
import { TimeSignatureMark } from './MusicMarks.tsx';
import { Hint, NoteLine, SetupRowFrame, XpTag } from './parts.tsx';
import { SegmentRadios } from './SegmentRadios.tsx';
import { lineText } from './text.ts';
import type { TimeRowView } from './types.ts';
import './setup.css';

export interface TimeSegmentsProps {
  row: TimeRowView;
  /** The chosen meter ("3/4"), or `'random'` for Any. */
  onChange: (meter: string | 'random') => void;
  label?: string;
  fallback?: ReactNode;
}

const ANY = 'random';

/** Time (05 section 5.5, 06 section 6.2): Any first, then the meters with music, drawn as stacked numerals. */
export function TimeSegments({ row, onChange, label = copy('row.time'), fallback }: TimeSegmentsProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const hiddenId = `${id}-hidden`;
  return (
    <SetupRowFrame row="time" labelId={labelId} label={label} before={fallback}>
      <SegmentRadios
        className="su-seg-time"
        labelledBy={labelId}
        describedBy={row.hiddenNote ? hiddenId : undefined}
        onSelect={(v) => onChange(v === ANY ? 'random' : v)}
        options={[
          { id: ANY, content: lineText(row.any.label), caption: <XpTag line={row.any.xpTag} />, selected: row.any.selected },
          ...row.options.map((o) => ({
            id: o.meter,
            content: <TimeSignatureMark beats={o.beats} unit={o.unit} />,
            ariaLabel: lineText(o.a11y),
            caption: o.few ? copy('setup.time.few') : undefined,
            selected: o.selected,
          })),
        ]}
      />
      {row.fewNote ? <Hint strong>{lineText(row.fewNote)}</Hint> : null}
      {row.hiddenNote ? <NoteLine id={hiddenId} line={row.hiddenNote} /> : null}
    </SetupRowFrame>
  );
}
