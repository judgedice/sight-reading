/**
 * Diagnostics for a try (round 2, 01-ux §16): what the results, history, states and settings screens need to save
 * or send the file `PracticeSession` builds. The composition root fills it; the screens never reach the session.
 */
import type { SaveOutcome } from '../../../core/save-file.ts';
import type { DiagnosticsFile, DiagnosticsSettings } from '../../../session/index.ts';

/** One export: the file name, its JSON text and the parsed file. */
export interface DiagnosticsExport {
  fileName: string;
  text: string;
  file: DiagnosticsFile;
}

export interface DiagnosticsServices {
  /** Where the player can send the file (`VITE_SUPPORT_EMAIL`), or null: the button then reads "Save diagnostics". */
  supportAddress: string | null;
  /** Show the "include a short recording" opt-in. True in every build (PLAN ruling 64). */
  soundOptInShown: boolean;
  /** One try's file, or null when its trace is no longer kept. */
  exportTry(attemptId: string): Promise<DiagnosticsExport | null>;
  /** The last try's file, or null before the first. */
  exportLast(): Promise<DiagnosticsExport | null>;
  /** Every stored trace in one file (Settings > Data), or null when none. */
  exportRecent(): Promise<DiagnosticsExport | null>;
  settings(): Promise<DiagnosticsSettings>;
  setSettings(s: DiagnosticsSettings): Promise<void>;
  /** Saves a file to the device (the app's download helper). A rejection means it was not saved; `cancelled` means the player closed the save dialog. */
  download?(fileName: string, text: string): void | Promise<SaveOutcome | void>;
}
