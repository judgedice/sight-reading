// The beat line's path (PLAN R70, "Scale try experience"). The line goes straight from each note's head to the next
// note's head in the time between their onsets, across barlines, so it never stops short of a barline and jumps. A
// system's last note goes on to the end of that system's staff by the next system's first beat, and the line moves
// to the next system there (the one jump left, at a system break). Before the first note it waits at the first head;
// after the last anchor it holds. The engraving's spacing alone sets the speed between two heads: wider spacing
// across a barline is a faster beat, and nothing else changes speed.
// Pure arithmetic, so the steadiness is unit-tested (beat-line-path.test.ts).

/** One point the line passes: at score beat `beat` it is at `x` (px in system `system`'s SVG). */
export interface LineAnchor {
  beat: number;
  system: number;
  x: number;
}

/** Anchors in beat order, x non-decreasing within a system. */
export type LinePath = readonly LineAnchor[];

/**
 * The path from the note and rest heads (centre x of each event's head, by onset beat) and the end of each system
 * (its last beat and the x just before its closing barline). Heads that would make the line go back are dropped.
 */
export function buildLinePath(heads: readonly LineAnchor[], systemEnds: readonly LineAnchor[]): LinePath {
  const all = [...heads, ...systemEnds].sort((a, b) => a.beat - b.beat || a.system - b.system);
  const out: LineAnchor[] = [];
  for (const a of all) {
    if (!Number.isFinite(a.beat) || !Number.isFinite(a.x)) continue;
    const last = out[out.length - 1];
    if (last && a.system === last.system && a.beat <= last.beat) continue;
    if (last && a.system === last.system && a.x < last.x) continue;
    // A system's end anchor shares its beat with the next system's first head: keep both (the end closes the old
    // system, the head opens the new one).
    if (last && a.system !== last.system && a.beat < last.beat) continue;
    out.push({ ...a });
  }
  return out;
}

/** Where the line is at a score beat: its system and x. */
export function linePointAt(path: LinePath, beat: number): { system: number; x: number } | null {
  const n = path.length;
  if (n === 0) return null;
  const first = path[0]!;
  if (beat <= first.beat) return { system: first.system, x: first.x };
  // The last anchor at or before the beat (on a shared beat, the later one: the new system's head).
  let lo = 0;
  let hi = n - 1;
  if (beat >= path[hi]!.beat) lo = hi;
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (path[mid]!.beat <= beat) lo = mid;
      else hi = mid;
    }
  }
  const a = path[lo]!;
  const b = path[lo + 1];
  if (!b || b.system !== a.system || !(b.beat > a.beat)) return { system: a.system, x: a.x };
  const f = (beat - a.beat) / (b.beat - a.beat);
  return { system: a.system, x: a.x + f * (b.x - a.x) };
}

/** The line's speed in each whole beat from `from` to `to` (px per beat), for tests and tools. */
export function beatSpeeds(path: LinePath, from: number, to: number): number[] {
  const out: number[] = [];
  for (let b = from; b < to; b++) {
    const p = linePointAt(path, b);
    // Just before the next beat (a system break there moves the line away), scaled back to a whole beat.
    const eps = 1e-6;
    const q = linePointAt(path, b + 1 - eps);
    out.push(p && q && p.system === q.system ? Math.round(((q.x - p.x) / (1 - eps)) * 1e6) / 1e6 : NaN);
  }
  return out;
}
