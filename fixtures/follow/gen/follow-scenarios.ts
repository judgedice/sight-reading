/**
 * The follow fixtures (01 §14 item 9): about 20 DetectedNote streams with predicate expectations for the live
 * event list and the final alignment. Each predicate's `note` gives the rule and the arithmetic; the numbers in it
 * come from config/ through `refTolerances` (02 §4.2) and are printed by `tolText`.
 */
import type { Predicate } from '../../../src/core/types.ts';
import { P } from '../../../src/testkit/predicates/index.ts';
import type { PerformSpec } from './perform.ts';
import { corpusBase, idOf, idsWhere, run, type Base, type Run, type RunOpts } from './scenario.ts';

export interface FollowScenario {
  id: string;
  description: string;
  base: () => Base;
  spec: PerformSpec;
  opts?: RunOpts;
  live: (r: Run) => Predicate[];
  final: (r: Run) => Predicate[];
}

const ms = (s: number): string => (s * 1000).toFixed(1);
export function tolText(r: Run, i: number): string {
  const t = r.tol[i]!;
  const b = r.base;
  return `note ${i} at L${b.level}, ${b.bpm} bpm, ${b.inst.onsetClass} onset: tGood ${ms(t.tGoodSec)} / tRed ${ms(t.tRedSec)} / tBad ${ms(t.tBadSec)} ms, W ${ms(t.matchWindowSec)} ms (02 §4.2 band, IOI caps and floors from grading-config.json)`;
}
const centsText = (r: Run, i: number): string => {
  const t = r.tol[i]!;
  return `L${r.base.level} intonation good ${t.goodCents} c / red ${t.redCents} c; live sharp/flat needs |dev| > red + ${t.liveHysteresisCents} c after ${t.attackExcludeMs} + ${t.liveProvisionalMs} ms (02 §4.2, §4.8)`;
};
const onsetCredit = (r: Run, i: number, absMs: number): number => {
  const t = r.tol[i]!;
  const g = t.tGoodSec * 1000;
  const b = t.tBadSec * 1000;
  return absMs <= g ? 1 : absMs >= b ? 0 : (b - absMs) / (b - g);
};

/** Contiguous [from, to) ranges of indices in 0..n-1 not in `except`. */
function ranges(n: number, except: number[]): [number, number][] {
  const out: [number, number][] = [];
  let a: number | null = null;
  for (let i = 0; i <= n; i++) {
    const ok = i < n && !except.includes(i);
    if (ok && a === null) a = i;
    if (!ok && a !== null) {
      out.push([a, i]);
      a = null;
    }
  }
  return out;
}

const N = (r: Run): number => r.base.expected.length;

/** Live: every expected note outside `except` judged on time, matched, not missed. */
function liveCleanExcept(r: Run, except: number[], why = 'played on time within jitter ≤ 4 ms of the written onset'): Predicate[] {
  const out: Predicate[] = [];
  for (const [a, b] of ranges(N(r), except)) {
    out.push(P.eq(`judgments[${a}:${b}][*].status`, 'matched', why));
    out.push(P.eq(`judgments[${a}:${b}][*].timing`, 'on-time', why));
    out.push(P.in(`judgments[${a}:${b}][*].pitch`, ['in-tune', 'not-graded'], 'within ±3 c of the target (02 §4.8 correct)'));
  }
  return out;
}
/** Final: every expected note outside `except` matched on time with full pitch and onset credit. */
function finalCleanExcept(r: Run, except: number[]): Predicate[] {
  const out: Predicate[] = [P.length('judgments', N(r), 'one judgment per expected note; a tie chain is one note (01 §6.4)')];
  for (const [a, b] of ranges(N(r), except)) {
    out.push(P.eq(`judgments[${a}:${b}][*].status`, 'matched'));
    out.push(P.eq(`judgments[${a}:${b}][*].timing`, 'on-time'));
    out.push(P.eq(`judgments[${a}:${b}][*].credit.p`, 1, 'nearest semitone equals the target (02 §4.3)'));
    out.push(P.eq(`judgments[${a}:${b}][*].credit.o`, 1, '|Δ| ≤ 4 ms jitter ≤ tGood (02 §4.3)'));
  }
  return out;
}
const noExtrasNoDisplaced = (): Predicate[] => [P.length('extras', 0), P.length('displaced', 0)];
const matchedTo = (r: Run, i: number, note?: string): Predicate => P.eq(`judgments[${i}].detectedId`, idOf(r, i), note ?? `expected ${i} is matched to the note played for it (ground truth)`);

const LEBEAU = 'le-beau-lc5883655-voice-mp1-9';
const MAYER = 'mayer-sq8915514-viola-mv1-m13-20';
const lebeau = (): Base => corpusBase(LEBEAU, 'flute', 90);
const mayer = (): Base => corpusBase(MAYER, 'flute', 90);

