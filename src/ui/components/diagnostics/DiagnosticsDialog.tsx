import { useEffect, useState } from 'react';
import { copy } from '../../copy/copy.ts';
import { Modal } from '../../primitives/Modal.tsx';
import { Sheet } from '../../primitives/Sheet.tsx';
import { Button } from '../form/Button.tsx';
import { Toggle } from '../form/Toggle.tsx';
import { PHONE_QUERY, useMediaQuery } from '../sounds/media.ts';
import type { SaveOutcome } from '../../../core/save-file.ts';
import { canShareFile, downloadText, shareFile, sizeKb } from './file.ts';
import type { DiagnosticsButtonServices, DiagnosticsExportView } from './types.ts';
import './diagnostics.css';

export interface DiagnosticsDialogProps {
  open: boolean;
  onClose: () => void;
  services: DiagnosticsButtonServices;
  /** The try to export; omitted: the last try. */
  tryId?: string | undefined;
  /** Force the layout (the story pages); by default a sheet on a phone. */
  layout?: 'auto' | 'dialog' | 'sheet';
}

/** The title is "Save diagnostics" until a support address is configured, then "Send diagnostics" (05 D3). */
export function diagnosticsTitle(services: Pick<DiagnosticsButtonServices, 'supportAddress'>): string {
  return services.supportAddress ? copy('diagnostics.title.send') : copy('diagnostics.title');
}

type Loaded = { state: 'loading' } | { state: 'ready'; file: DiagnosticsExportView } | { state: 'none' };

/**
 * The diagnostics dialog (04-design section 8), a sheet on phone: what is in the file, the sound opt-in only when
 * shown, the file name and size, the pointer to Settings > Data, and Cancel, Share (where the browser can share
 * files) and Save file. With no address there is no send line.
 */
export function DiagnosticsDialog({ open, onClose, services, tryId, layout = 'auto' }: DiagnosticsDialogProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const asSheet = layout === 'sheet' || (layout === 'auto' && phone);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [includeAudio, setIncludeAudio] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setLoaded({ state: 'loading' });
    setSaved(null);
    void (async () => {
      const file = await (tryId !== undefined ? services.exportTry(tryId) : services.exportLast()).catch(() => null);
      const settings = await services.settings().catch(() => ({ includeAudio: false }));
      if (!live) return;
      setIncludeAudio(settings.includeAudio);
      setLoaded(file ? { state: 'ready', file } : { state: 'none' });
    })();
    return () => {
      live = false;
    };
  }, [open, services, tryId]);

  const file = loaded.state === 'ready' ? loaded.file : null;
  const hasSound = file ? file.file.tries.some((t) => t.audio !== undefined && t.audio !== null) : false;
  const title = diagnosticsTitle(services);

  const save = (): void => {
    if (!file) return;
    const done = (outcome: SaveOutcome | void): void => setSaved(outcome === 'cancelled' ? null : copy('diagnostics.saved', { file: file.fileName }));
    const sent = (services.download ?? downloadText)(file.fileName, file.text);
    // A download helper that answers at once (the web's link click) is shown at once; the native shell answers once the player has chosen or the save has failed.
    if (sent instanceof Promise) sent.then(done, () => setSaved(copy('settings.data.exportFailed')));
    else done();
  };
  const share = (): void => {
    if (!file) return;
    void shareFile(file.fileName, file.text);
  };
  const setAudio = (on: boolean): void => {
    setIncludeAudio(on);
    void services.setSettings({ includeAudio: on });
  };

  const actions = (
    <>
      <Button variant="quiet" label={copy('action.cancel')} onClick={onClose} />
      {file && canShareFile(file.fileName, file.text) ? <Button variant="secondary" label={copy('diagnostics.share')} onClick={share} /> : null}
      <Button variant="primary" label={copy('diagnostics.save')} disabled={!file} onClick={save} />
    </>
  );

  const body = (
    <div className="dg-dialog" data-testid="diagnostics-dialog">
      <p className="dg-body">{copy('diagnostics.body')}</p>
      <ul className="dg-items">
        <li>{copy('diagnostics.item.notes')}</li>
        <li>{copy('diagnostics.item.marks')}</li>
        <li>{copy('diagnostics.item.setup')}</li>
      </ul>
      {services.supportAddress ? <p className="dg-send">{copy('diagnostics.sendTo', { address: services.supportAddress })}</p> : null}
      {services.soundOptInShown ? (
        <div className="dg-optin">
          <Toggle checked={includeAudio} label={copy('diagnostics.keepSound')} onChange={setAudio} />
          {!includeAudio ? <p className="dg-small">{copy('diagnostics.keepSound.hint')}</p> : null}
          {file && !hasSound ? <p className="dg-small">{copy('diagnostics.noSound')}</p> : null}
        </div>
      ) : null}
      {file ? (
        <p className="dg-file" data-testid="diagnostics-file">
          {`${file.fileName} · ${copy('settings.data.size.kb', { n: sizeKb(file.text) })}`}
        </p>
      ) : null}
      <p className="dg-small">{copy('diagnostics.recentPointer')}</p>
      <p className="dg-saved" role="status">
        {saved}
      </p>
      {asSheet ? <div className="dg-actions">{actions}</div> : null}
    </div>
  );

  if (asSheet) {
    return (
      <Sheet open={open} title={title} onClose={onClose}>
        {body}
      </Sheet>
    );
  }
  return (
    <Modal open={open} title={title} onClose={onClose} size="confirm" footer={actions}>
      {body}
    </Modal>
  );
}
