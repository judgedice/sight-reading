// Match a note's model (round 2, 01-ux 3.1; round 3, 03-pitch-steadiness §3, §7). The reducer side of T1 to T14:
// frames carry the display filter's reading, made here by a real `SteadinessFilter` fed at 8 ms and posted every 20 ms
// as the pitch-mode tracker does, and the reducer decides the needle, the phase and the hit from it.
import { describe, expect, it } from 'vitest';
import { configs } from '../../../../fixtures/follow/gen/io.ts';
import type { SteadinessReading } from '../../../core/platform.ts';
import type { Configs, PitchSteadiness } from '../../../core/types.ts';
import { STEADINESS_PRESETS, SteadinessFilter } from '../../../session/index.ts';
import {
  FAR_MS,
  HIT_HOLD_MS,
  NEXT_DELAY_MS,
  NOT_HEARD_MS,
  ROUND_SIZE,
  YOU_REFRESH_MS,
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

const HIDDEN: SteadinessReading = { settledMidi: null, centreMidi: null, judgeMidi: null, holdMidi: null, spreadLoMidi: null, spreadHiMidi: null, voicedMs: 0, gap: 'hidden', runId: 0 };
/** A frame with nothing for the needle (silence, or before the filter shows). */
const quiet = (t: number, steady = false): MatchEvent => ({ type: 'frame', frame: { t, midi: null, cents: null, levelDb: -90, steady, reading: HIDDEN } });
const run = (s: MatchState, ...events: MatchEvent[]): MatchState => events.reduce(matchReducer, s);

/**
 * A singer on the fake clock: `sing` feeds a real display filter every 8 ms with `pitch(t)` (fractional concert MIDI,
 * or null for silence) and posts a frame to the reducer every 20 ms, with ticks every 100 ms, as the screen does.
 */
class Voice {
  t: number;
  private readonly filter: SteadinessFilter;
  private nextDue = -Infinity;
  private nextTick: number;
  constructor(start = 0, preset: PitchSteadiness = 'steady') {
    this.t = start;
    this.nextTick = start + 100;
    this.filter = new SteadinessFilter(STEADINESS_PRESETS[preset]);
  }
  sing(s: MatchState, ms: number, pitch: (t: number) => number | null, db = -35): MatchState {
    let out = s;
    const end = this.t + ms;
    for (; this.t < end; this.t += 8) {
      const m = pitch(this.t);
      this.filter.push(this.t, m, db);
      while (this.nextTick <= this.t) {
        out = matchReducer(out, { type: 'tick', t: this.nextTick });
        this.nextTick += 100;
      }
      if (this.t < this.nextDue - 1e-6) continue;
      this.nextDue = this.nextDue + 20 < this.t ? this.t + 20 : this.nextDue + 20;
      const frame: MatchFrame = { t: this.t, midi: m === null ? null : Math.round(m), cents: m === null ? null : (m - Math.round(m)) * 100, levelDb: db, steady: m !== null, reading: this.filter.reading };
      out = matchReducer(out, { type: 'frame', frame });
    }
    return out;
  }
  /** Holds one pitch. */
  hold(s: MatchState, ms: number, midi: number, cents = 0): MatchState {
    return this.sing(s, ms, () => midi + cents / 100);
  }
}

/** A listening state with the target replaced, so tests do not depend on the note order. */
function listening(id: string, target?: number, mode: MatchMode = 'practice', at = 0): MatchState {
  const s = initialMatchState(inst(id), cfg, mode);
  const started = run(s, { type: 'played', t: at });
  return target === undefined ? started : { ...started, target };
}

/** Sings `midi` (+ `cents`) from `at` for `ms` and returns the state and the voice. */
function sung(s: MatchState, ms: number, midi: number, cents = 0, at = 0, preset: PitchSteadiness = 'steady'): MatchState {
  return new Voice(at, preset).hold(s, ms, midi, cents);
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

  it('follows the player’s difficulty on Practice and keeps difficulty 1 in onboarding (open question 3)', () => {
    expect(matchBandCents(inst('voice-baritone'), cfg, 5)).toBe(25);
    expect(matchBandCents(inst('voice-baritone'), cfg, 8)).toBe(20);
    expect(matchBandCents(inst('flute'), cfg, 5)).toBe(20);
    expect(initialMatchState(inst('voice-baritone'), cfg, 'practice', 5).bandCents).toBe(25);
    expect(initialMatchState(inst('voice-baritone'), cfg, 'onboarding', 5).bandCents).toBe(30);
    // The fixed-pitch group has no band: the continuous one stands in at every difficulty.
    expect(matchBandCents(inst('piano-rh'), cfg, 9)).toBe(20);
  });
});

