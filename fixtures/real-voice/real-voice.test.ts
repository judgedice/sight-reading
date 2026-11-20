// The first real traces (docs/redesign/round2/08-real-voice.md): an untrained baritone on a laptop's built-in mic and
// speakers, the same excerpt twice (difficulty 1, 64 and 72 bpm), on the round 2 build. The fixtures are the trace
// only (frames, detected notes, configs, verdicts; no audio). Each try is replayed from its trace through the live
// follower and the final alignment with the current config (tools/diagnostics/replay.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DetectedNote, NoteJudgment } from '../../src/core/types.ts';
import { playerNotes } from '../../src/follow/index.ts';
import type { DiagnosticsFile, TryTrace } from '../../src/session/diagnostics.ts';
import { followOf, replayTrace } from '../../tools/diagnostics/replay.ts';

const load = (n: number): TryTrace => {
  const f = JSON.parse(readFileSync(new URL(`./real-voice-try-${n}.json`, import.meta.url), 'utf8')) as DiagnosticsFile;
  return f.tries[0] as TryTrace;
};
const raw = (t: TryTrace): DetectedNote[] => t.detected.map(({ ignored: _i, ...d }) => d as DetectedNote);
const wrong = (j: NoteJudgment | undefined): boolean => j?.status === 'matched' && j.pitch === 'wrong-pitch';
const inTune = (j: NoteJudgment | undefined): boolean => j?.status === 'matched' && (j.pitch === 'in-tune' || j.pitch === 'not-graded');

describe.each([1, 2])('real voice, try %i: the fixture', (n) => {
  const t = load(n);
  it('is the trace only: no audio, no names', () => {
    expect('audio' in t).toBe(false);
    const text = readFileSync(new URL(`./real-voice-try-${n}.json`, import.meta.url), 'utf8');
    expect(text).not.toMatch(/pcm16|base64|routeKey|"device"|"settings"/);
    expect(t.excerpt.excerptId).toBe('real-voice-excerpt-1');
  });
  it('replayed with the one-note row it was sung with, it gives the stored verdicts exactly', () => {
    // The stored row is the round 2 one; it has none of the real-voice tolerances, so nothing is joined.
    const r = replayTrace(t, { ...followOf(t), oneNote: t.configs.follow!.oneNote! });
    const key = (j: Pick<NoteJudgment, 'expectedIdx' | 'status' | 'timing' | 'pitch'>): string => `${j.expectedIdx}:${j.status}:${j.timing}:${j.pitch}`;
    expect(r.alignment.judgments.map(key)).toEqual(t.verdicts.judgments.map(key));
    expect(r.alignment.extras.map((x) => x.detectedId)).toEqual(t.verdicts.extras.map((x) => x.detectedId));
  });
});

