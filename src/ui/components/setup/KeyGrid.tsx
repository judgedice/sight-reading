import { useCallback, useId, type CSSProperties, type ReactNode } from 'react';
import type { Clef, KeySig } from '../../../core/types.ts';
import { copy } from '../../copy/copy.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import { cls } from '../form/cls.ts';
import { MiniKeyStaff } from './MusicMarks.tsx';
import { NoteLine, SetupRowFrame, XpTag } from './parts.tsx';
import { lineText } from './text.ts';
import type { KeyOptionView, KeyRowView } from './types.ts';
import { useRadioGroup } from './use-radio-group.ts';
import './setup.css';

export interface KeyGridProps {
  row: KeyRowView;
  /** The instrument's first clef: the chips' mini staves use it. */
  clef: Clef;
  /** The effective difficulty: the desktop grid has 4 columns from difficulty 5, else 3 (06 D2). Phones always 3. */
  difficulty: number;
  /** The chosen written key, or `'random'` for "Any key". */
  onChange: (key: KeySig | 'random') => void;
  label?: string;
  /** A `FallbackNote` for this row, shown above the label. */
  fallback?: ReactNode;
}

/** Desktop column count for a difficulty (06 section 6.3 and D2). */
export const keyGridColumns = (difficulty: number): 3 | 4 => (difficulty >= 5 ? 4 : 3);

function accidentalsText(o: KeyOptionView): string {
  if (o.side === 'none') return copy('accidentals.none');
  return copy(o.side === 'sharp' ? 'accidentals.sharps' : 'accidentals.flats', { n: o.accidentals });
}

/** "G major, 1 sharp" or "A major, 3 sharps, sounds G major" (05 section 14.3). */
function chipName(o: KeyOptionView): string {
  const concert = o.concert?.vars['key'];
  return concert === undefined
    ? copy('setup.key.a11y', { key: o.name, accidentals: accidentalsText(o) })
    : copy('setup.key.a11yConcert', { key: o.name, accidentals: accidentalsText(o), concert });
}

function Check() {
  return (
    <span className="su-check" aria-hidden="true">
      <Glyph id="check-ui" size={14} />
    </span>
  );
}

/** Key (05 section 5.4, 06 section 6.3): a radio group of "Any key" and the written keys, Major then Minor. */
export function KeyGrid({ row, clef, difficulty, onChange, label = copy('row.key'), fallback }: KeyGridProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const moreId = `${id}-more`;
  const flat: (KeyOptionView | null)[] = [null, ...row.groups.flatMap((g) => g.keys)];
  const selected = row.any.selected ? 0 : flat.findIndex((o) => o?.selected === true);
  const select = useCallback(
    (i: number) => {
      const o = flat[i];
      onChange(o ? o.key : 'random');
    },
    // `flat` is rebuilt from `row` on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [row, onChange],
  );
  const never = useCallback(() => false, []);
  const item = useRadioGroup(flat.length, selected, never, select);
  const style = { '--su-key-cols': keyGridColumns(difficulty) } as CSSProperties;
  let index = 0;

  return (
    <SetupRowFrame row="key" labelId={labelId} label={label} before={fallback}>
      <div
        className="su-key-grid"
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={row.moreNote ? moreId : undefined}
        style={style}
      >
        <button
          type="button"
          role="radio"
          aria-checked={row.any.selected}
          className={cls('su-chip', 'su-chip-any', row.any.selected && 'su-chip-on')}
          {...item(index++)}
        >
          <span className="su-chip-name">{lineText(row.any.label)}</span>
          <span className="su-chip-hint">{lineText(row.any.hint)}</span>
          <XpTag line={row.any.xpTag} />
          {row.any.selected ? <Check /> : null}
        </button>
        {row.groups.map((g) => (
          <div key={g.mode} className="su-key-group" role="group" aria-labelledby={`${id}-${g.mode}`}>
            <p id={`${id}-${g.mode}`} className="su-key-group-label">
              {lineText(g.label)}
            </p>
            {g.keys.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={o.selected}
                aria-label={chipName(o)}
                className={cls('su-chip', o.selected && 'su-chip-on')}
                data-key={o.value}
                {...item(index++)}
              >
                <MiniKeyStaff clef={clef} fifths={o.key.fifths} />
                <span className="su-chip-name">{o.name}</span>
                {o.concert ? <span className="su-chip-concert">{lineText(o.concert)}</span> : null}
                {o.selected ? <Check /> : null}
              </button>
            ))}
          </div>
        ))}
      </div>
      {row.moreNote ? <NoteLine id={moreId} line={row.moreNote} /> : null}
    </SetupRowFrame>
  );
}