describe('opening state', () => {
  it('waits for the app to play the note and ignores frames until then', () => {
    const s = initialMatchState(inst('voice-baritone'), cfg);
    expect(s.phase).toBe('idle');
    expect(s.target).toBe(s.notes[0]);
    expect(sung(s, 2000, s.target)).toEqual(run(s, ...Array.from({ length: 20 }, (_, i) => ({ type: 'tick' as const, t: (i + 1) * 100 }))));
    expect(run(s, quiet(0), { type: 'tick', t: 99_000 })).toBe(s);
  });

  it('starts listening when the note has finished, and ignores a second played', () => {
    const s = run(initialMatchState(inst('voice-baritone'), cfg), { type: 'played', t: 1800 });
    expect(s.phase).toBe('listening');
    expect(s.listenSince).toBe(1800);
    expect(run(s, { type: 'played', t: 5000 })).toBe(s);
  });
});

describe('the hit: the centre of the held note within the band (T1, T2, T4)', () => {
  it('T1 a clean note: hidden before 60 ms, then in tune and a hit at S 1304, B 1208, Q 1104 ms (±24)', () => {
    const want = { steady: 1304, balanced: 1208, quick: 1104 } as const;
    for (const k of ['steady', 'balanced', 'quick'] as const) {
      const v = new Voice(0, k);
      let s = v.hold(listening('voice-baritone', E3), 52, E3);
      expect(s.needle, k).toBeNull();
      s = v.hold(s, 400, E3);
      expect(s.needle, k).toBe(0);
      s = v.hold(s, 2000, E3);
      expect(s.phase, k).toBe('hit');
      expect(Math.abs(s.hitAt! - want[k]), `${k} ${s.hitAt}`).toBeLessThanOrEqual(24);
      expect(s.results).toEqual([{ hit: true, cents: 0 }]);
    }
  });

  it('T2 a ±40 c 5.5 Hz vibrato on the note hits on every preset (the round 2 rule needed every 40 ms within 30 c)', () => {
    for (const k of ['steady', 'balanced', 'quick'] as const) {
      const s = new Voice(0, k).sing(listening('voice-baritone', E3), 2500, (t) => E3 + 0.4 * Math.sin((2 * Math.PI * 5.5 * t) / 1000));
      expect(s.phase, k).toBe('hit');
    }
  });

  it('a ±22 c 3.3 Hz wobble with a scoop, centred on the note, hits on Steady and Balanced', () => {
    const wobble = (t: number): number => E3 + (Math.min(0, -200 + 0.8 * t) + 22 * Math.sin((2 * Math.PI * 3.3 * t) / 1000)) / 100;
    for (const k of ['steady', 'balanced'] as const) {
      const s = new Voice(0, k).sing(listening('voice-baritone', E3), 2500, wobble);
      expect(s.phase, k).toBe('hit');
      expect(Math.abs(s.results[0]!.cents!), k).toBeLessThanOrEqual(5);
    }
  });

  it('T4 the same wobble centred 45 c low never hits: low, with the needle near -45 c', () => {
    const off = (t: number): number => E3 + (-45 + 22 * Math.sin((2 * Math.PI * 3.3 * t) / 1000)) / 100;
    for (const k of ['steady', 'balanced', 'quick'] as const) {
      const s = new Voice(0, k).sing(listening('voice-baritone', E3), 4000, off);
      expect(s.phase, k).toBe('flat');
      expect(s.results).toEqual([]);
      if (k === 'steady') expect(Math.abs(s.needle! + 45)).toBeLessThanOrEqual(6);
    }
  });

  it('follows the band: 25 c low hits at difficulty 1 (30 c) but not at difficulty 5 (25 c, entry at 20 c)', () => {
    expect(sung(listening('voice-baritone', E3), 2000, E3, -25).phase).toBe('hit');
    const d5 = { ...listening('voice-baritone', E3), bandCents: matchBandCents(inst('voice-baritone'), cfg, 5) };
    expect(sung(d5, 3000, E3, -25).phase).toBe('flat');
    expect(sung(d5, 2000, E3, -18).phase).toBe('hit');
  });

  it('ignores frames and short ticks once hit', () => {
    const v = new Voice();
    const hit = v.hold(listening('voice-baritone', E3), 1500, E3);
    expect(hit.phase).toBe('hit');
    expect(v.hold(hit, 200, E3, 45)).toEqual(hit);
    expect(run(hit, { type: 'tick', t: hit.hitAt! + NEXT_DELAY_MS - 1 })).toBe(hit);
  });

  it('records the hold median as the note’s deviation and shows the note settled on', () => {
    const s = sung(listening('voice-baritone', E3), 1500, E3, -12);
    expect(s.phase).toBe('hit');
    expect(s.results[0]!.cents).toBeCloseTo(-12, 5);
    expect(s.settled?.cents).toBeCloseTo(-12, 5);
    expect(s.settled?.midi).toBeCloseTo(E3 - 0.12, 5);
  });
});

