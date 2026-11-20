import { copy } from '../../copy/copy.ts';
import { lineText, type TextLine } from './text.ts';
import './setup.css';

export interface XpLineProps {
  /** The model's `xp.line` ("Choosing Any: +24% XP"), or null when the sum is 0. */
  line: TextLine | null;
  /** Shown when `line` is null ("Choose Any for more XP."). Absent: nothing renders then. */
  none?: TextLine | null;
}

/** The one XP line above Start (round 2, 01-ux section 6). The "+24% XP" part is bold. */
export function XpLine({ line, none = null }: XpLineProps) {
  if (!line) return none ? <p className="su-xp-line" data-setup-xp="">{lineText(none)}</p> : null;
  const text = lineText(line);
  const percent = line.vars['percent'];
  const tag = percent === undefined ? '' : copy('setup.xpTag', { percent });
  const cut = tag && text.endsWith(tag) ? text.length - tag.length : text.length;
  return (
    <p className="su-xp-line" data-setup-xp="">
      {text.slice(0, cut)}
      {cut < text.length ? <b>{text.slice(cut)}</b> : null}
    </p>
  );
}
