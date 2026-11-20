// Round 2 detection in the follower: `oneNote` (no wrong pitch at confirmation for a scoop; a short note right after a
// matched note of the same pitch class is absorbed) and `own-playback.ts` (notes before the music and the app's own
// tones are not the player's).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ClockSeconds, DetectedNote, FollowConfig, FollowerEvent, FollowFixture, FollowStreamItem } from '../core/types.ts';
import { configs, corpusDoc } from '../../fixtures/follow/gen/io.ts';
import { resolveOneNote, resolveTolerances } from '../rules/index.ts';
import { finalDetected, followConfigFor, runFollowStream } from '../testkit/predicates/index.ts';
import { alignFinal, ignoredNote, LiveFollower, withOwnPlayback } from './index.ts';

const fx = JSON.parse(readFileSync(new URL('../../fixtures/follow/octave-voice.json', import.meta.url), 'utf8')) as FollowFixture;
const cfg = configs();
const instrument = cfg.instrumentById[fx.instrumentId]!;
const tol = resolveTolerances(fx.expected, { instrument, level: fx.level, bpm: fx.bpm, meter: corpusDoc(fx.excerptId).meter }, cfg);
const plain: FollowConfig = followConfigFor(fx, instrument, cfg, tol);
const voice: FollowConfig = { ...plain, oneNote: resolveOneNote(cfg, instrument, fx.level) };
const dspNote = (it: FollowStreamItem): DetectedNote | null => (it.kind === 'dsp' && 'note' in it.event ? it.event.note : null);
const run = (c: FollowConfig, stream: readonly FollowStreamItem[]): FollowerEvent[] => runFollowStream(stream, new LiveFollower(c));

describe('scoop: no wrong pitch at confirmation for voice (oneNote.wrongAtConfirm false)', () => {
  // The note-on of expected note 3 reads 2 semitones flat (the scoop's confirming frames), its updates are on pitch.
  const e3 = fx.expected[3]!;
  const on3 = fx.stream.find((it) => it.kind === 'dsp' && it.event.type === 'note-on' && Math.abs(it.event.note.onset - (fx.t0 + fx.latencyCompensationSec + e3.onsetSec)) < 0.05)!;
  const id = dspNote(on3)!.id;
  const stream = fx.stream.map((it) => {
    const n = dspNote(it);
    if (!n || n.id !== id || it.kind !== 'dsp' || it.event.type !== 'note-on') return it;
    return { ...it, event: { ...it.event, note: { ...n, provisionalMidi: n.provisionalMidi - 2, framesAgree: true } } } as FollowStreamItem;
  });
  const wrong = (evs: FollowerEvent[]): boolean => evs.some((e) => e.type === 'judgment' && e.judgment.expectedIdx === 3 && e.judgment.pitch === 'wrong-pitch');
  it('the 02 rules show it wrong at once; the voice tolerances wait for the steady pitch and show none', () => {
    expect(wrong(run(plain, stream))).toBe(true);
    expect(wrong(run(voice, stream))).toBe(false);
  });
});

describe('absorbed: a short note right after the last matched note at its pitch class is not an extra', () => {
  const last = [...fx.stream].reverse().find((it) => it.kind === 'dsp' && it.event.type === 'note-off')!;
  const prev = dspNote(last)!;
  const at = (prev.offset as number) + 0.03;
  const extraNote = (midi: number): DetectedNote => ({ ...prev, id: 9999, onset: at as ClockSeconds, offset: null, provisionalMidi: midi, midi, steadyMs: 0 });
  const withExtra = (midi: number): FollowStreamItem[] => {
    const i = fx.stream.indexOf(last) + 1;
    const add: FollowStreamItem[] = [{ kind: 'dsp', t: at as ClockSeconds, event: { type: 'note-on', note: extraNote(midi) } }];
    for (let t = at; t < at + 0.25; t += 0.02) add.push({ kind: 'clock', t: t as ClockSeconds });
    add.push({ kind: 'dsp', t: (at + 0.25) as ClockSeconds, event: { type: 'note-off', note: { ...extraNote(midi), offset: (at + 0.25) as ClockSeconds, steadyMs: 150 } } });
    return [...fx.stream.slice(0, i), ...add, ...fx.stream.slice(i)];
  };
  const ghost = (evs: FollowerEvent[]): boolean => evs.some((e) => e.type === 'ghost' && e.ghost.detectedId === 9999);
  it('same pitch class, 250 ms: drawn by the 02 rules, absorbed with the voice tolerances (live and final)', () => {
    const s = withExtra(prev.midi);
    expect(ghost(run(plain, s))).toBe(true);
    expect(ghost(run(voice, s))).toBe(false);
    expect(alignFinal(voice, finalDetected(s), null).extras.some((x) => x.detectedId === 9999)).toBe(false);
    expect(alignFinal(plain, finalDetected(s), null).extras.some((x) => x.detectedId === 9999)).toBe(true);
  });
  it('another pitch class sounding 250 ms is still drawn with the voice tolerances', () => {
    expect(ghost(run(voice, withExtra(prev.midi + 3)))).toBe(true);
  });
});

describe('own playback: before the music and the app tones', () => {
  const first = fx.expected[0]!;
  const c = withOwnPlayback(plain, [{ t: (fx.t0 - 3) as ClockSeconds, durSec: 1, hz: 440 }, { t: (fx.t0 + first.onsetSec + 4) as ClockSeconds, durSec: 0.5, hz: 220 }]);
  const note = (sAfterT0: number, midi: number): DetectedNote => ({ ...(dspNote(fx.stream.find((it) => dspNote(it))!) as DetectedNote), onset: (fx.t0 + fx.latencyCompensationSec + sAfterT0) as ClockSeconds, provisionalMidi: midi, midi });
  it('a note before the first written note window is ignored, and a note inside a tone at its pitch class', () => {
    expect(c.judgeFromScoreSec).toBeLessThan(first.onsetSec);
    expect(ignoredNote(c, note(-2.5, 69))).toBe(true);
    expect(ignoredNote(c, note(first.onsetSec, 69))).toBe(false);
    expect(ignoredNote(c, note(first.onsetSec + 4.1, 57.2))).toBe(true);
    expect(ignoredNote(c, note(first.onsetSec + 4.1, 60))).toBe(false);
  });
});
