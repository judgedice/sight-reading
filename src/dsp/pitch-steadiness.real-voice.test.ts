// T16 (docs/redesign/round3/03-pitch-steadiness.md §7): the steady needle on the owner's real voice. The anonymised
// traces in fixtures/real-voice/ (trace only, no audio) hold every frame of two sung tries at 24 ms. Every sung note of
// at least 0.8 s becomes a 3 s hold, as in the spec's simulation: its real onset and held part, then the held part
// reflected end to end, which keeps his own wobble and drift. The target is put at the note's own median ± δ.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DiagnosticsFile, TryTrace } from '../session/diagnostics.ts';
import { IN_TUNE_INITIAL, STEADINESS_PRESETS, SteadinessFilter, centsAgainst, inTuneStep } from './pitch-steadiness.ts';

const load = (n: number): TryTrace => {
  const f = JSON.parse(readFileSync(new URL(`../../fixtures/real-voice/real-voice-try-${n}.json`, import.meta.url), 'utf8')) as DiagnosticsFile;
  return f.tries[0] as TryTrace;
};

interface Frame {
  midi: number | null;
  db: number;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h]! : (s[h - 1]! + s[h]!) / 2;
};

/** Every sung note of at least 0.8 s: its frames, and its own median (the median of its second half). */
function heldNotes(): { frames: Frame[]; own: number }[] {
  const out: { frames: Frame[]; own: number }[] = [];
  for (const n of [1, 2]) {
    const t = load(n);
    const fr = t.frames!;
    for (const d of t.detected) {
      if (d.offset === null || d.offset - d.onset < 0.8) continue;
      const end = d.offset;
      const frames: Frame[] = [];
      for (let i = 0; i < fr.t.length; i++) {
        if (fr.t[i]! < d.onset || fr.t[i]! > end) continue;
        frames.push({ midi: fr.midi[i] ?? null, db: fr.levelDb[i]! });
      }
      const half = frames.slice(frames.length >> 1).flatMap((f) => (f.midi === null ? [] : [f.midi]));
      out.push({ frames, own: median(half) });
    }
  }
  return out;
}

/** The 3 s hold: the note as sung, then its held part (after the first third) reflected end to end. */
function hold3s(frames: readonly Frame[], step: number): Frame[] {
  const held = frames.slice(Math.floor(frames.length / 3));
  const out = [...frames];
  let back = true;
  while (out.length * step < 3000) {
    out.push(...(back ? [...held].reverse() : held));
    back = !back;
  }
  return out.slice(0, Math.ceil(3000 / step));
}

const STEP = 24;

/** Runs a hold on Balanced against `target` (fractional MIDI); returns the hit time and the words per post. */
function judge(frames: readonly Frame[], target: number, hitMs = 800): { hitAt: number | null; words: string[] } {
  const p = { ...STEADINESS_PRESETS.balanced, hitMs };
  const f = new SteadinessFilter(p);
  let s = IN_TUNE_INITIAL;
  const words: string[] = [];
  frames.forEach((x, i) => {
    const t = i * STEP;
    f.push(t, x.midi, x.db);
    const r = f.reading;
    const c = (m: number | null): number | null => (m === null ? null : centsAgainst(m, target, true));
    s = inTuneStep(s, { t, gap: r.gap, runId: r.runId, judgeCents: c(r.judgeMidi), centreCents: c(r.centreMidi), holdCents: c(r.holdMidi) }, 30, p);
    const shown = c(r.settledMidi);
    if (t >= 800 && shown !== null) words.push(s.inTune ? 'hold' : shown < 0 ? 'low' : 'high');
  });
  return { hitAt: s.hitAt, words };
}

describe('T16: the steady needle on the real voice (Balanced)', () => {
  const notes = heldNotes();

  it('finds the sung notes of at least 0.8 s', () => {
    expect(notes.length).toBeGreaterThanOrEqual(12);
  });

  it('at the note’s own median, at least 90% of the holds are a hit', () => {
    const hits = notes.filter((n) => judge(hold3s(n.frames, STEP), n.own).hitAt !== null).length;
    expect(hits / notes.length).toBeGreaterThanOrEqual(0.9);
  });

  it('45 c away either way, no hit unless an 800 ms stretch of the hold really had its median within 30 c', () => {
    for (const n of notes) {
      const frames = hold3s(n.frames, STEP);
      for (const d of [-45, 45]) {
        const target = n.own + d / 100;
        const { hitAt } = judge(frames, target);
        if (hitAt === null) continue;
        const win = Math.round(800 / STEP);
        let close = false;
        for (let i = win; i <= frames.length && !close; i++) {
          const m = frames.slice(i - win, i).flatMap((f) => (f.midi === null ? [] : [f.midi]));
          if (m.length > 0 && Math.abs(centsAgainst(median(m), target, true)) <= 30) close = true;
        }
        expect(close, `own ${n.own.toFixed(2)} δ ${d}`).toBe(true);
      }
    }
  });

  // One hold of the 16 (a note at 56.6) changes 4 times in 2.2 s: it leaves in tune for a while, and as the needle
  // passes the centre "a little high" flips to "a little low" for two posts and back. Every other hold changes at most
  // once a second, and most never.
  it('the words change at most once a second during a hold on all but one note (from 0.8 s to 3 s, hits off)', () => {
    const per = notes.map((n) => {
      const { words } = judge(hold3s(n.frames, STEP), n.own, 1e9);
      let changes = 0;
      for (let i = 1; i < words.length; i++) if (words[i] !== words[i - 1]) changes++;
      return changes / 2.2;
    });
    expect(per.filter((x) => x > 1).length).toBeLessThanOrEqual(1);
    expect(median(per)).toBe(0);
  });
});
