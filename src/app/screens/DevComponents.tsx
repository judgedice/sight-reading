import { useState } from 'react';
import { copy } from '../../ui/copy/copy.ts';
import { noteVisual } from '../../notation/visual-states.ts';
import type { NoteVisualState } from '../../core/types.ts';
import { VerdictGlyph } from '../../ui/components/domain/index.ts';
import { Modal, Popover, Sheet, useToast } from '../../ui/primitives/index.ts';

/** One note state per verdict look, in review mode (the mode that shows every glyph). */
export const VERDICT_STATES: readonly { id: string; state: NoteVisualState }[] = [
  { id: 'pending', state: { phase: 'pending' } },
  { id: 'correct', state: { phase: 'judged' } },
  { id: 'marginal', state: { phase: 'judged', marginal: true } },
  { id: 'early', state: { phase: 'judged', timing: 'early' } },
  { id: 'late', state: { phase: 'judged', timing: 'late' } },
  { id: 'sharp', state: { phase: 'judged', pitch: 'sharp' } },
  { id: 'flat', state: { phase: 'judged', pitch: 'flat' } },
  { id: 'wrong-pitch', state: { phase: 'judged', pitch: 'wrong-pitch' } },
  { id: 'octave', state: { phase: 'judged', pitch: 'octave' } },
  { id: 'missed', state: { phase: 'missed' } },
];

/** Dev-only page: not product copy, so not in the catalogue. */
const GALLERY_TITLE = 'Verdict states';

const NOTE_COLOUR: Record<string, string> = { 'n-ink': 'var(--text)', 'n-correct': 'var(--correct)', 'n-error': 'var(--error)', 'n-error-hollow': 'var(--error)' };

/** The notehead plus verdict lane of each state, side by side, for the grayscale distinctness check (04 13.1 item 4). */
function VerdictGallery() {
  return (
    <section aria-labelledby="dev-verdicts" className="app-dev-verdicts">
      <h2 id="dev-verdicts">{GALLERY_TITLE}</h2>
      <div className="app-dev-row">
        {VERDICT_STATES.map(({ id, state }) => {
          const v = noteVisual(state, 'review', false);
          const hollow = v.noteClass === 'n-error-hollow';
          return (
            <div key={id} className="app-dev-verdict" data-testid={`verdict-${id}`} data-note-class={v.noteClass} style={{ color: NOTE_COLOUR[v.noteClass] ?? 'inherit' }}>
              <svg width="16" height="10" viewBox="0 3 28 14" aria-hidden="true" focusable="false">
                <ellipse cx="14" cy="10" rx="9" ry="6.5" transform="rotate(-20 14 10)" fill={hollow ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth={hollow ? 1.8 : 0} />
              </svg>
              <span className="app-dev-lane">
                {v.laneGlyphs.map((g) => (
                  <VerdictGlyph key={g} id={g} size={14} />
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** `#/dev/components`: one trigger per primitive, so each can be seen and driven by hand and by Playwright. */
export function DevComponentsScreen() {
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [rightSheet, setRightSheet] = useState(false);
  const [popover, setPopover] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const toast = useToast();
  return (
    <section data-testid="screen-dev-components">
      <h1>{copy('shortcuts.title')}</h1>
      <div className="app-dev-row">
        <button type="button" onClick={() => setModal(true)}>
          {copy('dialog.skip.title')}
        </button>
        <button type="button" onClick={() => setSheet(true)}>
          {copy('action.moveUp')}
        </button>
        <button type="button" onClick={() => setRightSheet(true)}>
          {copy('action.filter')}
        </button>
        <button type="button" ref={setAnchor} onClick={() => setPopover((v) => !v)} aria-expanded={popover}>
          {copy('action.hearTempo')}
        </button>
        <button
          type="button"
          onClick={() => toast.show({ text: copy('toast.saved'), action: { label: copy('action.undo'), onAction: () => undefined } })}
        >
          {copy('toast.saved')}
        </button>
      </div>
      <Modal open={modal} title={copy('dialog.skip.title')} onClose={() => setModal(false)}>
        <p>{copy('dialog.skip.practiceNotice', { n: 5 })}</p>
        <div className="app-dev-row">
          <button type="button" data-autofocus onClick={() => setModal(false)}>
            {copy('action.keepReading')}
          </button>
          <button type="button" onClick={() => setModal(false)}>
            {copy('action.skip')}
          </button>
        </div>
      </Modal>
      <Sheet open={sheet} title={copy('action.moveUp')} onClose={() => setSheet(false)}>
        <p>{copy('scan.cover')}</p>
      </Sheet>
      <Sheet open={rightSheet} side="right" title={copy('action.filter')} onClose={() => setRightSheet(false)}>
        <p>{copy('scan.cover')}</p>
      </Sheet>
      <Popover open={popover} anchor={anchor} label={copy('action.hearTempo')} onClose={() => setPopover(false)}>
        {copy('stars.tempo.prompt')}
      </Popover>
      <VerdictGallery />
    </section>
  );
}
