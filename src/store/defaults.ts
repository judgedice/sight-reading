import type { AppSettings } from '../core/types.ts';

/** Settings for a first run (04 sections 5.2 and 5.11 defaults). A fresh object on every call. */
export function defaultAppSettings(): AppSettings {
  return {
    schemaVersion: 1,
    practice: {
      instrumentId: 'flute',
      level: 1,
      writtenKey: 'random',
      meter: 'random',
      bpm: 'random',
      bars: 'random',
      mode: 'ranked',
      listening: true,
      metronome: 'audible',
      clickTimbre: 'classic',
      accentFirstBeat: true,
      outputMode: 'speakers',
      a4Hz: 440,
      autoReference: true,
    },
    audio: { inputDeviceId: null, metronomeVolume: 70 },
    display: { theme: 'system', liveFeedback: 'full', showCentsMs: true, ghostsLive: 'from4', showHeard: false },
    practicePrefs: { showStars: true, showTips: true, showBeta: false },
    accessibility: { reduceMotion: 'system', highContrast: false, keyboardShortcuts: true, announceResults: true },
    onboardingDone: false,
    shown: { installCoach: false, autoLockHint: false },
  };
}
