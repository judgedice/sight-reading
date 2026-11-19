/**
 * Settings reader normaliser (08 decision 4, 06 section 9.5). The player's metronome sound is only ever Classic,
 * Woodblock or Beep; settings stored before the redesign hold the legacy names, which read as their successors:
 * `tick` as `classic`, `wood` as `woodblock`. Anything else (absent, unknown) reads as the default, Classic.
 * Pure: returns a new object when something changed, the same object otherwise. Stored data is not rewritten here.
 */
import { metronomeSoundOf } from '../core/click-sounds.ts';
import type { AppSettings, MetronomeSound } from '../core/types.ts';

/** The stored sound as the player's sound: `tick` reads as `classic`, `wood` as `woodblock`, default `classic`. */
export function readMetronomeSound(stored: unknown): MetronomeSound {
  return metronomeSoundOf(typeof stored === 'string' ? stored : null);
}

/** Settings as read: `practice.clickTimbre` mapped to a player's sound. */
export function normaliseSettings(s: AppSettings): AppSettings {
  const sound = readMetronomeSound(s.practice.clickTimbre);
  if (s.practice.clickTimbre === sound) return s;
  return { ...s, practice: { ...s.practice, clickTimbre: sound } };
}
