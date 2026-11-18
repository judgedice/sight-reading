/**
 * The grade fixtures (01 §14 item 10): inputs for 02 §4.9's acceptance cases, plus the stop / restart / skip
 * rules of 02 §4.6, with assertion predicates. Inputs are complete `GradeInput`s minus cfg, instrument and
 * tolerances (the test resolves those from config/). The alignment inside each input is the final alignment the
 * reference follower (`oracle.ts`) produces for the scripted performance, with 02 §4.3 credits filled in, so a
 * grader that recomputes credits from the raw fields and one that reads them agree.
 *
 * Predicates over components, score, grade, gate, counts, stops, restarts, drift and tolerances are re-checked
 * against `reference.ts` by the fixture test. Pattern, ranking and XP predicates are the spec's own statements
 * (02 §4.9, §5.2, §5.4, §6.2) and are checked only by P12 / P12b.
 */
import type { GateId, GradeFixture, GradeInput, Predicate } from '../../../src/core/types.ts';
import { P } from '../../../src/testkit/predicates/index.ts';
import { sp, type SynthItem } from './expected.ts';
import type { PerformSpec } from './perform.ts';
import { configs } from './io.ts';
import { RefVoiceDrift, refDiagnostics, refScore, refTolerances } from './reference.ts';
import { corpusBase, run, syntheticBase, type Base, type Run } from './scenario.ts';

export interface GradeScenario {
  id: string;
  case: number;
  description: string;
  base: () => Base;
  spec: PerformSpec | ((b: Base) => PerformSpec);
  calibrationMeasured?: boolean;
  gateFailures?: GateId[];
  expect: (r: Run) => Predicate[];
}

const LEBEAU = 'le-beau-lc5883655-voice-mp1-9';
const lebeau = (): Base => corpusBase(LEBEAU, 'flute', 90);
const mayerL1 = (): Base => corpusBase('mayer-sq7588853-violin1-mv4-m253-260', 'flute', 80);
/**
 * 02 §4.9 case 4 needs evenly spaced notes: on the front-loaded Mayer line (14 of 25 notes in bars 1 to 3) the
 * same drift gives R = 65, above the case's R ≤ 60. Eight bars of quarters give R = 56.
 */
const quarters8 = (): Base =>
  syntheticBase('synthetic-quarters-8-bars', 'flute', 4, 80, { fifths: 0, mode: 'major' }, 4, Array.from({ length: 32 }, (_, k) => ({ w: sp(SCALE_Q[k % 8]!), beats: 1 })));
const SCALE_Q = ['C5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5'];

const ref = (r: Run) => refScore(r.final, r.base.inst, r.base.level, r.cfg);
const pct = (x: number): string => x.toFixed(3);

function perfectPredicates(r: Run): Predicate[] {
  return [
    P.eq('score.components.P', 100, 'every p = 1, no extras: 100 × N / N (02 §4.4)'),
    P.eq('score.components.I', 100, 'every intonation-graded note within ±3 c ≤ good (02 §4.3)'),
    P.eq('score.components.R', 100, 'every |Δ| ≤ 4 ms ≤ tGood and every held ratio 0.92 ≥ 0.70 (02 §4.3)'),
    P.eq('score.score', 100),
    P.eq('score.grade', 'S', '97–100 (02 §4.7)'),
    P.eq('score.stars', 3),
    P.eq('score.shine', true),
    P.eq('score.status', 'ok'),
    P.onlyFires(['E30'], 'score ≥ 90 and no other pattern (02 §6.2); perfect takes fire only E30 (02 §4.9 case 1)'),
    P.eq('score.ranked', true, 'every 02 §5.2 condition holds in the input'),
    P.length('score.rankedReasons', 0),
    P.eq('score.diagnostics.counts.missed', 0),
    P.eq('score.diagnostics.counts.extra', 0),
    P.eq('score.diagnostics.matched', r.base.expected.length),
    P.length('score.diagnostics.stops', 0),
    P.length('score.diagnostics.restarts', 0),
  ];
}

