import type { ReactNode } from 'react';
import { Glyph } from '../../primitives/Glyph.tsx';
import { cls } from '../form/cls.ts';
import { lineText, type TextLine } from './text.ts';
import './setup.css';

/** "+8% XP": the tag every Any option carries (05 section 5.10). */
export function XpTag({ line }: { line: TextLine }) {
  return <span className="su-tag">{lineText(line)}</span>;
}

/**
 * A small caution tag ("Few pieces") whose tooltip and accessible name are the full sentence (01-ux section 6). The
 * short word is drawn; a screen reader reads the sentence.
 */
export function FewTag({ tag, full, className }: { tag: TextLine; full: TextLine; className?: string }) {
  const sentence = lineText(full);
  return (
    <span className={cls('su-few', className)} title={sentence} data-setup-few="">
      <span aria-hidden="true">{lineText(tag)}</span>
      <span className="ui-visually-hidden">{sentence}</span>
    </span>
  );
}

/** A visible explanation under a control, with the info mark: skipped difficulties, hidden meters, later keys. */
export function NoteLine({ id, line, text }: { id?: string; line?: TextLine; text?: string }) {
  return (
    <p id={id} className="su-note-line">
      <Glyph id="info" size={16} className="su-note-icon" />
      <span>{text ?? (line ? lineText(line) : '')}</span>
    </p>
  );
}

/** A hint line under a control. `strong` uses the text colour (descriptions, few-pieces lines). */
export function Hint({ id, children, strong = false }: { id?: string; children: ReactNode; strong?: boolean }) {
  return (
    <p id={id} className={cls('su-hint', strong && 'su-hint-strong')}>
      {children}
    </p>
  );
}

/** A setup row: label (and anything that sits on the label row, such as a switch), then the control. */
export function SetupRowFrame({
  row,
  labelId,
  label,
  aside,
  before,
  children,
  className,
}: {
  row: string;
  labelId: string;
  label: string;
  aside?: ReactNode;
  before?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cls('su-row', className)} data-setup-row={row}>
      {before}
      <div className="su-row-head">
        <p id={labelId} className="su-label">
          {label}
        </p>
        {aside}
      </div>
      {children}
    </div>
  );
}