describe('words, needle, wobble and silence (T7, T8, T10)', () => {
  it('low and high follow the side of the needle, and the needle clamps at 50 c', () => {
    const v = new Voice();
    let s = v.hold(listening('voice-baritone', E3), 600, E3, -40);
    expect(s.phase).toBe('flat');
    expect(s.you).toBe(E3);
    expect(Math.round(s.needle!)).toBe(-40);
    s = v.hold(s, 800, E3, 140);
    expect(s.phase).toBe('sharp');
    expect(s.needle).toBe(50);
    expect(s.you).toBe(E3 + 1);
  });

  it('draws the wobble width: about ±20 c for a ±22 c wobble, after the needle shows', () => {
    const s = new Voice().sing(listening('voice-baritone', E3), 900, (t) => E3 + (40 + 22 * Math.sin((2 * Math.PI * 3.3 * t) / 1000)) / 100);
    const [lo, hi] = s.spread!;
    expect(lo).toBeGreaterThan(5);
    expect(lo).toBeLessThan(30);
    expect(hi).toBeLessThanOrEqual(50);
    expect(hi - lo).toBeGreaterThan(25);
  });

  it('T7a a 1160 c glitch inside a held note changes nothing: no needle move, no reset, the hit comes on time', () => {
    const clean = sung(listening('voice-baritone', E3), 2000, E3);
    const g = new Voice().sing(listening('voice-baritone', E3), 2000, (t) => (t >= 900 && t < 1060 ? E3 - 11.6 : E3));
    expect(g.hitAt).toBe(clean.hitAt);
  });

  it('T8a a 100 ms dropout is bridged: needle and state kept, the hit timer runs on', () => {
    const clean = sung(listening('voice-baritone', E3), 2000, E3);
    const v = new Voice();
    let s = v.hold(listening('voice-baritone', E3), 900, E3);
    expect(s.phase).toBe('in-band');
    s = v.sing(s, 100, () => null);
    expect(s.phase).toBe('in-band');
    expect(s.needle).toBe(0);
    expect(s.dim).toBe(false);
    s = v.hold(s, 1000, E3);
    expect(s.hitAt).toBe(clean.hitAt);
  });

  it('T8b a 300 ms dropout dims the needle at its last place and resets the state; T8c after 600 ms it is hidden', () => {
    const v = new Voice();
    let s = v.hold(listening('voice-baritone', E3), 900, E3, -20);
    expect(s.phase).toBe('in-band');
    s = v.sing(s, 300, () => null);
    expect(s.dim).toBe(true);
    expect(Math.round(s.needle!)).toBe(-20);
    expect(s.phase).toBe('listening');
    expect(s.judge.inTune).toBe(false);
    s = v.sing(s, 350, () => null);
    expect(s.needle).toBeNull();
    expect(s.you).toBeNull();
    // Voice again: the needle comes back and the hold starts over.
    s = v.hold(s, 600, E3);
    expect(s.needle).toBe(0);
    expect(s.dim).toBe(false);
  });

  it('a stop after a full hold leaves the settled note; singing again takes it away', () => {
    const v = new Voice();
    let s = v.hold(listening('voice-baritone', E3), 1100, E3, -60);
    expect(s.phase).toBe('flat');
    s = v.sing(s, 200, () => null);
    expect(s.settled?.cents).toBeCloseTo(-60, 5);
    s = v.hold(s, 300, E3);
    expect(s.settled).toBeNull();
    // A short note leaves nothing.
    const short = new Voice().hold(listening('voice-baritone', E3), 500, E3, -60);
    expect(new Voice(500).sing(short, 200, () => null).settled).toBeNull();
  });

  it('T10 a +100 c move at 1.0 s leaves in tune at once (fast exit) and earns no hit', () => {
    const s = new Voice().sing(listening('voice-baritone', E3), 3000, (t) => E3 + (t < 1000 ? 0 : 1));
    expect(s.results).toEqual([]);
    expect(s.phase).toBe('sharp');
  });

  it('refreshes the "You" line’s cents at most 4 times a second', () => {
    const v = new Voice();
    let s = v.sing(listening('voice-baritone', E3), 600, (t) => E3 + (-40 + 20 * Math.sin((2 * Math.PI * 7 * t) / 1000)) / 100);
    const seen: number[] = [];
    let last = s.youAt;
    for (let i = 0; i < 50; i++) {
      s = v.sing(s, 20, (t) => E3 + (-40 + 20 * Math.sin((2 * Math.PI * 7 * t) / 1000)) / 100);
      if (s.youAt !== last) {
        seen.push(s.youAt!);
        last = s.youAt;
      }
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]! - seen[i - 1]!).toBeGreaterThanOrEqual(YOU_REFRESH_MS);
    expect(seen.length).toBeGreaterThanOrEqual(3);
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
    const s = run(listening('voice-baritone', E3), quiet(NOT_HEARD_MS));
    expect(s.phase).toBe('not-heard');
  });

  it('counts 6 s from the last steady pitch and clears the hold', () => {
    const v = new Voice(1000);
    let s = v.hold(listening('voice-baritone', E3), 500, E3, 50);
    expect(s.phase).toBe('sharp');
    s = run(s, { type: 'tick', t: v.t + NOT_HEARD_MS });
    expect(s.phase).toBe('not-heard');
    expect(s.farSince).toBeNull();
  });

  it('recovers when a steady pitch comes back', () => {
    const s = run(listening('voice-baritone', E3), { type: 'tick', t: NOT_HEARD_MS });
    expect(s.phase).toBe('not-heard');
    expect(sung(s, 2000, E3, 0, NOT_HEARD_MS + 100).phase).toBe('hit');
  });
});