describe('real voice, try 1 (64 bpm, no audio): one sung note is one note', () => {
  const t = load(1);
  const f = followOf(t);
  const r = replayTrace(t, f);
  const js = r.alignment.judgments;
  const written = f.expected.length;

  it('detected notes per written note: 1.81 before (29 for 16), 1.00 after', () => {
    expect(playerNotes({ ...f, oneNote: null }, raw(t))).toHaveLength(29);
    expect(r.notes.length / written).toBeLessThanOrEqual(1.07);
    expect(r.notes.length / written).toBeGreaterThanOrEqual(0.9);
  });

  it('the slow scoop into the first note: the onset where the sound starts, the settled pitch, not late, no extra', () => {
    // Stored: late by 256 ms (the settled half) and the scoop an extra.
    expect(t.verdicts.judgments[0]!.timing).toBe('late');
    expect(js[0]!.timing).toBe('on-time');
    expect(inTune(js[0])).toBe(true);
    expect(Math.abs(js[0]!.timingErrorMs!)).toBeLessThan(60);
  });

  it('no extras from scoops, splits, fragments or glitches: 11 before, the 4 notes sung where nothing was written after', () => {
    expect(t.verdicts.extras).toHaveLength(11);
    // E3 sung early (a bar before its written place), C4 in the rest, C4 between two G3s, and the last C4 sung a
    // beat and a half late; each is one sung note of at least 370 ms.
    expect(r.alignment.extras.map((x) => Math.round(x.onsetSec * 10) / 10)).toEqual([10.3, 12.3, 18.2, 20.7]);
    for (const x of r.alignment.extras) expect(x.durSec).toBeGreaterThan(0.35);
  });

  it('the held notes broken by a drop of 11 and 15 semitones are one note each', () => {
    const near = (s: number): DetectedNote[] => r.notes.filter((d) => Math.abs(d.onset - f.t0 - f.latencyCompensationSec - s) < 0.6);
    // 61.3, then 49.9 for 160 ms, then 62.3 (from 18.78 s): one note at the D4 the singer held.
    expect(near(18.9).filter((d) => d.midi > 61 && d.midi < 63)).toHaveLength(1);
    expect(r.notes.some((d) => d.midi < 50.5)).toBe(false);
    // 60.1, 45.4 for 160 ms, 61.3, 60.3, 57.9 (from 20.74 s): one C4.
    expect(near(21.3).filter((d) => d.onset - f.t0 - f.latencyCompensationSec > 20.5)).toHaveLength(1);
  });

  it('the real errors stay: the wrong notes of the second half are still wrong pitch', () => {
    for (const i of [1, 2, 6, 7, 10, 11, 12, 13, 14]) expect(wrong(js[i]), `note ${i}`).toBe(true);
    for (const i of [5, 8, 9, 15]) expect(js[i]!.status, `note ${i}`).toBe('missed');
  });
});

describe('real voice, try 2 (72 bpm, recorded with audio): one sung note is one note', () => {
  const t = load(2);
  const f = followOf(t);
  const r = replayTrace(t, f);
  const js = r.alignment.judgments;
  const written = f.expected.length;

  it('detected notes per written note: 1.44 before (23 for 16), 1.13 after', () => {
    expect(playerNotes({ ...f, oneNote: null }, raw(t))).toHaveLength(23);
    expect(r.notes.length / written).toBeLessThanOrEqual(1.13);
  });

  it('the first eight written notes: none wrong pitch, the ones sung in time in tune', () => {
    for (let i = 0; i < 8; i++) expect(wrong(js[i]), `note ${i}`).toBe(false);
    for (const i of [0, 1, 2, 3, 4, 6]) expect(inTune(js[i]), `note ${i}`).toBe(true);
    // The overshoot into C4 (60.9 for 170 ms, then 60.0): the onset where the sound starts.
    expect(t.verdicts.judgments[4]!.timingErrorMs).toBeGreaterThan(100);
    expect(js[4]!.timingErrorMs).toBeLessThan(0);
    expect(js[4]!.timing).toBe('on-time');
  });

  it('B3, A3 and G3 of bar 3 sung a beat late: one displaced run, not wrong notes', () => {
    expect(r.alignment.displaced).toHaveLength(1);
    expect(r.alignment.displaced[0]).toMatchObject({ fromIdx: 5, toIdx: 7 });
  });

  it('the real errors stay: the flat second half is wrong pitch, the last note back in tune but late', () => {
    // The singer was about a minor third flat from note 9 to note 14.
    for (let i = 9; i <= 14; i++) {
      expect(wrong(js[i]), `note ${i}`).toBe(true);
      expect(js[i]!.centsError!, `note ${i}`).toBeLessThan(-200);
    }
    // The last C4 came 0.65 s late, past its 417 ms match window (02 §4.1): missed, and the sung C4 an extra.
    expect(js[15]!.status).toBe('missed');
    expect(r.alignment.extras).toHaveLength(1);
    expect(r.alignment.extras[0]!.onsetSec).toBeGreaterThan(17.5 + f.tolerances[15]!.matchWindowSec);
    expect(Math.round(r.alignment.extras[0]!.concertMidi)).toBe(60);
  });
});

describe('real voice: joining is idempotent (the worker joins, the final alignment joins again)', () => {
  it.each([1, 2])('try %i', (n) => {
    const t = load(n);
    const f = followOf(t);
    const once = playerNotes(f, raw(t));
    expect(playerNotes(f, once)).toEqual(once);
  });
});
