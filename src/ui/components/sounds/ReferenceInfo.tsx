import { useLayoutEffect, useRef } from 'react';
import { copy } from '../../copy/copy.ts';
import { InfoButton } from '../../primitives/InfoButton.tsx';
import type { ReferenceKind } from './types.ts';

/** The title, body and control name of the reference explanation (05 section 10), verbatim from the catalogue. */
export function referenceText(kind: ReferenceKind): { control: string; caption: string; title: string; body: string } {
  return kind === 'voice'
    ? {
        control: copy('action.hearReference'),
        caption: copy('reference.caption.voice'),
        title: copy('reference.info.title.voice'),
        body: copy('reference.info.voice'),
      }
    : {
        control: copy('action.hearKey'),
        caption: copy('reference.caption.instrument'),
        title: copy('reference.info.title.instrument'),
        body: copy('reference.info.instrument'),
      };
}

/**
 * The (i) next to the reference sound. A press, Enter or Space opens the popover and pins it; on a fine pointer a
 * 400 ms hover opens it too (the InfoButton primitive does both). The button also carries a native `title` with the
 * caption, for mouse users; it is never the only route (05 section 14 item 1).
 */
export function ReferenceInfo({ kind }: { kind: ReferenceKind }) {
  const text = referenceText(kind);
  const wrap = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    wrap.current?.querySelector('.ui-info-button')?.setAttribute('title', text.caption);
  }, [text.caption]);
  return (
    <span ref={wrap} className="sd-info">
      <InfoButton control={text.control} title={text.title}>
        {text.body}
      </InfoButton>
    </span>
  );
}
