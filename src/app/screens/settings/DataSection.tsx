/** Settings > Data (04 section 5.11): export, import, delete all, storage used, offline music. */
import { useEffect, useRef, useState } from 'react';
import { copy } from '../../../ui/copy/copy.ts';
import { Banner, Card } from '../../../ui/components/containers/index.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { Modal, useToast } from '../../../ui/primitives/index.ts';
import { deleteAllData, downloadText, exportBackupText, importBackupText, importErrorText, backupFileName } from './data-io.ts';
import { DELETE_WORD, sizeParts } from './model.ts';
import { Row, Section } from './Section.tsx';
import { text } from './text.ts';
import { useSettingsServices } from './context.ts';

type Pending = { kind: 'import'; raw: string } | { kind: 'delete' } | null;

export function DataSection() {
  const s = useSettingsServices();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bytes, setBytes] = useState<number | null | undefined>(undefined);
  const [offlineBusy, setOfflineBusy] = useState(false);

  useEffect(() => {
    let live = true;
    s.storageUsed?.().then(
      (n) => live && setBytes(n),
      () => live && setBytes(null),
    );
    return () => {
      live = false;
    };
  }, [s]);

  const closePending = (): void => {
    setPending(null);
    setTyped('');
  };

  const exportData = async (): Promise<void> => {
    setError(null);
    try {
      const body = await exportBackupText(s.repos, s.kv);
      downloadText(backupFileName(s.localDay()), body);
      toast.show({ text: copy('toast.saved') });
    } catch {
      setError(text('settings.data.exportFailed'));
    }
  };

  const chooseFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setError(null);
    setPending({ kind: 'import', raw: await file.text() });
  };

  const confirmImport = async (raw: string): Promise<void> => {
    closePending();
    try {
      await importBackupText(s.repos, s.kv, raw);
      await s.onDataReplaced();
      toast.show({ text: copy('toast.saved') });
    } catch (e) {
      setError(importErrorText(e));
    }
  };

  const confirmDelete = async (): Promise<void> => {
    closePending();
    try {
      await deleteAllData(s.repos, s.kv);
      await s.onDataReplaced();
      toast.show({ text: text('settings.data.deleted') });
    } catch {
      setError(text('settings.data.deleteFailed'));
    }
  };

  const downloadMusic = async (): Promise<void> => {
    if (!s.downloadMusic) return;
    setOfflineBusy(true);
    setError(null);
    try {
      await s.downloadMusic();
      toast.show({ text: copy('toast.saved') });
    } catch {
      setError(text('settings.data.offlineFailed'));
    } finally {
      setOfflineBusy(false);
    }
  };

  const sizeLabel =
    bytes === undefined || bytes === null ? null : (() => {
      const p = sizeParts(bytes);
      return text(p.unit === 'mb' ? 'settings.data.size.mb' : 'settings.data.size.kb', { n: p.n });
    })();

  return (
    <Section id="data" title={copy('settings.section.data')}>
      {error ? <Banner tone="danger" text={error} /> : null}

      <Row label={copy('settings.data.export')}>
        <Button label={copy('settings.data.export')} variant="secondary" icon="download" onClick={() => void exportData()} />
      </Row>

      <Row label={copy('settings.data.import')}>
        <div className="set-actions">
          <Button label={copy('action.importBackup')} variant="secondary" icon="upload" onClick={() => fileInput.current?.click()} />
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="ui-visually-hidden"
            aria-label={copy('action.importBackup')}
            data-testid="import-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void chooseFile(file);
            }}
          />
        </div>
      </Row>

      {sizeLabel !== null ? (
        <Row label={copy('settings.data.storageUsed')}>
          <span>{sizeLabel}</span>
        </Row>
      ) : null}

      {s.downloadMusic ? (
        <Row label={text('settings.data.offline')}>
          <Button label={copy('action.downloadMusic')} variant="secondary" loading={offlineBusy} onClick={() => void downloadMusic()} />
        </Row>
      ) : null}

      <Row label={copy('settings.data.delete')}>
        <Button label={copy('settings.data.delete')} variant="danger" icon="trash" onClick={() => setPending({ kind: 'delete' })} />
      </Row>

      <Modal
        open={pending?.kind === 'import'}
        title={text('settings.data.importTitle')}
        onClose={closePending}
      >
        <Card>
          <p>{text('settings.data.importBody')}</p>
          <div className="set-actions">
            <Button label={text('action.cancel')} variant="secondary" onClick={closePending} />
            <Button
              label={copy('action.importBackup')}
              variant="primary"
              onClick={() => {
                if (pending?.kind === 'import') void confirmImport(pending.raw);
              }}
            />
          </div>
        </Card>
      </Modal>

      <Modal open={pending?.kind === 'delete'} title={text('settings.data.deleteTitle')} onClose={closePending}>
        <Card>
          <p>{text('settings.data.deleteBody')}</p>
          <label htmlFor="set-delete-confirm" className="set-label">
            {text('settings.data.deleteHint')}
          </label>
          <input
            id="set-delete-confirm"
            className="set-text"
            type="text"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <div className="set-actions">
            <Button label={text('action.cancel')} variant="secondary" onClick={closePending} />
            <Button
              label={text('settings.data.deleteConfirm')}
              variant="danger"
              disabled={typed !== DELETE_WORD}
              onClick={() => void confirmDelete()}
            />
          </div>
        </Card>
      </Modal>
    </Section>
  );
}