const tolLine = (b: number[], pitches: string[]): SynthItem[] => b.map((beats, k) => ({ w: sp(pitches[k % pitches.length]!), beats }));
const SCALE = ['C5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5'];

interface TolRow {
  idx: number;
  label: string;
  ms: [number, number, number];
  w: number;
}
function tolCase(id: string, inst: string, level: number, bpm: number, rhythm: number[], rows: TolRow[], label: string): GradeScenario {
  return {
    id: `case12-tolerance-${id}`,
    case: 12,
    description: `02 §4.2 worked examples, ${label}: resolveTolerance must reproduce the table (values in ms, table rounded to 1 ms).`,
    base: () => syntheticBase(`synthetic-tolerance-${id}`, inst, level, bpm, { fifths: 0, mode: 'major' }, 4, tolLine(rhythm, SCALE)),
    spec: {},
    expect: () =>
      rows.flatMap((row) => [
        P.approx(`tolerances[${row.idx}].tGoodSec`, row.ms[0] / 1000, 0.0005, `${row.label}: tGood ${row.ms[0]} ms (02 §4.2 worked examples)`),
        P.approx(`tolerances[${row.idx}].tRedSec`, row.ms[1] / 1000, 0.0005, `${row.label}: tRed ${row.ms[1]} ms`),
        P.approx(`tolerances[${row.idx}].tBadSec`, row.ms[2] / 1000, 0.0005, `${row.label}: tBad ${row.ms[2]} ms`),
        P.approx(`tolerances[${row.idx}].matchWindowSec`, row.w / 1000, 0.0005, `${row.label}: W ${row.w} ms (02 §4.1)`),
      ]),
  };
}

