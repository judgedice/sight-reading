/**
 * Test data for the review tests (not shipped): the D3 fixture line (F major, 4/4, 8 bars, 34 notes) on flute at
 * 90 bpm, with a hand-built final alignment holding every slip kind the review draws: late (partial credit), sharp,
 * wrong pitch on a key-signature note, missed, a marginal re-judged note, an extra, and a replayed run of bar 1 played
 * during bar 6.
 */
import type { AttemptRecord, DetectedNote, ExpectedNote, NoteJudgment, PreparedExcerpt, ResolvedTolerance } from '../../../../core/types.ts';
// eslint-disable-next-line boundaries/dependencies -- test data only (not shipped)
import { buildExpectedNotes } from '../../../../corpus/index.ts';
// eslint-disable-next-line boundaries/dependencies -- test data only (not shipped)
import { ghostPitch } from '../../../../follow/index.ts';
// eslint-disable-next-line boundaries/dependencies -- test data only (not shipped)
import { resolveTolerances } from '../../../../rules/index.ts';
import { fixtureDoc } from '../../../../notation/testing/corpus-node.ts';
import { preparedFromDoc } from '../../../../notation/testing/prepared.ts';
import { makeAttempt } from '../../../../store/test-data.ts';
import { cfg } from '../test-data.ts';
import type { GhostSpeller } from './model.ts';

export { cfg };
export const BPM = 90;
/** Input-clock time of bar 1 beat 1 (the take's constant clock offset). */
export const T0 = 5;
export const FIXTURE_ID = 'holmes-lc5855050-voice-m1-8';
export const spell: GhostSpeller = ghostPitch;

export const LATE = 1; // C5, bar 1 beat 2, eighth: 120 ms late
export const SHARP = 3; // G4, bar 1 beat 3: 38 cents sharp
export const WRONG = 15; // B♭4, bar 4 beat 1, half: played B natural
export const MISSED = 10; // D4, bar 3 beat 1
export const REJUDGED = 12; // F4, bar 3 beat 2.5: on time, marginal 55 ms late, live showed late
export const DISPLACED_IDS = [200, 201, 202, 203, 204];
export const EXTRA_ID = 300;

export interface ReviewFixture {
  record: AttemptRecord;
  prepared: PreparedExcerpt;
  expected: ExpectedNote[];
  tolerances: ResolvedTolerance[];
}

const sec = (beats: number): number => (beats * 60) / BPM;

function detected(id: number, onset: number, durSec: number, midi: number): DetectedNote {
  return {
    id,
    onset,
    offset: onset + durSec,
    provisionalMidi: midi,
    midi,
    stableMedianCents: (midi - Math.round(midi)) * 100,
    steadyMs: durSec * 1000,
    pitchSdCents: 4,
    clarity: 0.95,
    altOctaveClarity: null,
    onsetCause: 'from-silence',
    framesAgree: true,
  };
}

export function reviewFixture(over: Partial<AttemptRecord> = {}): ReviewFixture {
  const prepared: PreparedExcerpt = { ...preparedFromDoc(fixtureDoc(FIXTURE_ID), 'treble'), instrumentId: 'flute' };
  const expected = buildExpectedNotes(prepared, BPM, cfg);
  const instrument = cfg.instrumentById.flute!;
  const tolerances = resolveTolerances(expected, { instrument, level: 4, bpm: BPM, meter: prepared.meter }, cfg);
  const dets: DetectedNote[] = [];
  const replayedBars = new Set([22, 23, 24, 25, 26]); // bar 6 notes are missed while bar 1 is replayed
  const judgments: NoteJudgment[] = expected.map((e) => {
    const missed = e.idx === MISSED || replayedBars.has(e.idx);
    if (missed) {
      return {
        expectedIdx: e.idx, status: 'missed', detectedId: null, timing: null, timingErrorMs: null, pitch: null, playedConcertMidi: null,
        centsError: null, octaveDisplaced: false, duration: 'not-graded', heldRatio: null, credit: { p: 0, n: null, o: 0, d: null }, marginal: false, rejudged: false,
      };
    }
    let errMs = 0;
    let midi = e.concertMidi;
    let pitch: NoteJudgment['pitch'] = 'in-tune';
    let timing: NoteJudgment['timing'] = 'on-time';
    let cents = 2;
    let o = 1;
    let marginal = false;
    let rejudged = false;
    if (e.idx === LATE) {
      errMs = 120;
      timing = 'late';
      o = 0.5;
    }
    if (e.idx === SHARP) {
      cents = 38;
      midi += 0.38;
      pitch = 'sharp';
    }
    if (e.idx === WRONG) {
      midi = e.concertMidi + 1;
      pitch = 'wrong-pitch';
      cents = 0;
    }
    if (e.idx === REJUDGED) {
      errMs = 55;
      marginal = true;
      rejudged = true;
      o = 0.9;
    }
    const id = 100 + e.idx;
    dets.push(detected(id, T0 + e.onsetSec + errMs / 1000, e.durSec * 0.9, midi));
    return {
      expectedIdx: e.idx, status: 'matched', detectedId: id, timing, timingErrorMs: errMs, pitch, playedConcertMidi: midi, centsError: cents,
      octaveDisplaced: false, duration: 'ok', heldRatio: 0.9, credit: { p: pitch === 'wrong-pitch' ? 0 : 1, n: 1, o, d: 1 }, marginal, rejudged,
    };
  });
  // Bar 1 (idx 0..4) replayed while the metronome is in bar 6 (beats 20..23): offset −20 beats.
  const replay = expected.slice(0, 5);
  replay.forEach((e, k) => dets.push(detected(DISPLACED_IDS[k]!, T0 + sec(e.onsetBeat + 20), e.durSec * 0.9, e.concertMidi)));
  // An extra in the rest of bar 4 (beat 3.5 of the bar = score beat 15).
  dets.push(detected(EXTRA_ID, T0 + sec(15), 0.25, 74));
  dets.sort((a, b) => a.onset - b.onset);

  const record = makeAttempt(7, {
    id: 'attempt-review',
    excerptId: prepared.excerptId,
    instrumentId: 'flute',
    levelServed: 4,
    bpm: BPM,
    writtenKey: prepared.writtenKey,
    concertKey: prepared.concertKey,
    detected: dets,
    judgments,
    extras: [{ detectedId: EXTRA_ID, onsetSec: sec(15), concertMidi: 74, cents: 0, durSec: 0.25, duringRest: true }],
    displaced: [{ fromIdx: 0, toIdx: 4, offsetBeats: -20, detectedIds: DISPLACED_IDS }],
    ...over,
  });
  return { record, prepared, expected, tolerances };
}
