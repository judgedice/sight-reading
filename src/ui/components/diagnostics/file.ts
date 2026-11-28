// Small helpers for the diagnostics file: its size line and the browser's file sharing.
import { saveFile, type SaveOutcome } from '../../save-file.ts';

/** "64 KB": the UTF-8 size of the text in kilobytes, at least 1. */
export function sizeKb(text: string): number {
  return Math.max(1, Math.round(new TextEncoder().encode(text).length / 1024));
}

function asFile(name: string, text: string): File {
  return new File([text], name, { type: 'application/json' });
}

/** True where the browser can share this file (`navigator.canShare({ files })`). */
export function canShareFile(name: string, text: string): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return false;
  try {
    return navigator.canShare({ files: [asFile(name, text)] });
  } catch {
    return false;
  }
}

/** Opens the share sheet with the file. Resolves false when the player cancels or the browser refuses. */
export async function shareFile(name: string, text: string): Promise<boolean> {
  try {
    await navigator.share({ files: [asFile(name, text)] });
    return true;
  } catch {
    return false;
  }
}

/** The fallback when the app gives no download helper: the save seam (a link click on a Blob URL on the web). */
export function downloadText(name: string, text: string): Promise<SaveOutcome> {
  return saveFile(name, text, 'application/json');
}