function timingCase(kind: 'early' | 'late', idxs: number[]): Pick<FollowScenario, 'live' | 'final'> {
  const sign = kind === 'early' ? -1 : 1;
  return {
    live: (r) => [
      ...liveCleanExcept(r, idxs),
      ...idxs.flatMap((i) => {
        const id = idOf(r, i);
        const e = r.base.expected[i]!;
        return [
          P.eq(`judgments[${i}].timing`, kind, `${sign * 150} ms vs ${tolText(r, i)}: |Δ| > tRed (02 §4.8)`),
          ...P.between(`judgments[${i}].timingErrorMs`, sign * 150 - 5, sign * 150 + 5, 'played onset minus written onset, + = late (01 §6.5); scripted 150 ms'),
          P.eq(`judgments[${i}].detectedId`, id),
          P.eq(`ghosts[detectedId=${id}][0].kind`, kind, 'early or late: ghost at the played onset and pitch (02 §4.8)'),
          P.eq(`ghosts[detectedId=${id}][0].targetExpectedIdx`, i),
          P.approx(`ghosts[detectedId=${id}][0].scoreBeat`, e.onsetBeat + (sign * 0.15 * r.base.bpm) / 60, 0.01, 'ghost x = played onset in beats (01 §9.7): written onset ± 150 ms × bpm / 60'),
          P.eq(`ghosts[detectedId=${id}][0].writtenPitch`, e.writtenPitch as never, 'correct pitch: the ghost is spelled as the target (02 §4.8 spelling rule, distance 0)'),
        ];
      }),
      P.length('missed', 0),
      P.length(`ghosts`, idxs.length, 'no other ghosts'),
    ],
    final: (r) => [
      ...finalCleanExcept(r, idxs),
      ...idxs.flatMap((i) => [
        P.eq(`judgments[${i}].timing`, kind),
        P.eq(`judgments[${i}].pitch`, 'in-tune'),
        P.eq(`judgments[${i}].credit.p`, 1, 'a timing error does not cost pitch credit (02 §4.3)'),
        P.approx(`judgments[${i}].credit.o`, onsetCredit(r, i, 150), 0.02, `o linear from 1 at tGood to 0 at tBad (02 §4.3): ${tolText(r, i)} → (tBad − 150) / (tBad − tGood)`),
        P.eq(`judgments[${i}].rejudged`, false, 'live and final agree (01 §9.7)'),
      ]),
      ...noExtrasNoDisplaced(),
    ],
  };
}

