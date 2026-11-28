/**
 * Types of the save seam ("save this text or these bytes as a file named X"). The implementation is
 * `src/ui/save-file.ts` (a browser link, or the native saver installed by the composition root); the native shell's
 * saver (`src/platform/native/files.ts`) takes its types from here.
 */

/** `saved`: the file is written. `cancelled`: the player closed the save dialog; nothing was written and nothing failed. */
export type SaveOutcome = 'saved' | 'cancelled';

/** A platform's way to save a file. Rejects when the file could not be saved. */
export type FileSaver = (name: string, data: string | Uint8Array, mime: string) => Promise<SaveOutcome>;