describe('too far', () => {
  it('needs more than 3 semitones for 2 s: too low says higher, too high says lower', () => {
    const v = new Voice();
    let s = v.hold(listening('voice-baritone', E3), 1000, E3 - 4);
    expect(s.phase).toBe('flat');
    s = v.hold(s, FAR_MS + 100, E3 - 4);
    expect(s.phase).toBe('far-up');
    s = v.hold(s, 300, E3 - 4);
    expect(s.phase).toBe('far-up');
    expect(sung(listening('voice-baritone', E3), FAR_MS + 300, E3 + 4).phase).toBe('far-down');
  });

  it('exactly 3 semitones is not far', () => {
    expect(sung(listening('voice-baritone', E3), FAR_MS + 500, E3 + 3).phase).toBe('sharp');
  });

  it('starts again when the player comes back inside 3 semitones', () => {
    const v = new Voice();
    let s = v.hold(listening('voice-baritone', E3), 1500, E3 - 4);
    s = v.hold(s, 600, E3 - 1);
    expect(s.farSince).toBeNull();
    s = v.hold(s, 1500, E3 - 4);
    expect(s.phase).toBe('flat');
    s = v.hold(s, 1000, E3 - 4);
    expect(s.phase).toBe('far-up');
  });

  it('a voice is judged octave-free, so an octave and 4 semitones high is 4 semitones away', () => {
    expect(sung(listening('voice-bass', E3), FAR_MS + 300, E3 + 12 - 4).phase).toBe('far-up');
  });

  it('an instrument is far when more than 3 semitones off in its own octave', () => {
    expect(sung(listening('flute', 72), FAR_MS + 300, 72 + 5, 0, 0, 'balanced').phase).toBe('far-down');
  });
});

describe('octaves (T13, T14)', () => {
  it('baritone singing E2 against E3: no octave line (E2 is below G2), and it counts', () => {
    const v = new Voice();
    const s = v.hold(listening('voice-baritone', E3), 600, E2, 5);
    expect(s.phase).toBe('in-band');
    expect(s.octave).toBeNull();
    const hit = v.hold(s, 1000, E2, 5);
    expect(hit.phase).toBe('hit');
    expect(hit.octave).toBeNull();
    expect(hit.results[0]!.cents).toBeCloseTo(5, 5);
  });

  it('T13 bass singing E2 against E3: octave lower, needle 0, a hit with the line kept', () => {
    const v = new Voice();
    const s = v.hold(listening('voice-bass', E3), 600, E2);
    expect(s.phase).toBe('octave-lower');
    expect(s.octave).toBe('lower');
    expect(s.needle).toBe(0);
    const hit = v.hold(s, 1000, E2);
    expect(hit.phase).toBe('hit');
    expect(hit.octave).toBe('lower');
  });

  it('shows octave higher inside the full range and not above it', () => {
    expect(sung(listening('voice-bass', E3), 600, E3 + 12).phase).toBe('octave-higher');
    expect(sung(listening('voice-baritone', E3), 600, E3 + 12).octave).toBe('higher');
    /* Baritone top is G4 (67): two octaves above G3 is out of range, so no octave line. */
    expect(sung(listening('voice-baritone', 55), 600, 55 + 24).phase).toBe('in-band');
  });

  it('keeps flat and sharp for an octave-shifted voice', () => {
    const s = sung(listening('voice-bass', E3), 600, E2, -45);
    expect(s.phase).toBe('flat');
    expect(s.octave).toBe('lower');
  });

  it('T14 an instrument in the wrong octave hears "wrong octave" and never hits; the right octave then can', () => {
    const v = new Voice(0, 'balanced');
    let s = v.hold(listening('flute', 72), 3000, 60);
    expect(s.phase).toBe('wrong-octave');
    expect(s.octave).toBeNull();
    expect(s.results).toEqual([]);
    s = v.hold(s, 2000, 72);
    expect(s.phase).toBe('hit');
  });

  it('an instrument a long way off in another octave is measured against the target, not called wrong octave', () => {
    expect(sung(listening('flute', 72), 600, 60 + 3, 0, 0, 'balanced').phase).toBe('flat');
  });
});

