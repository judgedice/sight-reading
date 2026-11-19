import { useId, type ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';
import { SetupRowFrame } from './parts.tsx';
import { SegmentRadios } from './SegmentRadios.tsx';
import { lineText, type TextLine } from './text.ts';
import type { LengthRowView } from './types.ts';
import './setup.css';

export interface LengthRowProps {
  row: LengthRowView;
  /** Bars, or `'random'` for Any. */
  onChange: (bars: 8 | 10 | 12 | 'random') => void;
  label?: string;
  fallback?: ReactNode;
}

const ANY = 'random';

/** "8 bars" plain and "(the only length at difficulty 2)" muted, both from the one catalogue line. */
function OnlyLength({ note }: { note: TextLine }) {
  const text = lineText(note);
  const cut = text.indexOf(' (');
  if (cut < 0) return <p className="su-length-only">{text}</p>;
  return (
    <p className="su-length-only">
      {text.slice(0, cut)}
      <span className="su-muted">{text.slice(cut)}</span>
    </p>
  );
}

/** Length (05 section 5.7): plain text when one length is allowed, else Any and the allowed bar counts. No XP tag. */
export function LengthRow({ row, onChange, label = copy('row.length'), fallback }: LengthRowProps) {
  const id = useId();
  const labelId = `${id}-label`;
  return (
    <SetupRowFrame row="length" labelId={labelId} label={label} before={fallback}>
      {row.kind === 'only' ? (
        <OnlyLength note={row.note} />
      ) : (
        <SegmentRadios
          labelledBy={labelId}
          onSelect={(v) => onChange(v === ANY ? 'random' : (Number(v) as 8 | 10 | 12))}
          options={[
            { id: ANY, content: lineText(row.any.label), selected: row.any.selected },
            ...row.options.map((o) => ({
              id: String(o.bars),
              content: copy('setup.length.chip', { bars: o.bars }),
              selected: o.selected,
            })),
          ]}
        />
      )}
    </SetupRowFrame>
  );
}
