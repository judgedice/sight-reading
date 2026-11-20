import { describe, expect, it } from 'vitest';
import { configs } from '../../../../fixtures/follow/gen/io.ts';
import type { Configs } from '../../../core/types.ts';
import {
  FAR_MS,
  HIT_HOLD_MS,
  NEXT_DELAY_MS,
  NOT_HEARD_MS,
  ROUND_SIZE,
  firstMatchNote,
  initialMatchState,
  matchBandCents,
  matchNotes,
  matchReducer,
  type MatchEvent,
  type MatchFrame,
  type MatchMode,
  type MatchState,
} from './model.ts';

const cfg: Configs = configs();
const inst = (id: string) => cfg.instrumentById[id]!;
const E2 = 40;
const E3 = 52;
const G3 = 55;

const frame = (t: number, midi: number | null, cents: number | null = 0, steady = true): MatchFrame => ({ t, midi, cents, levelDb: -30, steady });
const f = (t: number, midi: number | null, cents: number | null = 0, steady = true): MatchEvent => ({ type: 'frame', frame: frame(t, midi, cents, steady) });
const run = (s: MatchState, ...events: MatchEvent[]): MatchState => events.reduce(matchReducer, s);

/** A listening state with the target replaced, so tests do not depend on the note order. */
function listening(id: string, target?: number, mode: MatchMode = 'practice', at = 0): MatchState {
  const s = initialMatchState(inst(id), cfg, mode);
  const started = run(s, { type: 'played', t: at });
  return target === undefined ? started : { ...started, target };
}

/** Frames every 20 ms (50 Hz) from `from` to `to` inclusive. */
function hold(s: MatchState, from: number, to: number, midi: number, cents = 0): MatchState {
  let out = s;
  for (let t = from; t <= to; t += 20) out = matchReducer(out, f(t, midi, cents));
  return out;
}

describe('note choice', () => {
  it('starts a baritone on E3 or G3, inside C3 to C4', () => {
    const first = firstMatchNote(inst('voice-baritone'), cfg);
    expect([E3, G3]).toContain(first);
    expect(first).toBeGreaterThanOrEqual(48);
    expect(first).toBeLessThanOrEqual(60);
    expect(matchNotes(inst('voice-baritone'), cfg)[0]).toBe(first);
  });

  it('lists the tonic chord first, then the other naturals, each once, all inside the served range', () => {
    const notes = matchNotes(inst('voice-baritone'), cfg);
    expect(notes.slice(0, 4).map((m) => m % 12).sort((a, b) => a - b)).toEqual([0, 0, 4, 7]);
    expect(new Set(notes).size).toBe(notes.length);
    expect(notes.every((m) => m >= 48 && m <= 60 && [0, 2, 4, 5, 7, 9, 11].includes(m % 12))).toBe(true);
    expect(notes).toHaveLength(8);
  });

  it('picks the chord tone on the written staff and returns sounding pitch for a transposing instrument', () => {
    const trumpet = inst('trumpet-bb');
    const [wLo, wHi] = trumpet.tiers[cfg.levelByNumber[1]!.tier];
    const first = firstMatchNote(trumpet, cfg);
    const written = first + trumpet.writtenMinusSounding.chromatic;
    expect([0, 4, 7]).toContain(written % 12);
    expect(written).toBeGreaterThanOrEqual(wLo);
    expect(written).toBeLessThanOrEqual(wHi);
  });

  it('finds a first note and five notes for every instrument', () => {
    for (const id of Object.keys(cfg.instrumentById)) {
      const notes = matchNotes(inst(id), cfg);
      expect(notes.length, id).toBeGreaterThanOrEqual(ROUND_SIZE);
    }
  });

  it('reads the in-tune band from grading-config at difficulty 1', () => {
    expect(matchBandCents(inst('voice-baritone'), cfg)).toBe(30);
    expect(matchBandCents(inst('flute'), cfg)).toBe(25);
    /* Piano is not intonation graded: the continuous band stands in. */
    expect(matchBandCents(inst('piano-rh'), cfg)).toBe(25);
    expect(initialMatchState(inst('voice-baritone'), cfg).bandCents).toBe(30);
  });
});

describe('opening state', () => {
  it('waits for the app to play the note and ignores frames until then', () => {
    const s = initialMatchState(inst('voice-baritone'), cfg);
    expect(s.phase).toBe('idle');
    expect(s.target).toBe(s.notes[0]);
    expect(run(s, f(0, s.target), { type: 'tick', t: 99_000 })).toBe(s);
  });

  it('starts listening when the note has finished, and ignores a second played', () => {
    const s = run(initialMatchState(inst('voice-baritone'), cfg), { type: 'played', t: 1800 });
    expect(s.phase).toBe('listening');
    expect(s.listenSince).toBe(1800);
    expect(run(s, { type: 'played', t: 5000 })).toBe(s);
  });
});

