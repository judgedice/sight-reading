/**
 * Diagnostics (02 §4.6), computed and never weighted: stops, restarts, drift. The grader has no clock anchor in its
 * input, so the take's input-to-score offset is recovered from notes that carry both a detected onset and a score
 * time (matched judgments: expected onset + timing error; extras: their `onsetSec`).
 */
import type { DetectedNote, ExpectedNote, FinalAlignment, GradeInput, RestartDiagnostic, StopDiagnostic } from '../core/types.ts';

const MS_PER_SEC = 1000;
const SEC_PER_MIN = 60;
const MIN_DRIFT_POINTS = 3;

export interface Diagnostics {
  stops: StopDiagnostic[];
  restarts: RestartDiagnostic[];
  driftMsAtEnd: number | null;
}

/** Beats per bar in metronome beats, recovered from the notes, else from the meter. */
function beatsPerBarOf(expected: readonly ExpectedNote[], fallback: number): number {
  for (const e of expected) if (e.bar >= 2) return (e.onsetBeat - (e.beatInBar - 1)) / (e.bar - 1);
  return fallback;
}

/** Input seconds minus score seconds: t0 plus the latency compensation. Mean over every note that pins it. */
function clockOffset(expected: readonly ExpectedNote[], a: FinalAlignment, byId: Map<number, DetectedNote>): number | null {
  let sum = 0;
  let count = 0;
  for (const j of a.judgments) {
    const e = expected[j.expectedIdx];
    const d = j.detectedId === null ? undefined : byId.get(j.detectedId);
    if (j.status === 'matched' && e && d && j.timingErrorMs !== null) {
      sum += d.onset - (e.onsetSec + j.timingErrorMs / MS_PER_SEC);
      count++;
    }
  }
  if (count === 0) {
    for (const x of a.extras) {
      const d = byId.get(x.detectedId);
      if (d) {
        sum += d.onset - x.onsetSec;
        count++;
      }
    }
  }
  return count === 0 ? null : sum / count;
}

function barAt(expected: readonly ExpectedNote[], beat: number, beatsPerBar: number): number {
  const ref = expected[0];
  if (!ref) return 1;
  const barStart = ref.onsetBeat - (ref.beatInBar - 1);
  return ref.bar + Math.floor((beat - barStart) / beatsPerBar + 1e-9);
}

export function computeDiagnostics(input: GradeInput): Diagnostics {
  const { expected, alignment: a, detected, cfg, bpm } = input;
  const beatsPerBar = beatsPerBarOf(expected, input.meter.countsPerBar);
  const beatSec = SEC_PER_MIN / bpm;
  const byId = new Map(detected.map((d) => [d.id, d] as const));

  const restarts: RestartDiagnostic[] = a.displaced.map((d) => ({
    bar: expected[d.fromIdx]?.bar ?? 1,
    notesReplayed: d.detectedIds.length,
    offsetBeats: d.offsetBeats,
  }));

  // Drift: least-squares slope of timing error against bar position, times the number of bars.
  const pts: [number, number][] = [];
  for (const j of a.judgments) {
    const e = expected[j.expectedIdx];
    if (j.status === 'matched' && e && j.timingErrorMs !== null) pts.push([e.onsetBeat / beatsPerBar, j.timingErrorMs]);
  }
  let driftMsAtEnd: number | null = null;
  if (pts.length >= MIN_DRIFT_POINTS) {
    const mx = pts.reduce((t, p) => t + p[0], 0) / pts.length;
    const my = pts.reduce((t, p) => t + p[1], 0) / pts.length;
    const sxy = pts.reduce((t, p) => t + (p[0] - mx) * (p[1] - my), 0);
    const sxx = pts.reduce((t, p) => t + (p[0] - mx) ** 2, 0);
    const bars = Math.max(...expected.map((e) => e.bar));
    driftMsAtEnd = sxx > 0 ? (sxy / sxx) * bars : 0;
  }

  // Stops: silences (between sounded notes and from the last note to the end of take) at least max(1 beat, 600 ms)
  // after removing written rests, containing at least one missed note's onset.
  const stops: StopDiagnostic[] = [];
  const offset = clockOffset(expected, a, byId);
  const last = expected[expected.length - 1];
  if (offset !== null && last) {
    const s = cfg.grading.stops;
    const minSec = Math.max(s.minBeats * beatSec, s.minMs / MS_PER_SEC);
    const endSec = last.onsetSec + last.durSec + cfg.grading.endOfTake.afterLastNoteEndBeats * beatSec;
    const rests: [number, number][] = [];
    for (let i = 1; i < expected.length; i++) {
      const prev = expected[i - 1];
      const cur = expected[i];
      if (prev && cur && cur.precededByRest) rests.push([prev.onsetSec + prev.durSec, cur.onsetSec]);
    }
    const played = detected
      .map((d) => ({ on: d.onset - offset, off: (d.offset ?? d.onset + d.steadyMs / MS_PER_SEC) - offset }))
      .sort((x, y) => x.on - y.on);
    const gaps: [number, number][] = [];
    let cur = played[0]?.off ?? 0;
    for (const p of played.slice(1)) {
      if (p.on > cur) gaps.push([cur, p.on]);
      cur = Math.max(cur, p.off);
    }
    if (endSec > cur) gaps.push([cur, endSec]);
    const missedOnsets: number[] = [];
    for (const j of a.judgments) {
      const e = expected[j.expectedIdx];
      if (j.status === 'missed' && e) missedOnsets.push(e.onsetSec);
    }
    for (const [g0, g1] of gaps) {
      const covered = rests.reduce((acc, [r0, r1]) => acc + Math.max(0, Math.min(g1, r1) - Math.max(g0, r0)), 0);
      const len = g1 - g0 - covered;
      if (len < minSec || !missedOnsets.some((t) => t >= g0 && t < g1)) continue;
      const startBeat = g0 / beatSec;
      stops.push({ bar: barAt(expected, startBeat, beatsPerBar), startBeat, beats: len / beatSec });
    }
  }
  return { stops, restarts, driftMsAtEnd };
}
