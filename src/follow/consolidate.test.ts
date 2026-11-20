// One sung note is one note, after the fact and live (round 2 real voice, docs/redesign/round2/08-real-voice.md):
// `consolidate.ts` (the final pass) and the live follower's note chains (`continuation.ts`), on the written notes of
// the voice follow fixture (soprano, difficulty 2, 72 bpm). Written note 4 is A4 (69) at 2.5 s, note 5 G4 (67) at
// 3.33 s; both are quarter notes (833 ms apart), so the rule lengths are the config's, not the rhythm caps.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ClockSeconds, DetectedNote, FollowConfig, FollowerEvent, FollowFixture } from '../core/types.ts';
import { configs, corpusDoc } from '../../fixtures/follow/gen/io.ts';
import { resolveOneNote, resolveTolerances } from '../rules/index.ts';
import { followConfigFor } from '../testkit/predicates/index.ts';
import { consolidateNotes } from './consolidate.ts';
import { alignFinal, LiveFollower, liveOutcomeOf } from './index.ts';

const fx = JSON.parse(readFileSync(new URL('../../fixtures/follow/octave-voice.json', import.meta.url), 'utf8')) as FollowFixture;
const cfg = configs();
const instrument = cfg.instrumentById[fx.instrumentId]!;
const tol = resolveTolerances(fx.expected, { instrument, level: fx.level, bpm: fx.bpm, meter: corpusDoc(fx.excerptId).meter }, cfg);
const plain: FollowConfig = followConfigFor(fx, instrument, cfg, tol);
const voice: FollowConfig = { ...plain, oneNote: resolveOneNote(cfg, instrument, fx.level) };
const zero = fx.t0 + fx.latencyCompensationSec;

let nextId = 100;
/** A detected note at score second `s`, `dur` long; `meets` makes it start where the one before ended (a pitch change). */
function note(s: number, dur: number, midi: number, cause: DetectedNote['onsetCause'] = 'from-silence'): DetectedNote {
  return {
    id: nextId++,
    onset: (zero + s) as ClockSeconds,
    offset: (zero + s + dur) as ClockSeconds,
    provisionalMidi: midi,
    midi,
    stableMedianCents: (midi - Math.round(midi)) * 100,
    steadyMs: Math.max(0, dur * 1000 - 100),
    pitchSdCents: 10,
    clarity: 0.97,
    altOctaveClarity: null,
    onsetCause: cause,
    framesAgree: true,
  };
}
/** Notes that follow each other at pitch changes: [first s, [dur, midi], [dur, midi], ...]. */
function sung(s: number, ...pieces: [number, number][]): DetectedNote[] {
  const out: DetectedNote[] = [];
  let t = s;
  pieces.forEach(([dur, midi], k) => {
    out.push(note(t, dur, midi, k === 0 ? 'from-silence' : 'pitch-change'));
    t += dur;
  });
  return out;
}
const S4 = 2.5;
const S5 = 3.3333;