describe('the hit', () => {
  it('needs 0.8 s in the band, in a row (fake clock)', () => {
    let s = listening('voice-baritone', E3);
    s = run(s, f(100, E3, 5));
    expect(s.phase).toBe('in-band');
    s = run(s, f(100 + HIT_HOLD_MS - 1, E3, 5));
    expect(s.phase).toBe('in-band');
    s = run(s, f(100 + HIT_HOLD_MS, E3, 5));
    expect(s.phase).toBe('hit');
    expect(s.hitAt).toBe(100 + HIT_HOLD_MS);
    expect(s.results).toEqual([{ hit: true, cents: 5 }]);
  });

  it('can complete on a tick when frames pause', () => {
    let s = run(listening('voice-baritone', E3), f(0, E3, -10));
    s = run(s, { type: 'tick', t: HIT_HOLD_MS - 1 });
    expect(s.phase).toBe('in-band');
    s = run(s, { type: 'tick', t: HIT_HOLD_MS });
    expect(s.phase).toBe('hit');
  });

  it('is not a hit when a frame leaves the band (in a row)', () => {
    let s = run(listening('voice-baritone', E3), f(0, E3, 0), f(400, E3, 40));
    expect(s.phase).toBe('sharp');
    s = run(s, f(500, E3, 0), f(1200, E3, 0));
    expect(s.phase).toBe('in-band');
    s = run(s, f(1300, E3, 0));
    expect(s.phase).toBe('hit');
  });

  it('breaks the hold on a frame that is not steady and keeps the needle', () => {
    let s = run(listening('voice-baritone', E3), f(0, E3, 10), f(300, E3, 10, false));
    expect(s.phase).toBe('listening');
    expect(s.needle).toBe(10);
    s = run(s, f(1000, E3, 10));
    expect(s.phase).toBe('in-band');
    s = run(s, f(1000 + HIT_HOLD_MS, E3, 10));
    expect(s.phase).toBe('hit');
  });

  it('treats a frame with no pitch or no cents as not steady', () => {
    let s = run(listening('voice-baritone', E3), f(0, null, null, true));
    expect(s.phase).toBe('listening');
    s = run(s, f(10, E3, null, true));
    expect(s.phase).toBe('listening');
    expect(s.you).toBeNull();
    expect(s.needle).toBeNull();
  });

  it('keeps flat or sharp on screen when a frame is not steady', () => {
    const s = run(listening('voice-baritone', E3), f(0, E3, -40), f(20, E3, -40, false));
    expect(s.phase).toBe('flat');
  });

  it('ignores frames and short ticks once hit', () => {
    const hit = hold(listening('voice-baritone', E3), 0, HIT_HOLD_MS, E3);
    expect(hit.phase).toBe('hit');
    expect(run(hit, f(1000, E3, 45))).toBe(hit);
    expect(run(hit, { type: 'tick', t: hit.hitAt! + NEXT_DELAY_MS - 1 })).toBe(hit);
  });

  it('uses the mean deviation during the hold', () => {
    const s = run(listening('voice-baritone', E3), f(0, E3, -10), f(400, E3, -20), f(800, E3, -30));
    expect(s.results[0]!.cents).toBeCloseTo(-20, 5);
  });
});

describe('flat, sharp and the needle', () => {
  it('says low, high and shows the sung note', () => {
    let s = run(listening('voice-baritone', E3), f(0, E3, -40));
    expect(s.phase).toBe('flat');
    expect(s.you).toBe(E3);
    expect(s.needle).toBe(-40);
    s = run(s, f(20, E3 + 1, -60));
    expect(s.phase).toBe('sharp');
    expect(s.needle).toBe(40);
    s = run(s, f(40, E3, 45));
    expect(s.phase).toBe('sharp');
  });

  it('clamps the needle to 50 cents either way', () => {
    expect(run(listening('voice-baritone', E3), f(0, E3, -49.5), f(20, E3 - 1, -40)).needle).toBe(-50);
    expect(run(listening('voice-baritone', E3), f(0, E3 + 1, 80)).needle).toBe(50);
  });

  it('counts the band edge as in tune', () => {
    expect(run(listening('voice-baritone', E3), f(0, E3, 30)).phase).toBe('in-band');
    expect(run(listening('voice-baritone', E3), f(0, E3, 31)).phase).toBe('sharp');
  });
});