export const GRADE_SCENARIOS: GradeScenario[] = [
  {
    id: 'case01-perfect-flute-l4',
    case: 1,
    description: 'Perfect performance: Le Beau, flute, L4, 90 bpm, every note on time (≤ 4 ms) and in tune (≤ 3 c), held 92%.',
    base: lebeau,
    spec: {},
    expect: perfectPredicates,
  },
  {
    id: 'case01-perfect-voice-l2',
    case: 1,
    description: 'Perfect performance at another level and family: Holmes, voice (soprano), L2, 72 bpm.',
    base: () => corpusBase('holmes-lc5855050-voice-m1-8', 'voice-soprano'),
    spec: {},
    expect: perfectPredicates,
  },
  {
    id: 'case02-late-30ms-l1',
    case: 2,
    description: 'Every onset exactly 30 ms late: Mayer quartet line, flute, L1, 80 bpm (all notes a beat or longer).',
    base: mayerL1,
    spec: { globalShiftMs: 30, jitterMs: [0] },
    expect: (r) => [
      P.eq('score.components.R', 100, `30 ms ≤ tGood ${(r.tol[0]!.tGoodSec * 1000).toFixed(0)} ms (L1: max(60, 0.12 × 750)) → o = 1; durations held → d = 1 (02 §4.9 case 2)`),
      P.eq('score.diagnostics.counts.late', 0, '30 ms ≤ tRed: no note is late'),
      P.notFires('E2', 'a constant offset has zero slope; timing patterns use offsets relative to the median Δ (02 §6.1)'),
      P.notFires('E29', 'relative to the median Δ the first entry is on time (02 §6.1, §6.2)'),
    ],
  },
  {
    id: 'case03-late-by-tbad',
    case: 3,
    description: 'Every onset late by exactly its tBad, durations held: Mayer, flute, L1, 80 bpm; every note is duration-graded except the last.',
    base: mayerL1,
    spec: (b) => {
      const tol = refTolerances(b.expected, b.inst, b.level, b.bpm, configs());
      return { jitterMs: [0], mods: Object.fromEntries(tol.map((t, i) => [i, { shiftMs: t.tBadSec * 1000 }])) };
    },
    expect: (r) => [
      P.approx('score.components.R', 20, 0.01, 'o = 0 at |Δ| = tBad, d = 1: R = 100 × (0.8 × 0 + 0.2 × 1) = 20 (02 §4.4, §4.9 case 3)'),
      P.eq('score.diagnostics.counts.late', r.base.expected.length, 'tBad 225 ms > tRed 150 ms: every note late (02 §4.8)'),
      P.eq('score.diagnostics.counts.missed', 0, 'tBad ≤ W (02 §4.1): still matched'),
      P.eq('score.components.P', 100),
    ],
  },
  {
    id: 'case04-drift-0.05',
    case: 4,
    description: 'Linear drift +0.05 beat per bar over 8 bars: 8 bars of quarters, flute, L4, 80 bpm (0.4 beat = 300 ms behind at the end of bar 8; every note inside its W 375 ms).',
    base: quarters8,
    spec: { driftBeatsPerBar: 0.05, jitterMs: [0] },
    expect: (r) => {
      const s = ref(r);
      return [
        P.le('score.components.R', 60, `02 §4.9 case 4: R ≤ 60 (reference: ${pct(s.R)})`),
        P.eq('score.diagnostics.counts.missed', 0, 'Δ ≤ 0.05 × 7.75 bars × 750 = 291 ms on the last quarter, inside W = max(187.5, min(375, 375)) = 375 ms'),
        P.gt('score.diagnostics.driftMsAtEnd', 0, 'behind = positive (01 §6.5)'),
        ...P.between('score.diagnostics.driftMsAtEnd', 260, 320, 'slope 0.05 beat/bar × 750 ms = 37.5 ms per bar, × 8 bars = 300 ms (02 §4.6); 291 if counted to the last onset'),
        P.fires('E2', 'slope +0.05 ≥ +0.04 beat/bar, total drift 0.39–0.4 beat ≥ max(tRed 0.17 beat, 0.25 beat), r² = 1, 32 notes over 8 bars (02 §6.2)'),
        P.notFires('E1'),
      ];
    },
  },
  {
    id: 'case04-drift-0.15',
    case: 4,
    description:
      'Larger drift, +0.15 beat per bar (112.5 ms per bar at 80 bpm): later notes fall past W and are no longer judged late (02 §4.9 case 4, second part). Note: under the 01 §9.6 DP a played note that slips past its own W lands inside the next note\'s W and matches it as a wrong pitch (cost ≤ 9 < 11), so the reference alignment has 1 missed note, 17 wrong-pitch matches and 1 extra rather than a run of missed notes. The predicates assert only what both readings share.',
    base: quarters8,
    spec: { driftBeatsPerBar: 0.15, jitterMs: [0] },
    expect: (r) => {
      const s = ref(r);
      return [
        P.ge('score.diagnostics.counts.missed', 1, `the first note past W is missed (reference alignment: ${s.counts.missed} missed, ${s.counts.late} late, ${s.counts.wrong} wrong, ${s.counts.extra} extra)`),
        P.le('score.diagnostics.counts.late', 14, 'only notes with Δ = 28.1 ms × k ≤ W 375 ms (k ≤ 13) can be late against their own note'),
        P.lt('score.components.R', ref(run(quarters8(), { driftBeatsPerBar: 0.05, jitterMs: [0] })).R, 'worse than the 0.05 beat/bar drift'),
      ];
    },
  },
  {
    id: 'case05-key-signature-f-sharp',
    case: 5,
    description: 'Every F♯ (written D major key signature) played as F♮: Holmes song line, flute, L4, 66 bpm; notes 1, 4 and 15 (bars 1, 2 and 6) are the F♯s.',
    base: () => corpusBase('holmes-lc5669865-voice-m55-62', 'flute'),
    spec: { mods: { 1: { semis: -1, cents: 0 }, 4: { semis: -1, cents: 0 }, 15: { semis: -1, cents: 0 } } },
    expect: (r) => {
      const n = r.base.expected.length;
      return [
        P.approx('score.components.P', (100 * (n - 3)) / n, 0.01, `P drops by the share of F♯ notes: 100 × (${n} − 3) / ${n} (02 §4.4, §4.9 case 5)`),
        P.eq('score.diagnostics.counts.wrong', 3),
        P.eq('score.components.R', 100, 'wrong notes in time keep onset credit (02 §4.3)'),
        P.fires('E12', 'played = target with the key-signature sharp removed, clear semitone, 3 notes in 3 bars, 100% of the F♯s (02 §6.2)'),
        P.eq('patterns[id=E12][0].notes', [1, 4, 15]),
        P.notFires('E13', 'the F♯s come from the key signature, not written accidentals'),
      ];
    },
  },
  {
    id: 'case06-stop-2-beats-bar-5',
    case: 6,
    description:
      'A 2-beat silence at the start of bar 5, not covered by rests: Le Beau, flute, L4, 90 bpm. Note 16 is held to the barline, notes 17 (F♯5, 1.5 beats) and 18 (B4, eighth) are not played, the player comes back on beat 3.',
    base: lebeau,
    spec: { mods: { 16: { heldFrac: 1.02 }, 17: { omit: true }, 18: { omit: true } } },
    expect: (r) => {
      const s = ref(r);
      return [
        P.length('score.diagnostics.stops', 1, 'silence ≥ max(1 beat, 600 ms) with missed notes (02 §4.6)'),
        P.eq('score.diagnostics.stops[0].bar', 5),
        P.approx('score.diagnostics.stops[0].beats', 2, 0.1, 'from the barline (+0.02 beat) to beat 3'),
        P.fires('E6', 'a stop (02 §6.2)'),
        P.approx('score.components.P', (100 * 31) / 33, 0.01, 'P drops only by the missed share: 100 × 31 / 33 (02 §4.9 case 6)'),
        P.approx('score.components.R', s.R, 0.01, `R drops only by the missed notes: 100 × (0.8 × 31/33 + 0.2 × mean d), where unplayed note 17 (1.5 beats, duration-graded) has h = 0 → d = 0 (02 §4.3) → ${pct(s.R)}`),
        P.eq('score.diagnostics.counts.missed', 2),
        P.eq('score.diagnostics.counts.extra', 0),
        P.eq('score.status', 'ok'),
      ];
    },
  },
  {
    id: 'case07-voice-30c-flat',
    case: 7,
    description:
      'Voice uniformly 30 cents flat with drift compensation: Haydn song, voice (soprano), L7, 100 bpm, 43 notes. The drift reference reaches −30 c after two notes (15 c per note limit), so later notes are in tune against it.',
    base: () => corpusBase('haydn-lc6472842-voice-mp117-127', 'voice-soprano'),
    spec: { globalCents: -30, centsPattern: [0] },
    expect: (r) => [
      P.ge('score.components.I', 90, `02 §4.9 case 7 (reference: ${pct(ref(r).I ?? NaN)})`),
      P.eq('score.diagnostics.counts.flat', 0, 'first note −30 c vs red 35 c at L7 voice: marginal, not flat; then the offset absorbs it'),
      P.notFires('E23', '|final offset| 30 < 40 c (02 §6.2)'),
      P.notFires('E22', 'E22 is not for voice (02 §6.2)'),
      P.approx('score.diagnostics.voiceDriftCents', -30, 1, 'median of the last 4 correct notes, limited to 15 c per note (02 §4.5)'),
    ],
  },
  {
    id: 'case08-voice-octave-low',
    case: 8,
    description:
      'Voice singing every note an octave low: Holmes, voice (soprano), L2, 72 bpm. (Grade-level fixture: the soprano detection range would not reach this low; the case tests octave equivalence in grading only.)',
    base: () => corpusBase('holmes-lc5855050-voice-m1-8', 'voice-soprano'),
    spec: { globalOctaves: -1 },
    expect: () => [
      P.eq('score.components.P', 100, 'R7: octave displacement earns full pitch credit (02 §4.3)'),
      P.eq('score.diagnostics.counts.wrong', 0),
      P.eq('score.diagnostics.counts.octave', 0, 'no red states (02 §4.9 case 8)'),
      P.eq('score.diagnostics.counts.sharp', 0),
      P.eq('score.diagnostics.counts.flat', 0),
      P.eq('score.diagnostics.counts.early', 0),
      P.eq('score.diagnostics.counts.late', 0),
      P.ge('score.score', 90),
      P.onlyFires(['E30'], 'no pattern except E30 when score ≥ 90; octave displacement fires no pattern (02 §4.3)'),
    ],
  },
  {
    id: 'case09-trumpet-wrong-partial',
    case: 9,
    description:
      'Trumpet plays written G5 instead of written C6 twice (both open: partials 6 and 8 in data/trumpet-valves.json, partial 7 unused): synthetic L9 line, 100 bpm, written C major. C6 is notes 4 and 11.',
    base: () =>
      syntheticBase('synthetic-trumpet-partials', 'trumpet-bb', 9, 100, { fifths: 0, mode: 'major' }, 4, [
        ...['E5', 'F5', 'G5', 'A5'].map((w) => ({ w: sp(w), beats: 1 })),
        { w: sp('C6'), beats: 2 },
        { w: sp('B5'), beats: 1 },
        { w: sp('A5'), beats: 1 },
        ...['G5', 'F5', 'E5', 'D5'].map((w) => ({ w: sp(w), beats: 1 })),
        { w: sp('C6'), beats: 2 },
        { w: sp('G5'), beats: 2 },
        { w: sp('E5'), beats: 1 },
        { w: sp('D5'), beats: 1 },
        { w: sp('C5'), beats: 2 },
      ]),
    spec: { mods: { 4: { semis: -5, cents: 0 }, 11: { semis: -5, cents: 0 } } },
    expect: () => [
      P.eq('score.diagnostics.counts.wrong', 2, 'a wrong partial is a wrong pitch (02 §4.5)'),
      P.fires('E16', 'same valve combination (open), adjacent partial in the valve table, not an octave; 2 notes (02 §6.2)'),
      P.eq('patterns[id=E16][0].notes', [4, 11]),
    ],
  },
  {
    id: 'case10-incomplete',
    case: 10,
    description: 'Fewer than half the notes matched: Le Beau, flute, L4, 90 bpm; the player stops (ranked, after the first note) at bar 4 and plays nothing more: 15 of 33 notes matched.',
    base: lebeau,
    spec: { mods: Object.fromEntries(Array.from({ length: 18 }, (_, k) => [15 + k, { omit: true }])) },
    expect: () => [
      P.eq('score.status', 'incomplete', 'matched / N = 15 / 33 = 0.45 < 0.5 (02 §4.7)'),
      P.le('score.score', 50, 'score = min(score, 50) (02 §4.7)'),
      P.eq('score.diagnostics.matched', 15),
      P.eq('score.xp.total', 0, 'incomplete attempts earn 0 XP (02 §5.4)'),
      P.onlyFires(['E6'], 'incomplete attempts may fire only E6 (02 §6.1); the silence to the end is a stop'),
    ],
  },
  {
    id: 'case11-restart',
    case: 11,
    description:
      'Restart: after bar 4 the player goes back and replays bar 3 and the bar 4 downbeat (notes 10 to 15, 6 notes) in bars 5 and 6, then comes in on time at bar 7. Le Beau, flute, L4, 90 bpm.',
    base: lebeau,
    spec: { mods: Object.fromEntries([16, 17, 18, 19, 20, 21, 22, 23, 24, 25].map((i) => [i, { omit: true }])), replays: [{ from: 10, to: 15, offsetBeats: -8 }] },
    expect: () => [
      P.length('score.diagnostics.restarts', 1, 'one displaced segment (02 §4.6)'),
      P.eq('score.diagnostics.restarts[0].bar', 3, 'the first replayed note is in bar 3'),
      P.eq('score.diagnostics.restarts[0].notesReplayed', 6),
      P.approx('score.diagnostics.restarts[0].offsetBeats', -8, 0.1),
      P.eq('score.diagnostics.counts.extra', 0, 'replayed notes are excluded from the extras term (02 §4.1, §4.6)'),
      P.approx('score.components.P', (100 * 23) / 33, 0.01, 'P = 100 × 23 / (33 + 0.5 × 0): the extras term is unchanged by the replay'),
      P.eq('score.diagnostics.counts.missed', 10, 'covered current notes 16 to 25 are missed (02 §4.3)'),
      P.fires('E6', 'a displaced segment (02 §6.2)'),
    ],
  },
  tolCase('trumpet-l1-60', 'trumpet-bb', 1, 60, [1, 1, 1, 1, 1, 1, 1, 1], [{ idx: 3, label: 'Trumpet L1, 60 bpm, quarters', ms: [120, 200, 300], w: 500 }], 'trumpet L1 60 bpm'),
  tolCase('trumpet-l1-132', 'trumpet-bb', 1, 132, [1, 1, 1, 1, 1, 1, 1, 1], [{ idx: 3, label: 'Trumpet L1, 132 bpm (formula check)', ms: [60, 100, 150], w: 227 }], 'trumpet L1 132 bpm'),
  tolCase(
    'trumpet-l5-60',
    'trumpet-bb',
    5,
    60,
    [1, 1, 1, 1, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 1, 1],
    [
      { idx: 2, label: 'Trumpet L5, 60 bpm, quarters', ms: [100, 170, 250], w: 500 },
      { idx: 7, label: 'Trumpet L5, 60 bpm, sixteenths', ms: [75, 100, 125], w: 125 },
    ],
    'trumpet L5 60 bpm',
  ),
  tolCase(
    'trumpet-l5-132',
    'trumpet-bb',
    5,
    132,
    [1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1],
    [
      { idx: 2, label: 'Trumpet L5, 132 bpm, quarters', ms: [50, 85, 120], w: 227 },
      { idx: 7, label: 'Trumpet L5, 132 bpm, eighths', ms: [50, 85, 114], w: 114 },
    ],
    'trumpet L5 132 bpm',
  ),
  tolCase(
    'trumpet-l9-60',
    'trumpet-bb',
    9,
    60,
    [1, 1, 1, 1, 0.25, 0.25, 0.25, 0.25, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 1, 1],
    [
      { idx: 2, label: 'Trumpet L9, 60 bpm, quarters', ms: [80, 140, 200], w: 500 },
      { idx: 5, label: 'Trumpet L9, 60 bpm, sixteenths', ms: [75, 100, 125], w: 125 },
      { idx: 11, label: 'Trumpet L9, 60 bpm, 32nds (floor)', ms: [40, 60, 90], w: 90 },
    ],
    'trumpet L9 60 bpm',
  ),
  tolCase(
    'trumpet-l9-132',
    'trumpet-bb',
    9,
    132,
    [1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 1 / 3, 1 / 3, 1 / 3, 1 / 3, 1 / 3, 1 / 3, 1, 1],
    [
      { idx: 2, label: 'Trumpet L9, 132 bpm, quarters', ms: [40, 70, 100], w: 227 },
      { idx: 5, label: 'Trumpet L9, 132 bpm, eighths', ms: [40, 70, 100], w: 114 },
      { idx: 10, label: 'Trumpet L9, 132 bpm, triplet eighths (floor)', ms: [40, 61, 90], w: 90 },
    ],
    'trumpet L9 132 bpm',
  ),
  tolCase('violin-l9-132', 'violin', 9, 132, [1, 1, 1, 1, 1, 1, 1, 1], [{ idx: 3, label: 'Violin L9, 132 bpm, quarters (soft floor)', ms: [55, 85, 120], w: 227 }], 'violin L9 132 bpm'),
  tolCase('voice-l9-132', 'voice-soprano', 9, 132, [1, 1, 1, 1, 1, 1, 1, 1], [{ idx: 3, label: 'Voice L9, 132 bpm, quarters (soft floor)', ms: [55, 85, 120], w: 227 }], 'voice L9 132 bpm'),
  {
    id: 'case13-short-steady-flute',
    case: 13,
    description: 'A note with 140 ms of steady pitch on flute: Le Beau, flute, L4, 90 bpm; note 4 (eighth) sounded 190 ms (50 ms attack excluded) and 44 c sharp. No intonation grade, no sharp state.',
    base: lebeau,
    spec: { mods: { 4: { cents: 44, durMs: 190 } } },
    expect: () => [
      P.eq('score.diagnostics.counts.sharp', 0, '140 ms < intonationMinSteadyMs 150: no sharp or flat state (02 §4.2); graded, 44 c would be beyond red 35 c'),
      P.eq('score.components.I', 100, 'note 4 is left out of I; every other note is within ±3 c (02 §4.4)'),
      P.eq('score.components.P', 100, 'the semitone is still graded and right (02 §4.2)'),
    ],
  },
  {
    id: 'case14-reported-calibration',
    case: 14,
    description:
      'A reported-calibration attempt (no measured latency): the case 4 line (8 bars of quarters, flute, L4, 80 bpm) with its drift of +0.05 beat per bar. Graded and shown, unranked with reason calibration, and timing patterns are off.',
    base: quarters8,
    spec: { driftBeatsPerBar: 0.05, jitterMs: [0] },
    calibrationMeasured: false,
    gateFailures: ['calibration-unmeasured'],
    expect: () => [
      P.eq('score.ranked', false, '02 §5.2: calibration not measured for the route'),
      P.includes('score.rankedReasons', 'calibration', "02's rankedReason for a reported or unmeasured calibration (R30)"),
      P.exists('score.score', 'graded and shown (02 §4.2, §4.9 case 14)'),
      P.eq('score.status', 'ok'),
      P.notFires('E2', 'without a measured calibration, timing patterns are off (02 §6.1); the same drift fires E2 in case 4'),
      P.notFires('E1'),
    ],
  },
  {
    id: 'case06-variant-skip-and-rejoin',
    case: 6,
    description:
      'Variant of case 6 under 02 §4.6: skipping and coming in on time at the next downbeat costs only the skipped notes. Le Beau, flute, L4, 90 bpm: notes 11 to 14 (bar 3 beats 2 to 4) dropped, back on time at bar 4.',
    base: lebeau,
    spec: { mods: Object.fromEntries([11, 12, 13, 14].map((i) => [i, { omit: true }])) },
    expect: (r) => {
      const s = ref(r);
      return [
        P.approx('score.components.P', (100 * 29) / 33, 0.01, 'only the 4 skipped notes cost pitch credit: 100 × 29 / 33'),
        P.approx('score.components.R', s.R, 0.01, `only the skipped notes cost rhythm credit (reference ${pct(s.R)})`),
        P.eq('score.diagnostics.counts.missed', 4),
        P.length('score.diagnostics.stops', 1, 'about 3 beats of silence with missed notes ≥ max(1 beat, 600 ms) (02 §4.6)'),
        P.eq('score.diagnostics.stops[0].bar', 3),
        P.length('score.diagnostics.restarts', 0, 'no displacement'),
        P.fires('E6', 'the recovery we teach still reports the stop (02 §4.6, E6)'),
      ];
    },
  },
  {
    id: 'case11-variant-skip-ahead',
    case: 11,
    description:
      'Variant of case 11 under 02 §4.6 / 01 §9.6: skipping ahead is a displaced segment. Le Beau, flute, L4, 90 bpm: on bar 1 beat 3 the player plays notes 8 to 12 one bar early, then rejoins on bar 2 beat 3 and plays on correctly. Current notes 3 to 7 missed; the early run earns nothing and is not an extra.',
    base: lebeau,
    spec: { mods: Object.fromEntries([3, 4, 5, 6, 7].map((i) => [i, { omit: true }])), replays: [{ from: 8, to: 12, offsetBeats: 4 }] },
    expect: () => [
      P.length('score.diagnostics.restarts', 1),
      P.approx('score.diagnostics.restarts[0].offsetBeats', 4, 0.1),
      P.eq('score.diagnostics.restarts[0].notesReplayed', 5),
      P.eq('score.diagnostics.counts.extra', 0),
      P.eq('score.diagnostics.counts.missed', 5),
      P.approx('score.components.P', (100 * 28) / 33, 0.01, '100 × 28 / 33: displaced notes earn no credit and are not extras'),
      P.fires('E6'),
    ],
  },
];