describe('rounds', () => {
  const baritone = (mode: MatchMode = 'practice') => initialMatchState(inst('voice-baritone'), cfg, mode);

  /** Play and hit the current note at `start`; returns the state and the time of the hit. */
  function hit(s: MatchState, start: number, cents = 0): { s: MatchState; at: number } {
    const out = run(s, { type: 'played', t: start });
    const h = sung(out, 1500, out.target, cents, start);
    return { s: h, at: h.hitAt! };
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
    expect(next.settled).toBeNull();
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
    expect(s.summary?.hit).toBe(5);
    expect(s.summary?.meanCents).toBeCloseTo(-10, 5);
    expect(s.summary).toMatchObject({ total: 5, cents: 10, direction: 'flat' });
    expect(run(s, quiet(0), { type: 'tick', t: 1e9 }, { type: 'next' })).toBe(s);
  });

  it('says sharp for a high mean and centre for a mean that rounds to zero, and nothing with no hits', () => {
    const sharp = hit(baritone(), 0, 12);
    const endSharp = run({ ...sharp.s, index: 4 }, { type: 'next' });
    expect(endSharp.summary).toMatchObject({ hit: 1, total: 1, cents: 12, direction: 'sharp' });

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

    const mid = sung(run(baritone(), { type: 'played', t: 0 }), 300, E3, -40);
    const replay = run(mid, { type: 'again' });
    expect(replay.phase).toBe('idle');
    expect(replay.target).toBe(mid.target);
    expect(replay.you).toBeNull();
    expect(replay.judge.inTune).toBe(false);
    expect(replay.index).toBe(0);
  });

  it('a chosen chip stays: a hit does not move on and is not counted in the round', () => {
    let s = run(baritone(), { type: 'choose-note', midi: 57 });
    expect(s.chosen).toBe(true);
    expect(s.target).toBe(57);
    expect(s.phase).toBe('idle');
    s = sung(run(s, { type: 'played', t: 0 }), 1500, 57);
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
    let s = sung(listening('voice-baritone', E3, 'onboarding'), 1500, E3);
    expect(s.phase).toBe('hit');
    expect(s.results).toEqual([]);
    s = run(s, { type: 'tick', t: 1e7 }, { type: 'next' });
    expect(s.phase).toBe('hit');
    expect(s.target).toBe(E3);
    expect(s.index).toBe(0);
    expect(s.summary).toBeNull();
  });

  it('notes a voice that sits above or below the range after 2 s too far', () => {
    const v = new Voice();
    const above = v.hold(listening('voice-baritone', 48, 'onboarding'), 1500, 64);
    expect(above.otherVoice).toBeNull();
    expect(v.hold(above, 800, 64).otherVoice).toBe('above');
    expect(sung(listening('voice-baritone', 60, 'onboarding'), FAR_MS + 300, 44).otherVoice).toBe('below');
  });

  it('does not suggest another voice when the far note is inside the range, in practice, or for an instrument', () => {
    expect(sung(listening('voice-baritone', 49, 'onboarding'), FAR_MS + 300, 57).otherVoice).toBeNull();
    expect(sung(listening('voice-baritone', 48), FAR_MS + 300, 64).otherVoice).toBeNull();
    expect(sung(listening('flute', 72, 'onboarding'), FAR_MS + 300, 80, 0, 0, 'balanced').otherVoice).toBeNull();
  });
});

describe('the hit rule is the steady filter’s, not every frame’s', () => {
  it('HIT_HOLD_MS is the filter’s hit hold', () => {
    expect(HIT_HOLD_MS).toBe(STEADINESS_PRESETS.steady.hitMs);
  });
});
