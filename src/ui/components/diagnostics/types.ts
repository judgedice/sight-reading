/**
 * What the diagnostics button needs from the app. The part of `DiagnosticsServices`
 * (`src/app/screens/states/services.ts`) it uses, so the screens pass their `services.diagnostics` unchanged. The UI
 * layer may not import the app layer, hence the structural copy.
 */
export interface DiagnosticsExportView {
  fileName: string;
  text: string;
  /** The file; the dialog reads only whether the try kept sound. */
  file: { tries: readonly { audio?: unknown }[] };
}

export interface DiagnosticsButtonServices {
  /** Where the player can send the file, or null: the button and title then read "Save diagnostics". */
  supportAddress: string | null;
  /** Show the sound opt-in switch. */
  soundOptInShown: boolean;
  exportTry(attemptId: string): Promise<DiagnosticsExportView | null>;
  exportLast(): Promise<DiagnosticsExportView | null>;
  settings(): Promise<{ includeAudio: boolean }>;
  setSettings(s: { includeAudio: boolean }): Promise<void>;
  /** Saves a file to the device. */
  download?(fileName: string, text: string): void;
}