describe('not heard', () => {
  it('says so after 6 s with no steady pitch (tick)', () => {
    let s = listening('voice-baritone', E3, 'practice', 1000);
    s = run(s, { type: 'tick', t: 1000 + NOT_HEARD_MS - 1 });
    expect(s.phase).toBe('listening');
    s = run(s, { type: 'tick', t: 1000 + NOT_HEARD_MS });
    expect(s.phase).toBe('not-heard');
  });

  it('counts unsteady frames as silence', () => {
    const s = run(listening('voice-baritone', E3), f(NOT_HEARD_MS, E3, 0, false));
    expect(s.phase).toBe('not-heard');
  });

  it('counts 6 s from the last steady pitch and clears the hold', () => {
    let s = run(listening('voice-baritone', E3), f(1000, E3, 50));
    expect(s.phase).toBe('sharp');
    s = run(s, { type: 'tick', t: 1000 + NOT_HEARD_MS });
    expect(s.phase).toBe('not-heard');
    expect(s.farSince).toBeNull();
  });

  it('recovers when a steady pitch comes back', () => {
    let s = run(listening('voice-baritone', E3), { type: 'tick', t: NOT_HEARD_MS });
    s = run(s, f(NOT_HEARD_MS + 100, E3, 0));
    expect(s.phase).toBe('in-band');
    s = run(s, f(NOT_HEARD_MS + 100 + HIT_HOLD_MS, E3, 0));
    expect(s.phase).toBe('hit');
  });
});

describe('too far', () => {
  it('needs more than 3 semitones for 2 s: too low says higher, too high says lower', () => {
    let s = run(listening('voice-baritone', E3), f(0, E3 - 4, 0));
    expect(s.phase).toBe('flat');
    s = run(s, f(FAR_MS - 1, E3 - 4, 0));
    expect(s.phase).toBe('flat');
    s = run(s, f(FAR_MS, E3 - 4, 0));
    expect(s.phase).toBe('far-up');
    s = run(s, f(FAR_MS + 20, E3 - 4, 0), { type: 'tick', t: FAR_MS + 30 });
    expect(s.phase).toBe('far-up');
    const high = run(listening('voice-baritone', E3), f(0, E3 + 4, 0), { type: 'tick', t: FAR_MS });
    expect(high.phase).toBe('far-down');
  });

  it('exactly 3 semitones is not far', () => {
    const s = run(listening('voice-baritone', E3), f(0, E3 + 3, 0), f(FAR_MS + 100, E3 + 3, 0));
    expect(s.phase).toBe('sharp');
  });

  it('starts again when the player comes back inside 3 semitones', () => {
    let s = run(listening('voice-baritone', E3), f(0, E3 - 4, 0), f(1500, E3 - 1, 0), f(1600, E3 - 4, 0));
    s = run(s, f(1600 + FAR_MS - 1, E3 - 4, 0));
    expect(s.phase).toBe('flat');
    s = run(s, f(1600 + FAR_MS, E3 - 4, 0));
    expect(s.phase).toBe('far-up');
  });

  it('a voice is judged octave-free, so an octave and 4 semitones high is 4 semitones away', () => {
    const s = run(listening('voice-bass', E3), f(0, E3 + 12 - 4, 0), f(FAR_MS, E3 + 12 - 4, 0));
    expect(s.phase).toBe('far-up');
  });

  it('an instrument is far when more than 3 semitones off in its own octave', () => {
    const s = run(listening('flute', 72), f(0, 72 + 5, 0), f(FAR_MS, 72 + 5, 0));
    expect(s.phase).toBe('far-down');
  });
});

