import { copy } from '../../copy/copy.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import { Sheet } from '../../primitives/Sheet.tsx';
import { referenceText } from './ReferenceInfo.tsx';
import { soundRows } from './rows.tsx';
import type { SoundsModel } from './types.ts';
import './sounds.css';

export interface SoundsExplainSheetProps {
  open: boolean;
  model: SoundsModel;
  onClose: () => void;
}

/**
 * "What do these do?" (05 section 8.8, 06 section 6.8): the sounds the phone has, each with its full name as the
 * row title and its caption. Three rows for a voice; four for winds, brass and strings, which add Check my tuning.
 * The reference row is highlighted and carries the same title and text as the popover.
 */
export function SoundsExplainSheet({ open, model, onClose }: SoundsExplainSheetProps) {
  const rows = soundRows(model, { idle: true });
  const reference = referenceText(model.reference);
  return (
    <Sheet open={open} title={copy('scan.sounds.whatAreThese')} onClose={onClose}>
      <ul className="sd-explain" data-testid="explain-list">
        {rows.map((row) => (
          <li key={row.id} className="sd-explain-row" data-sound={row.id} data-highlight={row.id === 'reference' ? 'true' : undefined}>
            <span className="sd-sound-tile">
              <Glyph id={row.icon} size={22} />
            </span>
            <div className="sd-explain-text">
              <p className="sd-explain-title">{row.label}</p>
              <p className="sd-explain-caption">{row.caption}</p>
              {row.id === 'listen' && model.ranked ? <p className="sd-explain-extra">{copy('scan.sounds.listenRanked')}</p> : null}
              {row.id === 'reference' ? (
                <div className="sd-explain-ref">
                  <p className="sd-explain-ref-title">{reference.title}</p>
                  <p className="sd-explain-ref-body">{reference.body}</p>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
