/** Pure helpers for the performance screen (04 section 5.4). */
import type { SessionState } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import type { SessionStatus } from '../../../session/index.ts';
import { beatUnit } from '../setup/model.ts';

/** 1-based beat in the bar for a score beat; null before the first beat (the pickup lead-in counts back from the bar end). */
export function beatInBar(scoreBeat: number, beatsPerBar: number): number {
  const m = ((scoreBeat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  return Math.min(beatsPerBar, Math.floor(m + 1e-9) + 1);
}

/** Count-in click k (1-based) as a beat of the count-in bar. */
export const countInBeat = (k: number, beatsPerBar: number): number => ((k - 1) % beatsPerBar) + 1;

/** Beat grouping of the dots (04 section 5.4.3): 5/8 and 7/8 by beaming. */
export function beatGrouping(beats: number, beatType: number, countsPerBar: number): number[] | undefined {
  if (beatType !== 8 || countsPerBar !== beats) return undefined;
  if (beats === 5) return [3, 2];
  if (beats === 7) return [2, 2, 3];
  return undefined;
}

/** What the status line or toolbar centre says, highest priority first (04 section 5.4.1). */
export function statusMessage(a: { state: SessionState; status: SessionStatus | null; bar: number | null; totalBars: number }): string {
  const s = a.status;
  if (s?.kind === 'no-signal') return copy('play.status.noSignal');
  if (s?.kind === 'lost-place') return copy('play.status.lostPlace');
  if (s?.kind === 'come-in-at') return copy('play.status.comeIn', { n: s.bar });
  if (s?.kind === 'restarting-count-in') return copy('play.status.restartCountIn');
  if (a.state === 'count-in') return copy('play.status.countIn');
  return copy('play.status.bar', { n: Math.max(1, a.bar ?? 1), total: a.totalBars });
}

/** Toolbar centre text when nothing needs saying: "Bar 4 · ♩ = 92". */
export function barTempoText(bar: number | null, meter: string, bpm: number): string {
  return copy('play.status.barTempo', { n: Math.max(1, bar ?? 1), unit: beatUnit(meter), bpm });
}

export type StopVariant = 'practice' | 'ranked-before-note' | 'ranked-after-note';

/** Which stop confirm applies (04 section 5.10). */
export function stopVariant(mode: 'ranked' | 'practice', listening: boolean, firstNoteHeard: boolean): StopVariant {
  if (mode === 'practice') return 'practice';
  return listening && !firstNoteHeard ? 'ranked-before-note' : 'ranked-after-note';
}

/** Bars in the strip's input meter (06 section 6.13). */
export const MIC_BARS = 7;

/** Bars lit for a level: 0 below the floor, all of them at 0 dB. A leaf re-renders only when this changes. */
export const meterBars = (levelDb: number, minDb = -60): number =>
  Number.isFinite(levelDb) ? Math.ceil(Math.min(1, Math.max(0, (levelDb - minDb) / -minDb)) * MIC_BARS - 1e-9) || 0 : 0;

/** What the strip's centre says while a voice take plays its starting pitch before the count-in. */
export type PitchStep = 'pending' | 'live' | 'done';

/** The two steps of the "Your starting pitch" band from the live caption kind (06 section 6.12). */
export function pitchSteps(caption: 'key-chord' | 'first-note' | null): { chord: PitchStep; note: PitchStep } {
  if (caption === 'key-chord') return { chord: 'live', note: 'pending' };
  if (caption === 'first-note') return { chord: 'done', note: 'live' };
  return { chord: 'pending', note: 'pending' };
}