export const FOLLOW_SCENARIOS: FollowScenario[] = [
  {
    id: 'on-time',
    description: 'Le Beau, flute, L4, 90 bpm, 4/4 with a pickup: every note on time (jitter ≤ 4 ms) and in tune (±3 c). Nothing is red, no ghost, no missed, no extra.',
    base: lebeau,
    spec: {},
    live: (r) => [
      ...liveCleanExcept(r, []),
      P.length('missed', 0),
      P.length('ghosts', 0, 'correct notes draw no ghost (02 §4.8)'),
      P.length('status', 0, 'no stop, no displacement'),
      P.length('noteStarts', N(r)),
      P.eq('noteStarts[*].displaced', false),
      P.eq('ends[0].reason', 'complete', 'end of take at the last note end + 1 beat (R14)'),
    ],
    final: (r) => [
      ...finalCleanExcept(r, []),
      P.in('judgments[*].pitch', ['in-tune', 'not-graded']),
      P.eq('judgments[*].rejudged', false),
      P.eq('judgments[*].octaveDisplaced', false),
      P.in('judgments[*].duration', ['ok', 'not-graded'], 'held 92% of the written length ≥ 0.70 (02 §4.3)'),
      ...[0, 10, 20, 32].map((i) => matchedTo(r, i)),
      ...noExtrasNoDisplaced(),
    ],
  },
  {
    id: 'early-150',
    description: 'Le Beau, flute, L4, 90 bpm: notes 1 and 22 (quarters between quarters) played 150 ms early; everything else on time.',
    base: lebeau,
    spec: { mods: { 1: { shiftMs: -150 }, 22: { shiftMs: -150 } } },
    ...timingCase('early', [1, 22]),
  },
  {
    id: 'late-150',
    description: 'Le Beau, flute, L4, 90 bpm: notes 3 and 24 (quarters between quarters) played 150 ms late; everything else on time.',
    base: lebeau,
    spec: { mods: { 3: { shiftMs: 150 }, 24: { shiftMs: 150 } } },
    ...timingCase('late', [3, 24]),
  },
  {
    id: 'sharp',
    description:
      'Le Beau, flute, L4, 90 bpm: note 13 +30 c (beyond good, inside red: correct-marginal, never red), note 22 +48 c (beyond red + hysteresis: live and final sharp), note 4 +44 c but sounded only 190 ms (140 ms steady: below intonationMinSteadyMs 150, no intonation grade).',
    base: lebeau,
    spec: { mods: { 13: { cents: 30 }, 22: { cents: 48 }, 4: { cents: 44, durMs: 190 } } },
    live: (r) => [
      ...liveCleanExcept(r, [4, 13, 22]),
      P.eq('judgments[22].pitch', 'sharp', `+48 c: ${centsText(r, 22)} → 48 > 35 + 10`),
      P.eq(`ghosts[detectedId=${idOf(r, 22)}][0].kind`, 'sharp', 'sharp: ghost at the same staff position with a ▲ (02 §4.8)'),
      P.approx(`ghosts[detectedId=${idOf(r, 22)}][0].centsError`, 48, 2),
      P.eq('judgments[22].timing', 'on-time'),
      P.in('judgments[13].pitch', ['in-tune'], `+30 c: ${centsText(r, 13)} → 30 ≤ 35: correct-marginal is shown as correct live, never red (02 §4.8)`),
      P.length(`ghosts[detectedId=${idOf(r, 13)}]`, 0),
      P.ne('judgments[4].pitch', 'sharp', 'steady 190 − 50 = 140 ms < 150: no sharp or flat state (02 §4.2, §4.9 case 13); 44 c is not above red + 10 either, so no provisional flash'),
      P.length(`ghosts[detectedId=${idOf(r, 4)}]`, 0),
      P.length('ghosts', 1),
      P.length('missed', 0),
    ],
    final: (r) => [
      ...finalCleanExcept(r, [4, 13, 22]),
      P.eq('judgments[22].pitch', 'sharp', '|dev| 48 > red 35 (02 §4.8 sharp)'),
      P.eq('judgments[22].credit.p', 1, 'within 50 c of the target: the semitone is right (02 §4.2)'),
      P.eq('judgments[22].credit.n', 0, 'n = 0 beyond red (02 §4.3)'),
      P.approx('judgments[22].centsError', 48, 1),
      P.eq('judgments[13].pitch', 'in-tune'),
      P.eq('judgments[13].marginal', true, 'beyond good (20 c), within red (35 c) (02 §4.8 correct-marginal)'),
      P.approx('judgments[13].credit.n', (35 - 30) / (35 - 20), 0.02, 'n linear from 1 at good 20 c to 0 at red 35 c: (35 − 30) / 15 (02 §4.3)'),
      P.in('judgments[4].pitch', ['in-tune', 'not-graded'], 'not intonation-graded: 140 ms steady < 150 ms (02 §4.2)'),
      P.absent('judgments[4].credit.n', 'n is null when intonation is not graded (01 §6.5)'),
      P.eq('judgments[4].credit.p', 1),
      ...noExtrasNoDisplaced(),
    ],
  },
  {
    id: 'flat',
    description: 'Le Beau, flute, L4, 90 bpm: note 13 −30 c (correct-marginal) and note 22 −48 c (live and final flat).',
    base: lebeau,
    spec: { mods: { 13: { cents: -30 }, 22: { cents: -48 } } },
    live: (r) => [
      ...liveCleanExcept(r, [13, 22]),
      P.eq('judgments[22].pitch', 'flat', `−48 c: ${centsText(r, 22)}`),
      P.eq(`ghosts[detectedId=${idOf(r, 22)}][0].kind`, 'flat'),
      P.approx(`ghosts[detectedId=${idOf(r, 22)}][0].centsError`, -48, 2),
      P.eq('judgments[13].pitch', 'in-tune', 'correct-marginal is never red live (02 §4.8)'),
      P.length('ghosts', 1),
    ],
    final: (r) => [
      ...finalCleanExcept(r, [13, 22]),
      P.eq('judgments[22].pitch', 'flat'),
      P.eq('judgments[22].credit.n', 0),
      P.approx('judgments[22].centsError', -48, 1),
      P.eq('judgments[13].marginal', true),
      P.approx('judgments[13].credit.n', 1 / 3, 0.02, '(35 − 30) / (35 − 20)'),
      ...noExtrasNoDisplaced(),
    ],
  },
  {
    id: 'wrong-note-key-signature',
    description:
      'Le Beau, flute, L4, 90 bpm, written A major: C♯5 (note 2) played as C♮5 and F♯5 (note 12) played as F♮5, both on time. Wrong pitch, ghosts spelled with the target letter (02 §4.8: C♮, F♮).',
    base: lebeau,
    spec: { mods: { 2: { semis: -1, cents: 0 }, 12: { semis: -1, cents: 0 } } },
    live: (r) => [
      ...liveCleanExcept(r, [2, 12]),
      ...[2, 12].flatMap((i) => {
        const id = idOf(r, i);
        const tgt = r.base.expected[i]!.writtenPitch;
        return [
          P.eq(`judgments[${i}].pitch`, 'wrong-pitch', 'played one semitone (100 c ≥ 80 c) below the target (02 §4.8 wrong-pitch, 01 §9.3 step 3)'),
          P.eq(`judgments[${i}].timing`, 'on-time', 'a wrong note in time is still on time'),
          P.eq(`ghosts[detectedId=${id}][0].kind`, 'wrong-pitch'),
          P.eq(`ghosts[detectedId=${id}][0].writtenPitch`, { step: tgt.step, alter: 0, octave: tgt.octave }, `within ±2 semitones: target letter ${tgt.step} plus the needed accidental (natural) (02 §4.8)`),
        ];
      }),
      P.length('ghosts', 2),
    ],
    final: (r) => [
      ...finalCleanExcept(r, [2, 12]),
      ...[2, 12].flatMap((i) => [
        P.eq(`judgments[${i}].pitch`, 'wrong-pitch'),
        P.eq(`judgments[${i}].credit.p`, 0),
        P.eq(`judgments[${i}].credit.o`, 1, 'a wrong note in time earns onset credit (02 §4.3)'),
        P.absent(`judgments[${i}].credit.n`, 'no intonation credit when p = 0 (02 §4.3)'),
        P.approx(`judgments[${i}].playedConcertMidi`, r.base.expected[i]!.concertMidi - 1, 0.05),
        matchedTo(r, i),
      ]),
      ...noExtrasNoDisplaced(),
    ],
  },
  {
    id: 'octave-non-voice',
    description:
      'Le Beau, flute, L4, 90 bpm: note 13 (E5) played as E4 with low alternate-octave clarity (0.3): octave error, no pitch credit (R20). Note 22 (E5) detected as E4 but with alternate-octave clarity 0.9 ≥ 0.8 × 0.95: score-informed correction reads it as the expected octave (01 §9.3 step 5).',
    base: lebeau,
    spec: { mods: { 13: { octaves: -1, altOctaveClarity: 0.3 }, 22: { octaves: -1, altOctaveClarity: 0.9 } } },
    live: (r) => [
      ...liveCleanExcept(r, [13, 22]),
      P.eq('judgments[13].pitch', 'octave', 'non-voice octave error (01 §9.3 step 5, R20)'),
      P.eq(`ghosts[detectedId=${idOf(r, 13)}][0].kind`, 'octave'),
      P.eq('judgments[22].pitch', 'in-tune', 'altOctaveClarity 0.9 ≥ 0.8 × clarity 0.95 = 0.76: the expected octave (01 §9.3 step 5)'),
      P.length(`ghosts[detectedId=${idOf(r, 22)}]`, 0),
      P.length('ghosts', 1),
    ],
    final: (r) => [
      ...finalCleanExcept(r, [13, 22]),
      P.eq('judgments[13].pitch', 'octave'),
      P.eq('judgments[13].credit.p', 0, 'an octave error on a non-voice instrument earns no pitch credit (R20)'),
      P.eq('judgments[13].octaveDisplaced', false),
      P.eq('judgments[13].credit.o', 1),
      P.eq('judgments[22].pitch', 'in-tune'),
      P.eq('judgments[22].credit.p', 1),
      ...noExtrasNoDisplaced(),
    ],
  },
  {
    id: 'octave-voice',
    description: 'Holmes, voice (soprano), L2, 72 bpm: bar 2 (notes 5 to 9) sung an octave high. Voice is octave-equivalent (R7): correct, octaveDisplaced, no red, no ghost.',
    base: () => corpusBase('holmes-lc5855050-voice-m1-8', 'voice-soprano'),
    spec: { mods: Object.fromEntries([5, 6, 7, 8, 9].map((i) => [i, { octaves: 1 }])) },
    live: (r) => [
      ...liveCleanExcept(r, []),
      P.length('ghosts', 0, 'voice octave displacement is correct: no ghost (02 §4.8)'),
      P.length('missed', 0),
    ],
    final: (r) => [
      ...finalCleanExcept(r, []),
      P.eq('judgments[5:10][*].octaveDisplaced', true, 'R7: recorded as octaveDisplaced, credited as correct'),
      P.in('judgments[5:10][*].pitch', ['in-tune', 'not-graded']),
      P.eq('judgments[0:5][*].octaveDisplaced', false),
      P.eq('judgments[10:34][*].octaveDisplaced', false),
      ...noExtrasNoDisplaced(),
    ],
  },
  {
    id: 'missed',
    description: 'Le Beau, flute, L4, 90 bpm: notes 10 (D5, bar 3 beat 1) and 30 (D5, bar 7) not played. Missed live once their window passes (hollow red), missed in final.',
    base: lebeau,
    spec: { mods: { 10: { omit: true }, 30: { omit: true } } },
    live: (r) => [
      ...liveCleanExcept(r, [10, 30]),
      P.eq('missed', [10, 30], 'no match by onset + W + confirmDelay (01 §9.3)'),
      P.length('events[type=missed&expectedIdx=10]', 1, 'missed is emitted once'),
      P.ne('judgments[10].status', 'matched'),
      P.ne('judgments[30].status', 'matched'),
      P.length('ghosts', 0, 'missed notes draw no ghost (02 §4.8)'),
    ],
    final: (r) => [
      ...finalCleanExcept(r, [10, 30]),
      P.eq('judgments[10].status', 'missed'),
      P.eq('judgments[30].status', 'missed'),
      P.eq('judgments[10].credit.p', 0),
      P.eq('judgments[10].credit.o', 0, 'missed: o = 0 (02 §4.3)'),
      P.absent('judgments[10].detectedId'),
      matchedTo(r, 9),
      matchedTo(r, 11),
      ...noExtrasNoDisplaced(),
    ],
  },
  {
    id: 'extra-in-rest',
    description:
      'Mayer quartet viola line, flute, L4, 90 bpm: bar 2 has a three-beat rest. The player sounds B4 for one beat inside it (an extra, duringRest) and a 60 ms blip later in the same rest (below the 100 ms extra rule: ignored).',
    base: mayer,
    spec: { extras: [{ atBeat: 5.5, durBeats: 1, midi: 71, duringRest: true }, { atBeat: 7, durBeats: 0.09, midi: 74, duringRest: true }] },
    live: (r) => {
      const [x, blip] = idsWhere(r, (t) => t.kind === 'extra');
      return [
        ...liveCleanExcept(r, []),
        P.eq(`noteStarts[detectedId=${x}][0].matchedExpected`, null, 'no admissible pending note: an extra (01 §9.3 step 1)'),
        P.eq(`ghosts[detectedId=${x}][0].kind`, 'extra', 'extra: ghost only (02 §4.8)'),
        P.absent(`ghosts[detectedId=${x}][0].targetExpectedIdx`),
        P.length(`ghosts[detectedId=${blip}]`, 0, '60 ms < extraMinDurMs 100 (02 §4.1)'),
        P.length('ghosts', 1),
        P.length('missed', 0),
      ];
    },
    final: (r) => {
      const [x] = idsWhere(r, (t) => t.kind === 'extra');
      return [
        ...finalCleanExcept(r, []),
        P.length('extras', 1, 'the blip is under 100 ms and is not an extra (02 §4.1)'),
        P.eq('extras[0].detectedId', x!),
        P.eq('extras[0].duringRest', true, 'sounds more than restIntrusionMs 100 inside the written rest (01 §9.3)'),
        P.approx('extras[0].onsetSec', (5.5 * 60) / 90, 0.01),
        P.length('displaced', 0),
      ];
    },
  },
  {
    id: 'repeat-merge',
    description: 'Le Beau, flute, L4, 90 bpm: the repeated B4 eighths (notes 18 and 19, bar 5) are sounded as one note with no re-articulation. Note 18 matched, note 19 missed, no extra.',
    base: lebeau,
    spec: { merges: [18] },
    live: (r) => [...liveCleanExcept(r, [19]), P.eq('missed', [19]), P.length('ghosts', 0)],
    final: (r) => [
      ...finalCleanExcept(r, [19]),
      matchedTo(r, 18),
      P.eq('judgments[19].status', 'missed', 'one onset cannot match two notes; the second written repeat is missed'),
      ...noExtrasNoDisplaced(),
    ],
  },
  {
    id: 'repeat-split',
    description:
      'Le Beau, flute, L4, 90 bpm: the dotted quarter B4 (note 26, bar 7) is re-articulated halfway, so one written note is heard as two. The first part matches note 26 (held 0.48 of its length: duration short), the second part is an extra, and note 27 still matches its own note.',
    base: lebeau,
    spec: { splits: [{ idx: 26, atFrac: 0.5 }] },
    live: (r) => {
      const [x] = idsWhere(r, (t) => t.kind === 'extra');
      return [
        ...liveCleanExcept(r, []),
        P.eq(`noteStarts[detectedId=${x}][0].matchedExpected`, null, `the second part starts 500 ms after note 26 and 500 ms before note 27, outside note 27's W (${ms(r.tol[27]!.matchWindowSec)} ms)`),
        P.eq(`ghosts[detectedId=${x}][0].kind`, 'extra'),
        P.eq('judgments[27].detectedId', idOf(r, 27)),
      ];
    },
    final: (r) => {
      const [x] = idsWhere(r, (t) => t.kind === 'extra');
      return [
        ...finalCleanExcept(r, []),
        matchedTo(r, 26),
        matchedTo(r, 27),
        P.eq('judgments[26].duration', 'short', 'held (0.5 − 0.02 s gap) / 1.0 s = 0.48 < 0.70 (02 §4.3)'),
        P.approx('judgments[26].credit.d', (0.48 - 0.35) / (0.7 - 0.35), 0.03, 'd linear from 0 at 0.35 to 1 at 0.70: (0.48 − 0.35) / 0.35'),
        P.length('extras', 1),
        P.eq('extras[0].detectedId', x!),
        P.eq('extras[0].duringRest', false),
        P.length('displaced', 0),
      ];
    },
  },
  {
    id: 'tie',
    description:
      'Mayer viola line, flute, L4, 90 bpm: E5 tied across the bar 4 to 5 barline (note 15, two events) held through, then the same E5 re-struck on bar 5 beat 2 (note 16, onsetKind repeat). The tie is one note; the re-strike matches note 16, not an extra.',
    base: mayer,
    spec: {},
    live: (r) => [...liveCleanExcept(r, []), P.length('missed', 0), P.length('ghosts', 0), P.length('noteStarts', N(r), 'one onset per expected note: nothing at the tied barline')],
    final: (r) => [
      ...finalCleanExcept(r, []),
      P.length('judgments', 25, '26 note events, one tie chain: 25 expected notes (01 §6.4)'),
      matchedTo(r, 15),
      matchedTo(r, 16, 're-struck repeat after the tie matches note 16 (onsetKind repeat)'),
      P.eq('judgments[15].duration', 'ok', 'held 92% of the 2-beat chain (02 §4.3)'),
      P.eq('judgments[15].credit.d', 1),
      ...noExtrasNoDisplaced(),
    ],
  },
  {
    id: 'pickup-late',
    description: 'Le Beau, flute, L4, 90 bpm: the one-beat pickup (note 0, onset −1 beat = −0.667 s) played 150 ms late; the rest on time. Negative score times are handled like any other.',
    base: lebeau,
    spec: { mods: { 0: { shiftMs: 150 } } },
    live: (r) => [
      ...liveCleanExcept(r, [0]),
      P.eq('judgments[0].timing', 'late', tolText(r, 0)),
      ...P.between('judgments[0].timingErrorMs', 145, 155),
      P.eq(`noteStarts[detectedId=${idOf(r, 0)}][0].matchedExpected`, 0),
      P.approx(`noteStarts[detectedId=${idOf(r, 0)}][0].scoreBeat`, -1 + 0.225, 0.01, 'pickup onset −1 beat, + 150 ms × 90 / 60 = +0.225 beat'),
      P.approx(`ghosts[detectedId=${idOf(r, 0)}][0].scoreBeat`, -0.775, 0.01),
    ],
    final: (r) => [
      ...finalCleanExcept(r, [0]),
      P.eq('judgments[0].timing', 'late'),
      matchedTo(r, 0),
      P.approx('judgments[0].credit.o', onsetCredit(r, 0, 150), 0.02, tolText(r, 0)),
      ...noExtrasNoDisplaced(),
    ],
  },
  {
    id: 'fast-run',
    description:
      'Haydn song line, flute, L7, 100 bpm (the golden expected notes): sixteenth runs at 150 ms IOI in bars 2 to 5. Note 14 (C5, inside a run) is 70 ms late; it must match note 14, not its neighbour 15, which is also inside W.',
    base: () => corpusBase('haydn-lc6472842-voice-mp117-127', 'flute'),
    spec: { mods: { 14: { shiftMs: 70 } } },
    live: (r) => [
      ...liveCleanExcept(r, [14]),
      P.eq('judgments[14].timing', 'late', `70 ms vs ${tolText(r, 14)}`),
      P.eq('judgments[14].detectedId', idOf(r, 14), 'cost to 14: 4 × (70 / 90)² = 2.4; to 15: 4 × (80 / 90)² + 5 (pitch) + 2 (skip) = 10.2 (01 §9.2, §9.3)'),
      P.eq('judgments[15].detectedId', idOf(r, 15)),
      P.length('missed', 0),
    ],
    final: (r) => [
      ...finalCleanExcept(r, [14]),
      ...Array.from({ length: 21 }, (_, k) => matchedTo(r, 7 + k)),
      P.eq('judgments[14].timing', 'late'),
      P.approx('judgments[14].credit.o', onsetCredit(r, 14, 70), 0.02, `${tolText(r, 14)}: (90 − 70) / (90 − 45)`),
      ...noExtrasNoDisplaced(),
    ],
  },
  {
    id: 'slurred-run',
    description:
      'Mayer viola line, flute, L4, 90 bpm: the slurred eighth runs in bars 1 and 3 played legato (no gap, onset by pitch change) with up to ±12 ms timing scatter. All on time and matched in order.',
    base: mayer,
    spec: { jitterMs: [0, 12, -10, 8, -12, 5, -6, 11] },
    live: (r) => [...liveCleanExcept(r, [], '±12 ms ≤ tGood for every note'), P.length('missed', 0), P.length('ghosts', 0)],
    final: (r) => [
      ...finalCleanExcept(r, []).map((p) => (p.path.endsWith('credit.o') ? { ...p, note: '|Δ| ≤ 12 ms ≤ tGood 66.7 ms (eighths: max(50, 0.10 × 666.7) after the 0.3 × 333 cap) (02 §4.2)' } : p)),
      ...[1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13].map((i) => matchedTo(r, i)),
      P.in('judgments[1:6][*].duration', ['ok', 'not-graded']),
      ...noExtrasNoDisplaced(),
    ],
  },
  {
    id: 'stop-bar-5',
    description:
      'Le Beau, flute, L4, 90 bpm: the player stops at bar 5, stays silent through bars 5 and 6 (notes 17 to 25, no rests there) and comes back on time at bar 7. Notes go missed as their windows pass (R11); the status line says "come in at bar 7".',
    base: lebeau,
    spec: { mods: Object.fromEntries([17, 18, 19, 20, 21, 22, 23, 24, 25].map((i) => [i, { omit: true }])) },
    live: (r) => [
      ...liveCleanExcept(r, [17, 18, 19, 20, 21, 22, 23, 24, 25]),
      P.eq('missed', [17, 18, 19, 20, 21, 22, 23, 24, 25]),
      P.length('status[kind=come-in-at]', 1, 'after 1 bar of silence not covered by rests (02 §4.6, 01 §9.3)'),
      P.eq(
        'status[kind=come-in-at][0].bar',
        7,
        'silence from note 16’s release (beat 15.92) + 1 bar = beat 19.92; the next downbeat ≥ 1 beat ahead is beat 24 = bar 7 (bar n starts at beat 4(n − 1))',
      ),
      P.length('status[kind=lost-place]', 0, 'dropping notes and rejoining on time is not a displacement (01 §9.5)'),
      P.length('ghosts', 0),
    ],
    final: (r) => [
      ...finalCleanExcept(r, [17, 18, 19, 20, 21, 22, 23, 24, 25]),
      P.eq('judgments[17:26][*].status', 'missed'),
      ...noExtrasNoDisplaced(),
    ],
  },
  {
    id: 'back-2-beats',
    description:
      'Le Beau, flute, L4, 90 bpm: after bar 6 beat 2 the player goes back two beats and replays notes 22 to 27 (6 notes) two beats late, then rejoins on time at bar 8 (note 32). Current notes 24 to 31 are missed; the replay is one displaced segment (offset −2 beats); the first play of 22 and 23 keeps its judgment.',
    base: lebeau,
    spec: { mods: Object.fromEntries([24, 25, 26, 27, 28, 29, 30, 31].map((i) => [i, { omit: true }])), replays: [{ from: 22, to: 27, offsetBeats: -2 }] },
    live: (r) => {
      const disp = idsWhere(r, (t) => t.kind === 'displaced');
      return [
        ...liveCleanExcept(r, [24, 25, 26, 27, 28, 29, 30, 31]),
        P.length('status[kind=lost-place]', 1, 'the displacement detector fires within 4 notes (01 §9.5, P10a acceptance)'),
        P.length('status[kind=rejoined]', 1, 'it leaves the state when a note matches at δ ≈ 0 (note 32)'),
        ...[27, 28, 29, 30, 31].map((i) => P.includes('missed', i, 'expected notes still go missed while displaced (01 §9.5, R11)')),
        P.ne('judgments[27:32][*].pitch', 'wrong-pitch', 'no current note turns red from pitch once displaced (01 §9.5)'),
        ...disp.slice(3).map((id) => P.eq(`ghosts[detectedId=${id}][0].displaced`, true, 'replay ghost (01 §9.5)')),
        ...disp.slice(3).map((id) => P.eq(`noteStarts[detectedId=${id}][0].displaced`, true)),
        matchedTo(r, 22, 'the first play of 22 is never overwritten by the replay (01 §9.6)'),
        matchedTo(r, 23),
        matchedTo(r, 32),
      ];
    },
    final: (r) => {
      const disp = idsWhere(r, (t) => t.kind === 'displaced');
      return [
        ...finalCleanExcept(r, [24, 25, 26, 27, 28, 29, 30, 31]),
        P.length('displaced', 1, 'one run at a constant offset (01 §9.6 relabel)'),
        P.eq('displaced[0].fromIdx', 22),
        P.eq('displaced[0].toIdx', 27),
        P.approx('displaced[0].offsetBeats', -2, 0.1, 'went back two beats: negative (DisplacedSegment)'),
        P.eq('displaced[0].detectedIds', disp),
        P.eq('judgments[24:32][*].status', 'missed', 'current notes covered by the replay are missed (02 §4.3, §4.6)'),
        matchedTo(r, 22, 'replayed notes never overwrite an earlier judgment (01 §9.6)'),
        matchedTo(r, 23),
        matchedTo(r, 32),
        P.length('extras', 0, 'displaced notes are not extras (02 §4.1)'),
      ];
    },
  },
  {
    id: 'skip-bar-ahead',
    description:
      'Le Beau, flute, L4, 90 bpm: on bar 1 beat 3 the player jumps a bar ahead and plays notes 8 to 12 (bar 2 beat 3 to bar 3 beat 2.5) one bar early, notices, and rejoins the click on bar 2 beat 3, playing notes 8 onwards on time. One displaced segment (offset +4 beats); the current notes it covered (3 to 7) are missed; the on-time play of 8 to 12 matches them.',
    base: lebeau,
    spec: { mods: Object.fromEntries([3, 4, 5, 6, 7].map((i) => [i, { omit: true }])), replays: [{ from: 8, to: 12, offsetBeats: 4 }] },
    live: (r) => {
      const disp = idsWhere(r, (t) => t.kind === 'displaced');
      return [
        ...liveCleanExcept(r, [3, 4, 5, 6, 7]),
        P.length('status[kind=lost-place]', 1, 'the displacement detector fires within 4 notes (01 §9.5)'),
        P.length('status[kind=rejoined]', 1, 'note 8 on time matches at δ ≈ 0'),
        P.includes('missed', 7, 'covered by the 5th displaced note, after the detector fired: missed, not wrong (01 §9.5)'),
        P.ne('judgments[7].pitch', 'wrong-pitch'),
        ...disp.slice(3).map((id) => P.eq(`ghosts[detectedId=${id}][0].displaced`, true)),
        ...[8, 9, 10, 11, 12].map((i) => matchedTo(r, i, 'the on-time play after rejoining matches (the early displaced play earned nothing)')),
      ];
    },
    final: (r) => {
      const disp = idsWhere(r, (t) => t.kind === 'displaced');
      return [
        ...finalCleanExcept(r, [3, 4, 5, 6, 7]),
        P.length('displaced', 1),
        P.eq('displaced[0].fromIdx', 8),
        P.eq('displaced[0].toIdx', 12),
        P.approx('displaced[0].offsetBeats', 4, 0.1, 'ahead of the metronome by one 4/4 bar: positive (DisplacedSegment)'),
        P.eq('displaced[0].detectedIds', disp),
        P.eq('judgments[3:8][*].status', 'missed', 'the current notes the displaced run covered are missed (02 §4.3)'),
        ...[8, 9, 10, 11, 12].map((i) => matchedTo(r, i)),
        P.length('extras', 0, 'displaced notes are not extras (02 §4.1)'),
      ];
    },
  },
  {
    id: 'rejoin-next-downbeat',
    description:
      'Le Beau, flute, L4, 90 bpm: the player drops notes 11 to 14 (bar 3 beats 2 to 4) and comes in on time on the bar 4 downbeat. Only the dropped notes are missed; no displacement; the silence is under a bar, so no "come in at" hint.',
    base: lebeau,
    spec: { mods: Object.fromEntries([11, 12, 13, 14].map((i) => [i, { omit: true }])) },
    live: (r) => [
      ...liveCleanExcept(r, [11, 12, 13, 14]),
      P.eq('missed', [11, 12, 13, 14]),
      P.length('status', 0, 'silence of about 3 beats < 1 bar: no come-in-at (02 §4.6); no lost-place (01 §9.5)'),
      matchedTo(r, 15),
    ],
    final: (r) => [...finalCleanExcept(r, [11, 12, 13, 14]), P.eq('judgments[11:15][*].status', 'missed'), matchedTo(r, 15), ...noExtrasNoDisplaced()],
  },
  {
    id: 'live-final-divergence',
    description:
      'Le Beau, flute, L4, 90 bpm: 150 ms before note 24 (D5) the player clips a 120 ms E5, then plays D5 on time. Live, the greedy matcher gives note 24 to the clipped note (early, wrong pitch) and calls the real D5 an extra; the final DP gives note 24 to the real D5 and makes the clipped note the extra, so note 24 is rejudged (01 §9.6, §9.7).',
    base: lebeau,
    spec: { blips: [{ idx: 24, atMs: -150, durMs: 120, semis: 2 }] },
    live: (r) => {
      const [blip] = idsWhere(r, (t) => t.kind === 'extra');
      return [
        ...liveCleanExcept(r, [24]),
        P.eq('judgments[24].detectedId', blip!, `greedy at the clipped note's onset: Δ −150 ms is inside W ${ms(r.tol[24]!.matchWindowSec)} ms, cost 4 × (150 / 333)² + 5 = 5.8 (01 §9.3)`),
        P.eq('judgments[24].timing', 'early', '−150 ms beyond tRed 113 ms; timing is final at onset (02 §4.8)'),
        P.eq('judgments[24].pitch', 'wrong-pitch', '200 c from the target at confirmation (01 §9.3 step 3)'),
        P.eq(`noteStarts[detectedId=${idOf(r, 24)}][0].matchedExpected`, null, 'note 24 is taken; note 25 is 667 ms away, outside W'),
      ];
    },
    final: (r) => {
      const [blip] = idsWhere(r, (t) => t.kind === 'extra');
      return [
        ...finalCleanExcept(r, [24]),
        matchedTo(r, 24, 'DP: extra(5) + match(≈0) = 5 beats match(5.8) + extra(5) = 10.8 (01 §9.6)'),
        P.eq('judgments[24].timing', 'on-time'),
        P.eq('judgments[24].pitch', 'in-tune'),
        P.eq('judgments[24].rejudged', true, 'final differs from live (01 §9.7)'),
        P.eq('judgments[0:24][*].rejudged', false),
        P.length('extras', 1),
        P.eq('extras[0].detectedId', blip!),
        P.length('displaced', 0),
      ];
    },
  },
];

export const runFollowScenario = (s: FollowScenario): Run => run(s.base(), s.spec, s.opts);