describe('octaves', () => {
  it('baritone singing E2 against E3: no octave line (E2 is below G2), and it counts', () => {
    const s = run(listening('voice-baritone', E3), f(0, E2, 5));
    expect(s.phase).toBe('in-band');
    expect(s.octave).toBeNull();
    const hit = hold(s, 20, HIT_HOLD_MS, E2, 5);
    expect(hit.phase).toBe('hit');
    expect(hit.octave).toBeNull();
  });

  it('bass singing E2 against E3: octave lower, still counted as a hit with the line kept', () => {
    const s = run(listening('voice-bass', E3), f(0, E2, 5));
    expect(s.phase).toBe('octave-lower');
    expect(s.octave).toBe('lower');
    expect(s.needle).toBe(5);
    const hit = hold(s, 20, HIT_HOLD_MS, E2, 5);
    expect(hit.phase).toBe('hit');
    expect(hit.octave).toBe('lower');
  });

  it('shows octave higher inside the full range and not above it', () => {
    expect(run(listening('voice-bass', E3), f(0, E3 + 12, 0)).phase).toBe('octave-higher');
    expect(run(listening('voice-baritone', E3), f(0, E3 + 12, 0)).octave).toBe('higher');
    /* Baritone top is G4 (67): two octaves above G3 is out of range, so no octave line. */
    expect(run(listening('voice-baritone', 55), f(0, 55 + 24, 0)).phase).toBe('in-band');
  });

  it('keeps flat and sharp for an octave-shifted voice', () => {
    const s = run(listening('voice-bass', E3), f(0, E2, -45));
    expect(s.phase).toBe('flat');
    expect(s.octave).toBe('lower');
  });

  it('an instrument in the wrong octave hears "wrong octave" and never hits', () => {
    let s = run(listening('flute', 72), f(0, 60, 0));
    expect(s.phase).toBe('wrong-octave');
    expect(s.octave).toBeNull();
    s = hold(s, 20, 3000, 60);
    expect(s.phase).toBe('wrong-octave');
    s = run(s, f(3020, 72, 0));
    expect(s.phase).toBe('in-band');
  });

  it('an instrument a long way off in another octave is measured against the target, not called wrong octave', () => {
    const s = run(listening('flute', 72), f(0, 60 + 3, 0));
    expect(s.phase).toBe('flat');
  });

  it('a wrong octave resets the hold and the far timer', () => {
    const s = run(listening('flute', 72), f(0, 72 + 5, 0), f(500, 72, 0), f(600, 60, 0), f(700, 72, 0));
    expect(s.phase).toBe('in-band');
    expect(s.bandSince).toBe(700);
    expect(s.farSince).toBeNull();
  });
});

