import { useCallback, useId, useState, type CSSProperties, type ReactNode } from 'react';
import type { Clef, KeySig } from '../../../core/types.ts';
import { copy } from '../../copy/copy.ts';
import { tokens } from '../../tokens.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import { Popover } from '../../primitives/Popover.tsx';
import { cls } from '../form/cls.ts';
import { MiniKeyStaff } from './MusicMarks.tsx';
import { NoteLine, SetupRowFrame } from './parts.tsx';
import { lineText } from './text.ts';
import type { KeyOptionView, KeyRowView } from './types.ts';
import { useRadioGroup } from './use-radio-group.ts';
import './setup.css';

export interface KeyGridProps {
  row: KeyRowView;
  /** The instrument's first clef: the chips' signatures use it. */
  clef: Clef;
  /** The effective difficulty (kept for callers; the layout follows the number of keys). */
  difficulty?: number;
  /** The chosen written key, or `'random'` for "Any key". */
  onChange: (key: KeySig | 'random') => void;
  /**
   * Show every key in place, grouped Major then Minor (the phone setup sheet). Default: up to eight keys as one row
   * of chips, above that one button that opens them in a popover (04-design section 1).
   */
  expanded?: boolean;
  label?: string;
  /** A `FallbackNote` for this row, shown above the label. */
  fallback?: ReactNode;
}

/** Staff space of the small drawn signature on a chip (04-design section 1: a 28 px signature). */
export const KEY_CHIP_STAFF_SPACE = tokens.component['key-chip-staff-space'] * (4 / 6.5);

/** Width of a chip's signature: clef, one step per accidental and a little room, in staff spaces. */
const sigWidth = (fifths: number, sp: number): number => Math.round((3.9 + Math.min(7, Math.abs(fifths)) * 1.15 + 0.7) * sp);

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
      <Glyph id="check-ui" size={12} />
    </span>
  );
}

function Signature({ clef, fifths }: { clef: Clef; fifths: number }) {
  const sp = KEY_CHIP_STAFF_SPACE;
  return (
    <span className="su-key-sig" style={{ width: `${sigWidth(fifths, sp)}px` } as CSSProperties}>
      <MiniKeyStaff clef={clef} fifths={fifths} staffSpace={sp} />
    </span>
  );
}

/** "Difficulty 1 uses major keys with up to 1 sharp or flat. Minor keys start at difficulty 2." */
function keyNote(row: KeyRowView): string {
  return [lineText(row.uses), row.next ? lineText(row.next) : null].filter(Boolean).join(' ');
}

/** The value a closed Key button shows: "Any key" or the chosen key's name. */
function chosenName(row: KeyRowView): string {
  if (row.any.selected) return lineText(row.any.label);
  return row.groups.flatMap((g) => g.keys).find((k) => k.selected)?.name ?? lineText(row.any.label);
}

interface ChipsProps {
  row: KeyRowView;
  clef: Clef;
  onChange: (key: KeySig | 'random') => void;
  labelledBy: string;
  describedBy?: string | undefined;
  /** `row`: one wrapping row; `grid`: grouped with labels (sheet); `popover`: grouped, five a row, Any key at the foot. */
  variant: 'row' | 'grid' | 'popover';
}

/** The radio group of "Any key" and the written keys. One Tab stop; arrows move and select. */
function KeyChips({ row, clef, onChange, labelledBy, describedBy, variant }: ChipsProps) {
  const groupId = useId();
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
  let index = 1;

  const any = (
    <button
      type="button"
      role="radio"
      aria-checked={row.any.selected}
      className={cls('su-chip', 'su-chip-any', row.any.selected && 'su-chip-on')}
      {...item(0)}
    >
      <span className="su-chip-name">{lineText(row.any.label)}</span>
      {row.any.selected ? <Check /> : null}
    </button>
  );
  const chip = (o: KeyOptionView): ReactNode => (
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
      <Signature clef={clef} fifths={o.key.fifths} />
      <span className="su-chip-name">{variant === 'popover' ? (o.tonic ?? o.name) : o.name}</span>
      {o.concert && variant === 'grid' ? <span className="su-chip-concert">{lineText(o.concert)}</span> : null}
      {o.selected ? <Check /> : null}
    </button>
  );

  if (variant === 'row') {
    return (
      <div className="su-key-row" role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy}>
        {any}
        {row.groups.flatMap((g) => g.keys).map(chip)}
      </div>
    );
  }
  const groups = row.groups.map((g) => (
    <div key={g.mode} className="su-key-group" role="group" aria-labelledby={`${groupId}-${g.mode}`}>
      <p id={`${groupId}-${g.mode}`} className="su-key-group-label">
        {lineText(g.label)}
      </p>
      {g.keys.map(chip)}
    </div>
  ));
  return (
    <div
      className={cls('su-key-grid', variant === 'popover' && 'su-key-grid-pop')}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      {variant === 'grid' ? any : null}
      {groups}
      {variant === 'popover' ? (
        <div className="su-key-pop-foot">
          {any}
          <p className="su-hint su-key-pop-hint">{copy('setup.key.pick')}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Key (round 2: 01-ux sections 6 and 7, 04-design section 1). Up to eight keys: one row of chips, each with a small
 * drawn signature, then the key note ("Difficulty 1 uses major keys…"). Above eight: one button with the current
 * value and the count beside it; the chips open in a popover, Major and Minor, Any key at the foot.
 */
export function KeyGrid({ row, clef, onChange, expanded = false, label = copy('row.key'), fallback }: KeyGridProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const noteId = `${id}-note`;
  const manyId = `${id}-many`;
  const popId = `${id}-pop`;
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const many = row.many !== null && !expanded;

  if (many) {
    return (
      <SetupRowFrame row="key" labelId={labelId} label={label} before={fallback}>
        <div className="su-key-many">
          <button
            ref={setAnchor}
            type="button"
            className={cls('su-key-button', open && 'su-key-button-open')}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? popId : undefined}
            aria-describedby={manyId}
            data-key-button=""
            onClick={() => setOpen((v) => !v)}
          >
            <span className="ui-visually-hidden">{`${label}: `}</span>
            <span>{chosenName(row)}</span>
            <Glyph id="chevron-down" size={16} className="su-key-button-chevron" />
          </button>
          <p id={manyId} className="su-hint su-key-many-text">
            {row.many ? lineText(row.many) : null}
          </p>
        </div>
        <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label={label} id={popId}>
          <div className="su-key-pop" data-key-popover="">
            <KeyChips
              row={row}
              clef={clef}
              labelledBy={labelId}
              variant="popover"
              onChange={(k) => {
                onChange(k);
                setOpen(false);
                anchor?.focus();
              }}
            />
          </div>
        </Popover>
      </SetupRowFrame>
    );
  }

  return (
    <SetupRowFrame row="key" labelId={labelId} label={label} before={fallback}>
      <KeyChips row={row} clef={clef} onChange={onChange} labelledBy={labelId} describedBy={noteId} variant={expanded ? 'grid' : 'row'} />
      <NoteLine id={noteId} text={keyNote(row)} />
    </SetupRowFrame>
  );
}
