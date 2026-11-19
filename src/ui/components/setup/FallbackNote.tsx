import { useEffect, useRef, useState } from 'react';
import { Glyph } from '../../primitives/Glyph.tsx';
import { lineText, type TextLine } from './text.ts';
import './setup.css';

/** How long a fallback note stays (05 section 5.9). Same value as `FALLBACK_NOTE_MS` in the setup model. */
export const FALLBACK_NOTE_DURATION_MS = 6000;

export interface FallbackNoteProps {
  /** "Key set to Any: E minor isn't used at difficulty 1.", or null for none. */
  note: TextLine | null;
  /** Changes when the same note is caused again, so it shows (and is announced) afresh. */
  stamp?: number | string;
  durationMs?: number;
  /**
   * The screen's one polite live region (05 section 14.7). When given, the note is announced through it; when not,
   * the note sits in its own polite status region.
   */
  announce?: (text: string) => void;
  onExpire?: () => void;
}

/** A one-line note in the brass wash for six seconds after a choice fell back to Any (05 section 5.9). */
export function FallbackNote({ note, stamp, durationMs = FALLBACK_NOTE_DURATION_MS, announce, onExpire }: FallbackNoteProps) {
  const text = note ? lineText(note) : null;
  const [shown, setShown] = useState<string | null>(text);
  const announceRef = useRef(announce);
  const expireRef = useRef(onExpire);
  announceRef.current = announce;
  expireRef.current = onExpire;

  useEffect(() => {
    setShown(text);
    if (text === null) return undefined;
    announceRef.current?.(text);
    const timer = setTimeout(() => {
      setShown(null);
      expireRef.current?.();
    }, durationMs);
    return () => clearTimeout(timer);
  }, [text, stamp, durationMs]);

  const live = announce ? {} : ({ role: 'status', 'aria-live': 'polite' } as const);
  return (
    <div className="su-fallback-wrap" {...live}>
      {shown !== null ? (
        <p className="su-fallback">
          <Glyph id="info" size={16} className="su-fallback-icon" />
          <span>{shown}</span>
        </p>
      ) : null}
    </div>
  );
}
