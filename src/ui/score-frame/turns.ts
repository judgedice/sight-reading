// Pure page-turn timing for the score frame (04 §4.3). The plan comes from layout-table.ts `planSwaps`; this file
// turns its "enter system s, wait delayMs" triggers into score beats, so the slot assignment is a pure function of
// the playhead beat. The playhead follows 01's audible clock, so turns land on the music, not on a wall-clock timer.

import type { Beats, PreparedExcerpt } from '../../core/types.ts';
import type { PagePlan } from '../layout-table.ts';

/** Where each system starts and how long it lasts, in score beats (bar 1 beat 1 = 0; a pickup is negative). */
export interface SystemSpan {
  startBeat: Beats;
  beats: Beats;
}

/** Spans of the systems drawn with `barsPerSystem` (the pickup measure counts as one bar, as in notation). */
export function systemSpans(p: PreparedExcerpt, barsPerSystem: readonly number[]): SystemSpan[] {
  const unit = p.meter.countUnitTicks;
  const fullBar = p.meter.countsPerBar * unit;
  const ms = p.measures;
  const measureEnd = (i: number): number => (i + 1 < ms.length ? ms[i + 1]!.startTick : ms[i]!.startTick + (ms[i]!.isPickup ? p.pickupTicks : fullBar));
  const out: SystemSpan[] = [];
  let first = 0;
  for (const n of barsPerSystem) {
    const last = Math.min(ms.length, first + n) - 1;
    if (last < first) break;
    const startTick = ms[first]!.startTick;
    out.push({ startBeat: (startTick - p.pickupTicks) / unit, beats: (measureEnd(last) - startTick) / unit });
    first = last + 1;
  }
  return out;
}

/** Milliseconds per metronome beat at `bpm`. */
export function beatMs(bpm: number): number {
  if (!(bpm > 0) || !Number.isFinite(bpm)) throw new RangeError(`bpm must be positive, got ${bpm}`);
  return 60000 / bpm;
}

/** `systemDurationsMs` for `planSwaps`. */
export function systemDurationsMs(spans: readonly SystemSpan[], bpm: number): number[] {
  const m = beatMs(bpm);
  return spans.map((s) => s.beats * m);
}

/** One planned swap with the score beat at which it is due. */
export interface TimedSwap {
  slot: number;
  newSystem: number;
  dueBeat: Beats;
}

/** Each swap's due beat: the start of its trigger system plus `delayMs` at the take tempo. Order is kept. */
export function timeSwaps(plan: PagePlan, spans: readonly SystemSpan[], bpm: number): TimedSwap[] {
  const m = beatMs(bpm);
  return plan.swaps.map((s) => ({
    slot: s.slot,
    newSystem: s.newSystem,
    dueBeat: (spans[s.trigger.system]?.startBeat ?? 0) + s.trigger.delayMs / m,
  }));
}

/**
 * Systems in the slots when the playhead is at `beat` (null: before the take, the initial slots). Swaps are applied
 * in plan order, so the result equals the 4.3 algorithm for a playhead that moved forward to `beat`.
 */
export function slotsAtBeat(plan: PagePlan, swaps: readonly TimedSwap[], beat: Beats | null): number[] {
  const state = plan.initialSlots.slice();
  if (beat === null) return state;
  for (const s of swaps) {
    if (s.dueBeat > beat + 1e-9) break;
    state[s.slot] = s.newSystem;
  }
  return state;
}

/** The system the beat falls in (clamped to the first and last system). */
export function systemAtBeat(spans: readonly SystemSpan[], beat: Beats): number {
  let s = 0;
  for (let i = 1; i < spans.length; i++) if (beat >= spans[i]!.startBeat - 1e-9) s = i;
  return s;
}

/**
 * The slot that gets the 3 px wrap bar (4.3 rule 5): the slot holding the system after `current`, when that slot
 * is not directly below the current system's slot. Null when the next system is below, not shown, or absent.
 */
export function wrapSlot(slotSystems: readonly number[], current: number): number | null {
  const cur = slotSystems.indexOf(current);
  const nxt = slotSystems.indexOf(current + 1);
  if (cur < 0 || nxt < 0 || nxt === cur + 1) return null;
  return nxt;
}

/** 04 §4.4: one uniform scale for a frozen frame, `min(newW / oldW, newH / oldH)`. */
export function frozenScale(frozen: { width: number; height: number }, now: { width: number; height: number }): number {
  if (!(frozen.width > 0) || !(frozen.height > 0)) return 1;
  const s = Math.min(now.width / frozen.width, now.height / frozen.height);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/** True when a resize flipped portrait and landscape (a rotation; 04 §4.4 cancels a count-in on it). */
export function orientationChanged(a: { width: number; height: number }, b: { width: number; height: number }): boolean {
  return a.width > a.height !== b.width > b.height;
}