describe('consolidateNotes: the pieces of one sung note', () => {
  it('a long scoop from below: one note, the onset where the sound starts, the settled pitch, the first piece’s id', () => {
    const xs = sung(S4 - 0.01, [0.25, 67.6], [0.55, 69.05]);
    const out = consolidateNotes(voice, xs);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: xs[0]!.id, onset: xs[0]!.onset, offset: xs[1]!.offset, midi: 69.05, onsetCause: 'from-silence' });
    const j = alignFinal(voice, xs, null).judgments[4]!;
    expect(j).toMatchObject({ status: 'matched', timing: 'on-time', pitch: 'in-tune' });
    // The 02 rules alone: the settled half is matched 240 ms late and the scoop is an extra.
    const old = alignFinal(plain, xs, null);
    expect(old.judgments[4]!.timingErrorMs).toBeGreaterThan(200);
    expect(old.extras.map((x) => x.detectedId)).toEqual([xs[0]!.id]);
  });

  it('an overshoot that settles on the written pitch joins; a held pitch falling to another, neither written, does not', () => {
    expect(consolidateNotes(voice, sung(S4 - 0.05, [0.18, 69.9], [0.6, 69.02]))).toHaveLength(1);
    expect(consolidateNotes(voice, sung(S4 - 0.05, [0.26, 71.2], [0.55, 70.3]))).toHaveLength(2);
  });

  it('a short note that sings the written note is that note, not a scoop into the next pitch', () => {
    expect(consolidateNotes(voice, sung(S4 - 0.05, [0.16, 69.1], [0.6, 70.6]))).toHaveLength(2);
  });

  it('a split whose halves lie within the change threshold is one note (the longer half gives the pitch)', () => {
    const xs = sung(S4 - 0.01, [0.27, 68.65], [0.6, 69.05]);
    const out = consolidateNotes(voice, xs);
    expect(out).toHaveLength(1);
    expect(out[0]!.midi).toBe(69.05);
    expect(out[0]!.steadyMs).toBe(xs[0]!.steadyMs + xs[1]!.steadyMs);
  });

  it('two written notes sung legato stay two, even when they lie within the change threshold', () => {
    // A4 sung 80 c flat, then G4 sung 50 c sharp: 70 c apart, but the second starts on written note 5.
    const xs = [note(S4, S5 - S4, 68.2), note(S5, 0.6, 67.4, 'pitch-change')];
    expect(consolidateNotes(voice, xs)).toHaveLength(2);
  });

  it('a glitch (an octave or more down for 160 ms in a held note) is bridged: one note at the held pitch', () => {
    const xs = sung(S4 - 0.01, [0.5, 69], [0.16, 57.2], [0.3, 69.4]);
    const out = consolidateNotes(voice, xs);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: xs[0]!.id, midi: 69, offset: xs[2]!.offset });
    // 14.7 semitones down (creak, not an octave) as well.
    expect(consolidateNotes(voice, sung(S4 - 0.01, [0.4, 69], [0.16, 54.3], [0.27, 70.1], [0.6, 69.2]))).toHaveLength(1);
  });

  it('a short excursion that comes back is the same note; a note that does not come back is not', () => {
    expect(consolidateNotes(voice, sung(S4 - 0.01, [0.4, 69], [0.27, 70.3], [0.6, 69.2]))).toHaveLength(1);
    expect(consolidateNotes(voice, sung(S4 - 0.01, [0.4, 69], [0.27, 70.3]))).toHaveLength(2);
  });

  it('a fragment joins the neighbour nearer in pitch; one on time at the next written note stays that note', () => {
    // A falling end of 90 ms after the held A4, then G4 after a breath: the fragment is the A4's.
    const tail = [...sung(S4 - 0.01, [0.7, 69], [0.09, 67.9]), note(S5 + 0.02, 0.6, 67)];
    const out = consolidateNotes(voice, tail);
    expect(out).toHaveLength(2);
    expect(out[0]!.offset).toBe(tail[1]!.offset);
    // A G4 of 100 ms sung legato, on time at written note 5: kept (matched, not missed).
    const short = [note(S4, S5 - S4, 69), note(S5 + 0.01, 0.1, 67.3, 'pitch-change')];
    expect(consolidateNotes(voice, short)).toHaveLength(2);
    expect(alignFinal(voice, short, null).judgments[5]!.status).toBe('matched');
  });

  it('is off without a one-note row, and for a row stored before the real-voice tolerances', () => {
    const xs = sung(S4 - 0.01, [0.25, 67.6], [0.55, 69.05]);
    expect(consolidateNotes(plain, xs)).toHaveLength(2);
    const { glitchMs: _g, glitchSemitones: _s, fragmentMs: _f, longScoopMs: _l, scoopMaxCents: _c, mergeCents: _m, fragmentIoiFrac: _a, glitchIoiFrac: _b, scoopIoiFrac: _d, ...round2 } = voice.oneNote!;
    expect(consolidateNotes({ ...voice, oneNote: round2 as NonNullable<FollowConfig['oneNote']> }, xs)).toHaveLength(2);
  });

  it('is idempotent', () => {
    const xs = [...sung(S4 - 0.01, [0.25, 67.6], [0.5, 69.05], [0.09, 67.4]), ...sung(S5 + 0.1, [0.4, 67], [0.16, 55], [0.4, 67.2])];
    const once = consolidateNotes(voice, xs);
    expect(once.length).toBeLessThan(xs.length);
    expect(consolidateNotes(voice, once)).toEqual(once);
  });
});

