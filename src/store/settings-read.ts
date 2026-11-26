/**
 * Settings reader normaliser (08 decision 4, 06 section 9.5). The player's metronome sound is only ever Classic,
 * Woodblock or Beep; settings stored before the redesign hold the legacy names, which read as their successors:
 * `tick` as `classic`, `wood` as `woodblock`. Anything else (absent, unknown) reads as the default, Classic.
 * Pure: returns a new object when something changed, the same object otherwise. Stored data is not rewritten here.
 */
import { metronomeSoundOf } from '../core/click-sounds.ts';
import { defaultAppSettings } from './defaults.ts';
import type { AppSettings, MetronomeSound } from '../core/types.ts';

/** Beat line timing limits, ms (PLAN R70). */
export const BEAT_LINE_OFFSET_MS = { min: -150, max: 150, step: 10 } as const;

/** A stored beat line timing as a valid one: a number clamped to the range and rounded to the step, else 0. */
export function readBeatLineOffset(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const { min, max, step } = BEAT_LINE_OFFSET_MS;
  return Math.min(max, Math.max(min, Math.round(v / step) * step)) || 0;
}

/** The stored sound as the player's sound: `tick` reads as `classic`, `wood` as `woodblock`, default `classic`. */
export function readMetronomeSound(stored: unknown): MetronomeSound {
  return metronomeSoundOf(typeof stored === 'string' ? stored : null);
}

/**
 * Settings as read: `practice.clickTimbre` mapped to a player's sound, and the round-2 settings
 * (`practice.autoReference`, `display.ghostsLive`, `display.showHeard`, `display.beatLine`, `display.beatLineOffsetMs`, `display.noteColours`) filled with their defaults when a
 * stored record predates them. `display.pitchSteadiness` stays absent unless it is a preset (absent: by instrument
 * family). Returns the same object when nothing changed.
 */
export function normaliseSettings(s: AppSettings): AppSettings {
  const sound = readMetronomeSound(s.practice.clickTimbre);
  const d = defaultAppSettings();
  const g = s.display.ghostsLive;
  const ghostsLive = g === 'from4' || g === 'always' || g === 'never' ? g : d.display.ghostsLive;
  const showHeard = typeof s.display.showHeard === 'boolean' ? s.display.showHeard : d.display.showHeard;
  const beatLine = typeof s.display.beatLine === 'boolean' ? s.display.beatLine : d.display.beatLine;
  const beatLineOffsetMs = readBeatLineOffset(s.display.beatLineOffsetMs);
  const noteColours = typeof s.display.noteColours === 'boolean' ? s.display.noteColours : d.display.noteColours;
  const autoReference = typeof s.practice.autoReference === 'boolean' ? s.practice.autoReference : d.practice.autoReference;
  // The Match a note needle (round 3): a preset, or absent (by instrument family). Anything else reads as absent.
  const ps = s.display.pitchSteadiness as unknown;
  const pitchSteadiness = ps === 'steady' || ps === 'balanced' || ps === 'quick' ? ps : undefined;
  if (
    s.practice.clickTimbre === sound &&
    s.practice.autoReference === autoReference &&
    s.display.ghostsLive === ghostsLive &&
    s.display.showHeard === showHeard &&
    s.display.beatLine === beatLine &&
    s.display.beatLineOffsetMs === beatLineOffsetMs &&
    s.display.noteColours === noteColours &&
    s.display.pitchSteadiness === pitchSteadiness
  ) {
    return s;
  }
  const { pitchSteadiness: _stored, ...display } = s.display;
  return {
    ...s,
    practice: { ...s.practice, clickTimbre: sound, ...(autoReference === undefined ? {} : { autoReference }) },
    display: {
      ...display,
      ...(ghostsLive === undefined ? {} : { ghostsLive }),
      ...(showHeard === undefined ? {} : { showHeard }),
      ...(beatLine === undefined ? {} : { beatLine }),
      beatLineOffsetMs,
      ...(noteColours === undefined ? {} : { noteColours }),
      ...(pitchSteadiness === undefined ? {} : { pitchSteadiness }),
    },
  };
}