describe('rounds', () => {
  const baritone = (mode: MatchMode = 'practice') => initialMatchState(inst('voice-baritone'), cfg, mode);

  /** Play and hit the current note at `start`; returns the state and the time of the hit. */
  function hit(s: MatchState, start: number, cents = 0): { s: MatchState; at: number } {
    let out = run(s, { type: 'played', t: start });
    out = run(out, f(start + 100, out.target, cents), f(start + 100 + HIT_HOLD_MS, out.target, cents));
    return { s: out, at: start + 100 + HIT_HOLD_MS };
  }

  it('brings the next note 1.5 s after a hit', () => {
    const { s, at } = hit(baritone(), 0);
    expect(s.phase).toBe('hit');
    const before = run(s, { type: 'tick', t: at + NEXT_DELAY_MS - 1 });
    expect(before.phase).toBe('hit');
    const next = run(s, { type: 'tick', t: at + NEXT_DELAY_MS });
    expect(next.phase).toBe('idle');
    expect(next.index).toBe(1);
    expect(next.target).toBe(next.notes[1]);
    expect(next.you).toBeNull();
    expect(next.results).toHaveLength(1);
  });

  it('runs five notes and then the summary with the mean and direction', () => {
    let s = baritone();
    let t = 0;
    for (let i = 0; i < ROUND_SIZE; i++) {
      const h = hit(s, t, -10);
      t = h.at + NEXT_DELAY_MS;
      s = run(h.s, { type: 'tick', t });
      t += 100;
    }
    expect(s.phase).toBe('summary');
    expect(s.summary).toEqual({ hit: 5, total: 5, meanCents: -10, cents: 10, direction: 'flat' });
    expect(run(s, f(0, E3), { type: 'tick', t: 1e9 }, { type: 'next' })).toBe(s);
  });

  it('says sharp for a high mean and centre for a mean that rounds to zero, and nothing with no hits', () => {
    const sharp = hit(baritone(), 0, 12);
    const sharpEnd = { ...run(sharp.s, { type: 'tick', t: sharp.at + NEXT_DELAY_MS }), index: 4 };
    const endSharp = run({ ...sharpEnd, phase: 'hit' as const }, { type: 'next' });
    expect(endSharp.summary).toEqual({ hit: 1, total: 1, meanCents: 12, cents: 12, direction: 'sharp' });

    const centre = hit(baritone(), 0, 0.4);
    const endCentre = run({ ...centre.s, index: 4 }, { type: 'next' });
    expect(endCentre.summary!.direction).toBe('centre');
    expect(endCentre.summary!.cents).toBe(0);

    let s = baritone();
    for (let i = 0; i < ROUND_SIZE; i++) s = run(s, { type: 'next' });
    expect(s.phase).toBe('summary');
    expect(s.summary).toEqual({ hit: 0, total: 5, meanCents: null, cents: 0, direction: null });
  });

  it('counts a skipped note as a miss and does not double count a hit', () => {
    let s = run(baritone(), { type: 'next' });
    expect(s.results).toEqual([{ hit: false, cents: null }]);
    expect(s.index).toBe(1);
    const h = hit(s, 0);
    s = run(h.s, { type: 'next' });
    expect(s.results).toHaveLength(2);
    expect(s.results[1]!.hit).toBe(true);
    expect(s.index).toBe(2);
  });

  it('"Five more" starts a new round on the next notes; "Play it again" repeats the same note', () => {
    let s = baritone();
    for (let i = 0; i < ROUND_SIZE; i++) s = run(s, { type: 'next' });
    const again = run(s, { type: 'again' });
    expect(again.phase).toBe('idle');
    expect(again.roundNumber).toBe(1);
    expect(again.index).toBe(0);
    expect(again.results).toEqual([]);
    expect(again.summary).toBeNull();
    expect(again.target).toBe(again.notes[ROUND_SIZE % again.notes.length]);

    const mid = run(baritone(), { type: 'played', t: 0 }, f(10, E3, -40));
    const replay = run(mid, { type: 'again' });
    expect(replay.phase).toBe('idle');
    expect(replay.target).toBe(mid.target);
    expect(replay.you).toBeNull();
    expect(replay.index).toBe(0);
  });

  it('a chosen chip stays: a hit does not move on and is not counted in the round', () => {
    let s = run(baritone(), { type: 'choose-note', midi: 57 });
    expect(s.chosen).toBe(true);
    expect(s.target).toBe(57);
    expect(s.phase).toBe('idle');
    s = run(s, { type: 'played', t: 0 }, f(100, 57, 0), f(100 + HIT_HOLD_MS, 57, 0));
    expect(s.phase).toBe('hit');
    expect(s.results).toEqual([]);
    s = run(s, { type: 'tick', t: 1e6 });
    expect(s.phase).toBe('hit');
    expect(s.target).toBe(57);
    const other = run(s, { type: 'choose-note', midi: 50 });
    expect(other.target).toBe(50);
    expect(other.phase).toBe('idle');
  });

  it('Next from a chosen note returns to the round', () => {
    const s = run(baritone(), { type: 'next' }, { type: 'choose-note', midi: 57 }, { type: 'next' });
    expect(s.chosen).toBe(false);
    expect(s.index).toBe(1);
    expect(s.target).toBe(s.notes[1]);
    expect(s.results).toHaveLength(1);
  });

  it('choosing a note leaves the summary', () => {
    let s = baritone();
    for (let i = 0; i < ROUND_SIZE; i++) s = run(s, { type: 'next' });
    expect(run(s, { type: 'choose-note', midi: 52 }).summary).toBeNull();
  });
});

describe('onboarding', () => {
  it('never moves on by itself, after a hit or later, and ignores Next', () => {
    let s = run(listening('voice-baritone', E3, 'onboarding'), f(0, E3, 0), f(HIT_HOLD_MS, E3, 0));
    expect(s.phase).toBe('hit');
    expect(s.results).toEqual([]);
    s = run(s, { type: 'tick', t: 1e7 }, { type: 'next' });
    expect(s.phase).toBe('hit');
    expect(s.target).toBe(E3);
    expect(s.index).toBe(0);
    expect(s.summary).toBeNull();
  });

  it('notes a voice that sits above or below the range after 2 s too far', () => {
    const above = run(listening('voice-baritone', 48, 'onboarding'), f(0, 64, 0), f(FAR_MS - 1, 64, 0));
    expect(above.otherVoice).toBeNull();
    expect(run(above, f(FAR_MS, 64, 0)).otherVoice).toBe('above');
    const below = run(listening('voice-baritone', 60, 'onboarding'), f(0, 44, 0), f(FAR_MS, 44, 0));
    expect(below.otherVoice).toBe('below');
  });

  it('does not suggest another voice when the far note is inside the range, in practice, or for an instrument', () => {
    expect(run(listening('voice-baritone', 49, 'onboarding'), f(0, 57, 0), f(FAR_MS, 57, 0)).otherVoice).toBeNull();
    expect(run(listening('voice-baritone', 48), f(0, 64, 0), f(FAR_MS, 64, 0)).otherVoice).toBeNull();
    expect(run(listening('flute', 72, 'onboarding'), f(0, 80, 0), f(FAR_MS, 80, 0)).otherVoice).toBeNull();
  });
});