describe('live: the pieces of one sung note are one note on the staff', () => {
  /** Runs the follower: note-on with the confirming pitch, one update at 150 ms steady, note-off, a clock every 20 ms. */
  function run(c: FollowConfig, xs: readonly DetectedNote[]): FollowerEvent[] {
    const lf = new LiveFollower(c);
    const out: FollowerEvent[] = [];
    const push = (evs: FollowerEvent[]): void => void out.push(...evs);
    let clock = zero + S4 - 0.5;
    const until = (t: number): void => {
      for (; clock + 0.02 <= t; clock += 0.02) push(lf.onClock(clock as ClockSeconds));
    };
    for (const d of xs) {
      until(d.onset);
      push(lf.onDsp({ type: 'note-on', note: { ...d, offset: null, steadyMs: 0 } }));
      const mid = (d.onset as number) + 0.25;
      if (mid < (d.offset as number)) {
        until(mid);
        push(lf.onDsp({ type: 'note-update', note: { ...d, offset: null, steadyMs: 150 } }));
      }
      until(d.offset as number);
      push(lf.onDsp({ type: 'note-off', note: d }));
    }
    until((xs.at(-1)!.offset as number) + 0.5);
    push(lf.end((clock + 0.1) as ClockSeconds, { reason: 'complete' }));
    return out;
  }
  const ghostOf = (evs: FollowerEvent[], id: number): boolean => evs.some((e) => e.type === 'ghost' && e.ghost.detectedId === id && e.ghost.kind === 'extra');
  const judgments = (evs: FollowerEvent[], idx: number) => evs.flatMap((e) => (e.type === 'judgment' && e.judgment.expectedIdx === idx ? [e.judgment] : []));

  it('a long scoop: no extra drawn, no wrong pitch shown, the note judged with its settled pitch', () => {
    const xs = sung(S4 - 0.01, [0.3, 67.6], [0.6, 69.05]);
    const evs = run(voice, xs);
    expect(ghostOf(evs, xs[1]!.id)).toBe(false);
    const js = judgments(evs, 4);
    expect(js.some((j) => j.pitch === 'wrong-pitch')).toBe(false);
    expect(js.at(-1)).toMatchObject({ detectedId: xs[0]!.id, pitch: 'in-tune', provisional: false, timing: 'on-time' });
    // Live and final agree.
    expect(alignFinal(voice, xs, liveOutcomeOf(evs)).judgments[4]!.rejudged).toBe(false);
    // The 02 rules: the scoop is a wrong pitch and the settled note an extra ghost.
    const old = run(plain, xs);
    expect(ghostOf(old, xs[1]!.id)).toBe(true);
    expect(judgments(old, 4).some((j) => j.pitch === 'wrong-pitch')).toBe(true);
  });

  it('a glitch and the pitch it returns to are the held note; the glitch never gives the pitch', () => {
    const xs = sung(S4 - 0.01, [0.45, 69], [0.16, 57.2], [0.6, 69.3]);
    const evs = run(voice, xs);
    expect(ghostOf(evs, xs[1]!.id) || ghostOf(evs, xs[2]!.id)).toBe(false);
    expect(judgments(evs, 4).at(-1)).toMatchObject({ pitch: 'in-tune', provisional: false });
  });

  it('the next written note sung legato is matched as usual', () => {
    const xs = [note(S4, S5 - S4, 69), note(S5 + 0.01, 0.6, 67, 'pitch-change')];
    const evs = run(voice, xs);
    expect(judgments(evs, 5).at(-1)).toMatchObject({ detectedId: xs[1]!.id, pitch: 'in-tune' });
  });

  it('a far piece that lasts is a note of its own: drawn as an extra once it has sounded', () => {
    const xs = sung(S4 - 0.01, [0.2, 69], [0.6, 57.2]);
    expect(ghostOf(run(voice, xs), xs[1]!.id)).toBe(true);
  });
});
