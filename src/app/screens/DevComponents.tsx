import { useState } from 'react';
import { copy } from '../../ui/copy/copy.ts';
import { Modal, Popover, Sheet, useToast } from '../../ui/primitives/index.ts';

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
    </section>
  );
}
