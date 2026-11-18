/**
 * Export, import and delete for Settings > Data (01 sections 5.9 and 11). Each function works on the store
 * repositories and the key-value store the composition root passes in.
 */
import type { KeyValue, StoreRepos } from '../../../core/platform.ts';
import { exportAll, importAll, NOT_A_BACKUP_MESSAGE, StoreImportError } from '../../../store/index.ts';
import { text } from './text.ts';

/** The export file name for a local day. */
export function backupFileName(localDay: string): string {
  return `sightread-backup-${localDay}.json`;
}

/** Serialises the whole store as the export file (format sightread-export). */
export async function exportBackupText(repos: StoreRepos, kv: KeyValue): Promise<string> {
  return JSON.stringify(await exportAll(repos, kv), null, 2);
}

/** Replaces the device's data with a backup. Throws StoreImportError for a file that is not a valid backup. */
export async function importBackupText(repos: StoreRepos, kv: KeyValue, raw: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new StoreImportError('not-a-backup', NOT_A_BACKUP_MESSAGE);
  }
  await importAll(repos, parsed, kv);
}

/** Deletes every take, the profile, the calibrations and the key-value entries (settings included). */
export async function deleteAllData(repos: StoreRepos, kv: KeyValue): Promise<void> {
  await repos.clearAll();
  for (const key of await kv.keys()) await kv.delete(key);
}

/** The message for an import failure (04 copy; the newer-version case is its own line). */
export function importErrorText(e: unknown): string {
  if (e instanceof StoreImportError) {
    return e.code === 'newer-version' ? text('settings.data.importNewer') : e.message;
  }
  return text('settings.data.importFailed');
}

/** Starts a browser download of text. A no-op outside a browser document. */
export function downloadText(name: string, body: string, type = 'application/json'): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