// ------------------------------------------------------------------------------------------------
// Inputs
// ------------------------------------------------------------------------------------------------

export function gradeInput(s: GradeScenario, r: Run): GradeFixture['input'] {
  const inst = r.base.inst;
  let voiceReference: GradeInput['voiceReference'] = null;
  if (inst.relativePitch) {
    const drift = new RefVoiceDrift(r.cfg);
    const third = Math.floor(r.base.expected.length / 3);
    let atThird = 0;
    r.final.judgments.forEach((j, k) => {
      const off = drift.offsetCents();
      if (j.credit.p === 1 && j.centsError !== null) drift.observe(j.centsError + off, true);
      if (k === third - 1) atThird = drift.offsetCents();
    });
    voiceReference = { finalOffsetCents: drift.offsetCents(), offsetAtThirdCents: atThird };
  }
  return {
    expected: r.base.expected,
    alignment: r.final,
    detected: r.detected,
    level: r.base.level,
    bpm: r.base.bpm,
    meter: r.base.meter,
    tuning: inst.relativePitch || inst.pitchKind === 'fixed' ? null : { used: false, offsetCents: 0 },
    voiceReference,
    signal: { medianClarity: 0.95, clippingFrac: 0 },
    calibrationMeasured: s.calibrationMeasured ?? true,
    ranking: { mode: 'ranked', seenBefore: false, scanStrict: true, familiarity: 0, skipLimitHit: false, metronome: 'audible', gateFailures: s.gateFailures ?? [] },
    xp: { playerLevel: r.base.level, randomized: { key: false, meter: false, tempo: false }, streakDays: 0, dailyCountBefore: 0, repeatIndexToday: 0, placement: false },
  };
}

