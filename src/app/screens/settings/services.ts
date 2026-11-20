/**
 * The sound services Settings needs from the composition root (05 §11.2, designer's notes 14 and 15). `SettingsServices`
 * in `context.ts` belongs to the settings screen; the composition root passes these members with it
 * (`SettingsServices & SettingsSoundServices`) until that interface takes them in.
 */
import type { StoreApi } from 'zustand/vanilla';
import type { MetronomeSound } from '../../../core/types.ts';
import type { SoundView } from '../../../session/index.ts';
import type { CalStatus } from '../../compose/calibration-status.ts';
import type { Readable } from '../home/services.ts';
import type { DiagnosticsServices } from '../states/services.ts';

export interface SettingsSoundServices {
  /** "Play a bar of Classic": one bar of that sound at ♩ = 90, downbeat accented if on. Call from the click. */
  previewSound?(sound: MetronomeSound): Promise<void>;
  /** "Click volume" released: one click of the chosen sound at the new level. Call from the release. */
  playClick?(sound: MetronomeSound): Promise<void>;
  /** Stops the preview at once (Stop, leaving the screen). */
  stopSounds?(): void;
  /** What is sounding: the playing option shows "Stop" (`playing === 'preview'`, `caption.sound`). */
  sounds?: StoreApi<SoundView>;
}

/** Diagnostics and the calibration line for Settings (round 2): passed with `SettingsServices` as the sound members are. */
export interface SettingsDiagnosticsServices {
  diagnostics?: DiagnosticsServices;
  /** The shared calibration status for the Sound section's line. */
  calibrationStatus?: Readable<CalStatus>;
}
