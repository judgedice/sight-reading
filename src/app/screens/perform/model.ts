/** Pure helpers for the performance screen (04 section 5.4). */
import type { FollowerEvent, PreparedExcerpt, SessionState } from '../../../core/types.ts';
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

/** The starting-pitch card's two steps, and whether the beat before the first click says "Count-in next" (01-ux §10). */
export function referenceSteps(caption: 'key-chord' | 'first-note' | 'count-in-next' | null, heard: boolean): { chord: PitchStep; note: PitchStep; next: boolean } {
  if (caption === 'count-in-next' || (caption === null && heard)) return { chord: 'done', note: 'done', next: true };
  return { ...pitchSteps(caption), next: false };
}

/** Where the count-in is (01-ux §11): click k (1-based; 0 before the first) of `bars` bars of `beatsPerBar`. */
export interface CountInPosition {
  /** Count-in bar, 1-based (1 before the first click). */
  bar: number;
  bars: number;
  /** Beat in that bar, 1-based; 0 before the first click. */
  beat: number;
  /** The bar after which the music starts. */
  last: boolean;
}

export function countInPosition(click: number, beatsPerBar: number, bars: number): CountInPosition {
  const n = Math.max(1, bars);
  const bpb = Math.max(1, beatsPerBar);
  const k = Math.max(0, Math.min(click, n * bpb));
  const bar = k === 0 ? 1 : Math.ceil(k / bpb);
  return { bar, bars: n, beat: k === 0 ? 0 : countInBeat(k, bpb), last: bar === n };
}

/**
 * The count after which the player comes in, in the last count-in bar: the bar's last count, or earlier when the
 * first note is in a pickup (a 1-count pickup in 4/4 comes in after 3). The try starts at that note.
 */
export function entryCount(p: Pick<PreparedExcerpt, 'measures' | 'pickupTicks' | 'meter'>): number {
  const bpb = Math.max(1, p.meter.countsPerBar);
  const first = p.measures.flatMap((m) => m.events).find((e) => e.kind === 'note');
  if (!first || p.pickupTicks <= 0 || p.meter.countUnitTicks <= 0) return bpb;
  const beat = (first.tick - p.pickupTicks) / p.meter.countUnitTicks;
  return beat >= 0 ? bpb : Math.max(1, Math.min(bpb, Math.floor(bpb + beat + 1e-9)));
}

/** The count-in line: grey "Count-in: listen to the beat", then brass "Come in after 4" in the last bar. */
export function countInTitle(pos: CountInPosition, entry: number): string {
  return pos.last ? copy('countIn.last', { beats: entry }) : copy('countIn.listen');
}

/** "Count-in bar 1 of 2". The tempo follows it. */
export const countInBarText = (pos: CountInPosition): string => copy('countIn.barOf', { n: pos.bar, total: pos.bars });

/**
 * Whether ghost notes and extras draw during the try (PLAN R61; 01-ux §15.1): `from4` shows them above the calm
 * difficulties (1 to `calmUpTo`), `always` and `never` as named.
 */
export function ghostsLiveAt(setting: 'from4' | 'always' | 'never' | undefined, level: number, calmUpTo: number): boolean {
  if (setting === 'always') return true;
  if (setting === 'never') return false;
  return level > calmUpTo;
}

/** What may reach the overlay live (01-ux §10, §15.1). */
export interface LiveFilter {
  /** Ghost notes and extras draw live. */
  ghosts: boolean;
  /** A calm difficulty: a note is marked only when the follower is sure (no provisional judgment). */
  calm: boolean;
  /** Before bar 1 beat 1: only the brass marks of the starting pitch and the count-in, no ghost of any kind. */
  beforeMusic: boolean;
}

/** True when a follower event may change the overlay under the filter. Clock and level always pass. */
export function liveEventAllowed(ev: FollowerEvent, f: LiveFilter): boolean {
  if (ev.type === 'ghost') return f.ghosts && !f.beforeMusic;
  if (ev.type === 'judgment') return !(f.calm && ev.judgment.provisional);
  return true;
}