/** Predicates the reference arithmetic can evaluate (the rest need patterns, ranking or XP). */
export const REFERENCE_CHECKABLE = [
  'score.status',
  'score.components',
  'score.weights',
  'score.score',
  'score.grade',
  'score.diagnostics.matched',
  'score.diagnostics.n',
  'score.diagnostics.counts',
  'score.diagnostics.stops',
  'score.diagnostics.restarts',
  'score.diagnostics.driftMsAtEnd',
  'tolerances',
];
export const specOf = (s: GradeScenario, b: Base): PerformSpec => (typeof s.spec === 'function' ? s.spec(b) : s.spec);
export function runGradeScenario(s: GradeScenario): Run {
  const b = s.base();
  return run(b, specOf(s, b));
}

export const isReferenceCheckable = (p: Predicate): boolean => p.op !== 'fires' && p.op !== 'not-fires' && p.op !== 'only-fires' && REFERENCE_CHECKABLE.some((k) => p.path === k || p.path.startsWith(`${k}.`) || p.path.startsWith(`${k}[`));

/** The reference subject for a grade scenario run. */
export function referenceGradeSubject(r: Run): Record<string, unknown> {
  const s = refScore(r.final, r.base.inst, r.base.level, r.cfg);
  const played = r.detected.map((d) => ({ onsetSec: d.onset - r.t0 - r.rtl, endSec: (d.offset ?? d.onset) - r.t0 - r.rtl }));
  const diag = refDiagnostics(r.base.expected, r.final, played, r.base.beatsPerBar, r.base.bpm, r.endSec, r.cfg);
  return {
    score: {
      status: s.status,
      components: { P: s.P, I: s.I, R: s.R },
      weights: s.weights,
      score: s.score,
      grade: s.grade,
      diagnostics: { matched: s.matched, n: s.n, counts: s.counts, stops: diag.stops, restarts: diag.restarts, driftMsAtEnd: diag.driftMsAtEnd },
    },
    tolerances: r.tol,
  };
}
