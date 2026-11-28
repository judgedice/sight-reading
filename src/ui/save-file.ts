/**
 * The save seam: "save this text or these bytes as a file named X". Every export (the backup, the diagnostics file,
 * the calibration diagnostics) goes through `saveFile`.
 *
 * On the web, and in every test, it is a link to a Blob URL with a `download` name, as the export sites each did
 * before. The native shell installs a saver at start (`setNativeFileSaver`, called by the composition root with
 * `platform/native`'s saver) that asks the engine for a system save dialog, because a webview may ignore a download
 * link. This module imports nothing at run time, so the browser build never loads native code for it.
 */
import type { FileSaver, SaveOutcome } from '../core/save-file.ts';

export type { FileSaver, SaveOutcome };

let nativeSaver: FileSaver | null = null;

/** Installs (or, with `null`, removes) the native saver. Called once by the composition root inside the shell. */
export function setNativeFileSaver(saver: FileSaver | null): void {
  nativeSaver = saver;
}

/** The web saver: a click on a Blob URL link. A no-op outside a browser document. Everything up to the return runs synchronously, inside the caller's gesture. */
function saveWithLink(name: string, data: string | Uint8Array, mime: string): Promise<SaveOutcome> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return Promise.resolve('cancelled');
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return Promise.resolve('saved');
}

/** Saves `data` as a file named `name`. Rejects when the platform could not save it (the screens show their export failure). */
export function saveFile(name: string, data: string | Uint8Array, mime = 'application/json'): Promise<SaveOutcome> {
  return nativeSaver ? nativeSaver(name, data, mime) : saveWithLink(name, data, mime);
}
