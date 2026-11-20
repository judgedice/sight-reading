/**
 * Settings reader normaliser (08 decision 4, 06 section 9.5). The player's metronome sound is only ever Classic,
 * Woodblock or Beep; settings stored before the redesign hold the legacy names, which read as their successors:
 * `tick` as `classic`, `wood` as `woodblock`. Anything else (absent, unknown) reads as the default, Classic.
 * Pure: returns a new object when something changed, the same object otherwise. Stored data is not rewritten here.
 */
import { metronomeSoundOf } from '../core/click-sounds.ts';
import { defaultAppSettings } from './defaults.ts';
import type { AppSettings, MetronomeSound } from '../core/types.ts';

/** The stored sound as the player's sound: `tick` reads as `classic`, `wood` as `woodblock`, default `classic`. */
export function readMetronomeSound(stored: unknown): MetronomeSound {
  return metronomeSoundOf(typeof stored === 'string' ? stored : null);
}

/**
 * Settings as read: `practice.clickTimbre` mapped to a player's sound, and the round-2 settings
 * (`practice.autoReference`, `display.ghostsLive`, `display.showHeard`, `display.beatLine`) filled with their defaults when a
 * stored record predates them. Returns the same object when nothing changed.
 */
export function normaliseSettings(s: AppSettings): AppSettings {
  const sound = readMetronomeSound(s.practice.clickTimbre);
  const d = defaultAppSettings();
  const g = s.display.ghostsLive;
  const ghostsLive = g === 'from4' || g === 'always' || g === 'never' ? g : d.display.ghostsLive;
  const showHeard = typeof s.display.showHeard === 'boolean' ? s.display.showHeard : d.display.showHeard;
  const beatLine = typeof s.display.beatLine === 'boolean' ? s.display.beatLine : d.display.beatLine;
  const autoReference = typeof s.practice.autoReference === 'boolean' ? s.practice.autoReference : d.practice.autoReference;
  if (
    s.practice.clickTimbre === sound &&
    s.practice.autoReference === autoReference &&
    s.display.ghostsLive === ghostsLive &&
    s.display.showHeard === showHeard &&
    s.display.beatLine === beatLine
  ) {
    return s;
  }
  return {
    ...s,
    practice: { ...s.practice, clickTimbre: sound, ...(autoReference === undefined ? {} : { autoReference }) },
    display: {
      ...s.display,
      ...(ghostsLive === undefined ? {} : { ghostsLive }),
      ...(showHeard === undefined ? {} : { showHeard }),
      ...(beatLine === undefined ? {} : { beatLine }),
    },
  };
}
