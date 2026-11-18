/**
 * Render streams (01 §14 item 11): time-stamped FollowerEvent streams plus a final alignment for 8 fixture-corpus
 * excerpts (4 clefs, 6 meters, pickups, ties, triplets, transposing instruments), so the overlay and the screens can
 * be built and visually tested with no audio. Events come from the reference follower (`oracle.ts`).
 */
import type { PerformSpec } from './perform.ts';
import { corpusBase, type Base } from './scenario.ts';

export interface RenderScenario {
  id: string;
  description: string;
  base: () => Base;
  spec: PerformSpec;
}

const omit = (...idx: number[]): PerformSpec['mods'] => Object.fromEntries(idx.map((i) => [i, { omit: true }]));

export const RENDER_SCENARIOS: RenderScenario[] = [
  {
    id: 'le-beau-flute-restart',
    description: 'Flute, L4, 90 bpm, treble clef, 4/4 with a pickup, written A major. Note 3 late 150 ms; after bar 6 beat 2 the player goes back two beats (replay ghosts, lost-place, rejoined at bar 8).',
    base: () => corpusBase('le-beau-lc5883655-voice-mp1-9', 'flute', 90),
    spec: { mods: { 3: { shiftMs: 150 }, ...omit(24, 25, 26, 27, 28, 29, 30, 31) }, replays: [{ from: 22, to: 27, offsetBeats: -2 }] },
  },
  {
    id: 'mayer-flute-s1-mix',
    description: 'Flute, L4, 90 bpm, 4/4, ties and slurred runs. The S1 thin-slice perturbations: note 3 late 150 ms, note 6 a semitone wrong, note 9 omitted, an extra in the bar 2 rest; plus note 18 sharp 48 c.',
    base: () => corpusBase('mayer-sq8915514-viola-mv1-m13-20', 'flute', 90),
    spec: { mods: { 3: { shiftMs: 150 }, 6: { semis: 1, cents: 0 }, 9: { omit: true }, 18: { cents: 48 } }, extras: [{ atBeat: 6, durBeats: 1, midi: 71, duringRest: true }] },
  },
  {
    id: 'holmes-voice-octave-flat',
    description: 'Voice (soprano), L2, 72 bpm, 4/4. Bar 2 sung an octave high (correct, octaveDisplaced, no ghost); note 13 48 c flat (red at the end of the note: beyond red 45 c, under the live threshold 55 c).',
    base: () => corpusBase('holmes-lc5855050-voice-m1-8', 'voice-soprano'),
    spec: { mods: { ...Object.fromEntries([5, 6, 7, 8, 9].map((i) => [i, { octaves: 1 }])), 13: { cents: -48 } } },
  },
  {
    id: 'haydn-clarinet-fast',
    description: 'B♭ clarinet (transposing: written a major second above concert), L7, 100 bpm, 2/4 with a pickup and sixteenth runs. Note 14 late 70 ms; note 30 played a whole tone high.',
    base: () => corpusBase('haydn-lc6472842-voice-mp117-127', 'clarinet-bb'),
    spec: { mods: { 14: { shiftMs: 70 }, 30: { semis: 2, cents: 0 } } },
  },
  {
    id: 'gouvy-cello-compound',
    description: 'Cello, L5, 6/8 at dotted quarter = 40, bass clef, a tie across the barline. Note 9 early 220 ms (tRed 200 ms: at dotted quarter = 40 the beat is 1.5 s); note 15 sharp 48 c; note 22 missed.',
    base: () => corpusBase('gouvy-sq10406164-cello-mv3-m1-10', 'cello'),
    spec: { mods: { 9: { shiftMs: -220 }, 15: { cents: 48 }, 22: { omit: true } } },
  },
  {
    id: 'mozart-violin-stop',
    description: 'Violin, L6, 100 bpm, 3/4 with a pickup, a triplet and ties. The player stops for bars 6 and 7 (notes 12 to 20) and comes back on time at bar 8 ("come in at" hint), and plays note 3 a semitone low.',
    base: () => corpusBase('mozart-sq35524196-violin1-mv2-mp16-28', 'violin'),
    spec: { mods: { 3: { semis: -1, cents: 0 }, ...omit(12, 13, 14, 15, 16, 17, 18, 19, 20) } },
  },
  {
    id: 'arriaga-sax-cut-time',
    description: 'Alto sax (transposing: written a major sixth above concert), L5, 2/2 at half = 72, slurred runs and repeated notes. Note 2 early 180 ms (tRed 142 ms at half = 72), notes 10 and 11 missed, an extra in the rest after note 20 (bar 7).',
    base: () => corpusBase('arriaga-sq34038344-viola-mv4-m154-163', 'sax-alto'),
    spec: { mods: { 2: { shiftMs: -180 }, ...omit(10, 11) }, extras: [{ atBeat: 13.25, durBeats: 0.5, midi: 58, duringRest: true }] },
  },
  {
    id: 'faure-cello-tenor-clef',
    description: 'Cello, L8, 80 bpm, 4/4, tenor clef (cello from L7). Note 6 played an octave low (octave error, R20); note 14 flat 48 c; a clipped wrong note before note 17 that live takes for note 17 and the final alignment overturns (rejudged).',
    base: () => corpusBase('faure-sq7358708-cello-mv3-m67-74', 'cello'),
    spec: { mods: { 6: { octaves: -1, altOctaveClarity: 0.3 }, 14: { cents: -48 } }, blips: [{ idx: 17, atMs: -150, durMs: 120, semis: 2 }] },
  },
];
