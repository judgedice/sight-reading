/**
 * Reference arithmetic for deriving fixture expectations (02 §4.1 to §4.7). This is NOT the product code: P2
 * (`rules/resolveTolerances`), P10 (`follow/`) and P12 (`grade/`) implement the spec independently and are tested
 * against the predicates in `fixtures/follow/` and `fixtures/grade/`. The generator uses this module to
 *  1. write consistent inputs (the final alignment inside a grade fixture must carry the credits 02 §4.3 gives), and
 *  2. check that every predicate it writes holds on a reference subject (the fixture tests re-run that check),
 * so no expectation in a fixture is a guess. Every number read here comes from `config/` through `Configs`.
 * `gen.test.ts` proves `refTolerances` reproduces the 02 §4.2 worked-example table exactly.
 */
import type {
  AttemptScore,
  Configs,
  ExpectedNote,
  ExtraNote,
  FinalAlignment,
  Instrument,
  LetterGrade,
  NoteJudgment,
  PitchVerdict,
  ResolvedTolerance,
  TimingVerdict,
  VerdictCounts,
} from '../../../src/core/types.ts';

// ------------------------------------------------------------------------------------------------
// Tolerances (02 §4.2, §4.1)
// ------------------------------------------------------------------------------------------------

export const intonationGroup = (inst: Instrument): 'voice' | 'continuous' | 'fixed' =>
  inst.family === 'voice' ? 'voice' : inst.pitchKind === 'fixed' ? 'fixed' : 'continuous';

const inRange = (lv: number, r: readonly [number, number]): boolean => lv >= r[0] && lv <= r[1];

/** 02 §4.2: t_X = max(abs, frac × beat); min(t_X, cap × minIOI); max(t_X, family floor). W per 02 §4.1. */
export function refTolerances(notes: ExpectedNote[], inst: Instrument, level: number, bpm: number, cfg: Configs): ResolvedTolerance[] {
  const g = cfg.grading;
  const band = g.timing.levelBands.find((b) => inRange(level, b.levels));
  if (!band) throw new Error(`no timing band for L${level}`);
  const floor = g.timing.onsetClassFloors[inst.onsetClass];
  const beatMs = 60000 / bpm;
  const group = intonationGroup(inst);
  const ib = g.intonation.bands.find((b) => b.group === group && inRange(level, b.levels));
  if (!ib) throw new Error(`no intonation band for ${group} L${level}`);
  const attackExcludeMs = g.intonation.attackExcludeMsByFamily[inst.family];
  const minSteadyMs = g.intonation.minSteadyMs[inst.detection.vibratoClass];
  return notes.map((n) => {
    const iois = [n.ioiPrevSec, n.ioiNextSec].filter((x): x is number => x !== null).map((s) => s * 1000);
    const minIoi = iois.length ? Math.min(...iois) : null;
    const t = (term: { absMs: number; fracBeat: number }, cap: number, fl: number): number => {
      let v = Math.max(term.absMs, term.fracBeat * beatMs);
      if (minIoi !== null) v = Math.min(v, cap * minIoi);
      return Math.max(v, fl);
    };
    const good = t(band.good, g.timing.ioiCap.good, floor.goodMs);
    const red = t(band.red, g.timing.ioiCap.red, floor.redMs);
    const bad = t(band.bad, g.timing.ioiCap.bad, floor.badMs);
    const wInner = Math.min(Math.max(g.matchWindow.minMs, g.matchWindow.minBeats * beatMs), minIoi === null ? Infinity : g.matchWindow.ioiFrac * minIoi);
    const w = Math.max(bad, wInner);
    let goodCents = ib.goodCents;
    let redCents = ib.redCents;
    if (goodCents !== null && redCents !== null && inst.detection.vibratoClass === 'vibrato' && n.durSec * 1000 - attackExcludeMs < g.intonation.vibratoWiden.belowSteadyMs) {
      goodCents = Math.max(goodCents, g.intonation.vibratoWiden.minGoodCents);
      redCents = Math.max(redCents, g.intonation.vibratoWiden.minRedCents);
    }
    return {
      tGoodSec: good / 1000,
      tRedSec: red / 1000,
      tBadSec: bad / 1000,
      matchWindowSec: w / 1000,
      goodCents,
      redCents,
      attackExcludeMs,
      minSteadyMs,
      liveProvisionalMs: g.live.provisionalMs,
      liveHysteresisCents: g.live.hysteresisCents,
    };
  });
}

// ------------------------------------------------------------------------------------------------
// Voice drift reference (02 §4.5)
// ------------------------------------------------------------------------------------------------

export class RefVoiceDrift {
  private devs: number[] = [];
  private offset = 0;
  constructor(private readonly cfg: Configs) {}
  offsetCents(): number {
    return this.offset;
  }
  /** `absDevCents`: the note's steady median minus the written (octave-folded) target, before any offset. */
  observe(absDevCents: number, correct: boolean): void {
    if (!correct) return;
    const v = this.cfg.grading.voice;
    this.devs.push(absDevCents);
    if (this.devs.length > v.driftWindowNotes) this.devs.shift();
    const s = [...this.devs].sort((a, b) => a - b);
    const med = s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
    const step = Math.max(-v.maxStepCents, Math.min(v.maxStepCents, med - this.offset));
    this.offset = Math.max(-v.maxOffsetCents, Math.min(v.maxOffsetCents, this.offset + step));
  }
}

// ------------------------------------------------------------------------------------------------
// Per-note judgment and credits (02 §4.3, §4.8)
// ------------------------------------------------------------------------------------------------

export interface PlayedFacts {
  detectedId: number;
  /** Played onset, score seconds (after t0 and latency compensation). */
  onsetSec: number;
  /** Sounding duration, seconds. */
  durSec: number;
  /** Fractional concert MIDI of the steady median. */
  midi: number;
  steadyMs: number;
}

export interface JudgeContext {
  inst: Instrument;
  cfg: Configs;
  /** Winds/brass/strings tuning offset or voice reference offset at this note, cents. */
  offsetCents: number;
}

const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const lin = (x: number, full: number, zero: number): number => (x <= full ? 1 : x >= zero ? 0 : (zero - x) / (zero - full));

/** Pitch facts of a played note against a target (02 §4.2, §4.3, R7, R20). */
export function pitchFacts(e: ExpectedNote, midi: number, ctx: JudgeContext): { p: number; verdictBase: 'ok' | 'octave' | 'wrong'; octaveDisplaced: boolean; devCents: number } {
  const adj = midi - ctx.offsetCents / 100;
  const near = Math.round(adj);
  const diff = near - e.concertMidi;
  if (diff === 0) return { p: 1, verdictBase: 'ok', octaveDisplaced: false, devCents: (adj - e.concertMidi) * 100 };
  if (diff % 12 === 0) {
    if (ctx.inst.relativePitch) return { p: 1, verdictBase: 'ok', octaveDisplaced: true, devCents: (adj - near) * 100 };
    return { p: 0, verdictBase: 'octave', octaveDisplaced: false, devCents: (adj - e.concertMidi) * 100 };
  }
  return { p: 0, verdictBase: 'wrong', octaveDisplaced: false, devCents: (adj - e.concertMidi) * 100 };
}

export function timingVerdict(deltaMs: number, tol: ResolvedTolerance): TimingVerdict {
  if (Math.abs(deltaMs) <= tol.tRedSec * 1000) return 'on-time';
  return deltaMs < 0 ? 'early' : 'late';
}

export function judgeMatched(e: ExpectedNote, tol: ResolvedTolerance, d: PlayedFacts, ctx: JudgeContext): NoteJudgment {
  const g = ctx.cfg.grading;
  const deltaMs = (d.onsetSec - e.onsetSec) * 1000;
  const o = lin(Math.abs(deltaMs), tol.tGoodSec * 1000, tol.tBadSec * 1000);
  const pf = pitchFacts(e, d.midi, ctx);
  const intonationGraded = pf.p === 1 && tol.goodCents !== null && tol.redCents !== null && d.steadyMs >= tol.minSteadyMs;
  let n: number | null = null;
  let pitch: PitchVerdict;
  if (pf.verdictBase === 'octave') pitch = 'octave';
  else if (pf.verdictBase === 'wrong') pitch = 'wrong-pitch';
  else if (!intonationGraded) pitch = 'not-graded';
  else {
    const a = Math.abs(pf.devCents);
    n = lin(a, tol.goodCents!, tol.redCents!);
    pitch = a <= tol.redCents! ? 'in-tune' : pf.devCents > 0 ? 'sharp' : 'flat';
  }
  let dCredit: number | null = null;
  let duration: NoteJudgment['duration'] = 'not-graded';
  const heldRatio = d.durSec / e.durSec;
  if (e.durationGraded && ctx.inst.pitchKind !== 'fixed') {
    const c = g.credit.duration;
    const full = e.followedByRest ? c.beforeRestFullRatio : c.fullHeldRatio;
    const h = heldRatio;
    dCredit = h >= full ? 1 : h <= c.zeroHeldRatio ? 0 : (h - c.zeroHeldRatio) / (full - c.zeroHeldRatio);
    duration = dCredit === 1 ? 'ok' : 'short';
  }
  const marginal =
    pf.p === 1 &&
    ((Math.abs(deltaMs) > tol.tGoodSec * 1000 && Math.abs(deltaMs) <= tol.tRedSec * 1000) ||
      (intonationGraded && Math.abs(pf.devCents) > tol.goodCents! && Math.abs(pf.devCents) <= tol.redCents!));
  return {
    expectedIdx: e.idx,
    status: 'matched',
    detectedId: d.detectedId,
    timing: timingVerdict(deltaMs, tol),
    timingErrorMs: r6(deltaMs),
    pitch,
    playedConcertMidi: d.midi,
    centsError: r6(pf.devCents),
    octaveDisplaced: pf.octaveDisplaced,
    duration,
    heldRatio: r6(heldRatio),
    credit: { p: pf.p, n: n === null ? null : r6(n), o: r6(o), d: dCredit === null ? null : r6(dCredit) },
    marginal,
    rejudged: false,
  };
}

export function judgeMissed(e: ExpectedNote, inst: Instrument): NoteJudgment {
  const dur = e.durationGraded && inst.pitchKind !== 'fixed';
  return {
    expectedIdx: e.idx,
    status: 'missed',
    detectedId: null,
    timing: null,
    timingErrorMs: null,
    pitch: null,
    playedConcertMidi: null,
    centsError: null,
    octaveDisplaced: false,
    duration: dur ? 'short' : 'not-graded',
    heldRatio: null,
    credit: { p: 0, n: null, o: 0, d: dur ? 0 : null },
    marginal: false,
    rejudged: false,
  };
}

// ------------------------------------------------------------------------------------------------
// Components, total, grade (02 §4.4, §4.7)
// ------------------------------------------------------------------------------------------------

export interface RefScore {
  P: number;
  I: number | null;
  R: number;
  weights: { P: number; I: number; R: number };
  raw: number;
  score: number;
  grade: LetterGrade;
  status: 'ok' | 'incomplete';
  matched: number;
  n: number;
  counts: VerdictCounts;
}

export function refScore(a: FinalAlignment, inst: Instrument, level: number, cfg: Configs, lowestServedHz: number | null = null): RefScore {
  const g = cfg.grading;
  const js = a.judgments;
  const n = js.length;
  const extras = a.extras.length; // displaced notes are never in `extras` (01 §9.6)
  const P = (100 * js.reduce((s, j) => s + j.credit.p, 0)) / (n + g.credit.extrasWeight * extras);
  const graded = js.filter((j) => j.credit.n !== null);
  const I = graded.length >= g.components.intonationMinNotes ? (100 * graded.reduce((s, j) => s + j.credit.n!, 0)) / graded.length : null;
  const meanO = js.reduce((s, j) => s + j.credit.o, 0) / n;
  const dg = js.filter((j) => j.credit.d !== null);
  const R = dg.length ? 100 * (g.components.rhythm.onsetWeight * meanO + g.components.rhythm.durationWeight * (dg.reduce((s, j) => s + j.credit.d!, 0) / dg.length)) : 100 * meanO;
  const group = inst.pitchKind === 'fixed' ? 'fixed' : 'continuous';
  const row = g.components.weights.find((w) => w.group === group && inRange(level, w.levels));
  if (!row) throw new Error('no weight row');
  let wP = row.P;
  let wI = row.I;
  if (I === null || (lowestServedHz !== null && lowestServedHz < g.components.lowFundamentalHz)) {
    wP += wI;
    wI = 0;
  }
  const raw = wP * P + wI * (I ?? 0) + row.R * R;
  const matched = js.filter((j) => j.status === 'matched').length;
  const status = matched / n < g.gates.incompleteBelowMatchedFrac ? 'incomplete' : 'ok';
  let score = Math.round(raw);
  if (status === 'incomplete') score = Math.min(score, g.gates.incompleteScoreCap);
  const grade = [...g.grades.scale].sort((x, y) => y.minScore - x.minScore).find((r) => score >= r.minScore)!.grade;
  const counts: VerdictCounts = { correct: 0, early: 0, late: 0, sharp: 0, flat: 0, wrong: 0, octave: 0, missed: 0, extra: extras };
  for (const j of js) {
    if (j.status === 'missed') counts.missed++;
    else {
      if (j.timing === 'early') counts.early++;
      if (j.timing === 'late') counts.late++;
      if (j.pitch === 'sharp') counts.sharp++;
      if (j.pitch === 'flat') counts.flat++;
      if (j.pitch === 'wrong-pitch') counts.wrong++;
      if (j.pitch === 'octave') counts.octave++;
      if (j.timing === 'on-time' && (j.pitch === 'in-tune' || j.pitch === 'not-graded')) counts.correct++;
    }
  }
  return { P, I, R, weights: { P: wP, I: wI, R: row.R }, raw, score, grade, status, matched, n, counts };
}

/** A partial AttemptScore with the fields the reference can derive; used only as a predicate subject. */
export function refScoreSubject(r: RefScore, extras: ExtraNote[]): Partial<AttemptScore> & Record<string, unknown> {
  return {
    status: r.status,
    components: { P: r.P, I: r.I, R: r.R },
    weights: r.weights,
    score: r.score,
    grade: r.grade,
    diagnostics: { matched: r.matched, n: r.n, counts: r.counts, extras: extras.length } as never,
  };
}

// ------------------------------------------------------------------------------------------------
// Diagnostics (02 §4.6): stops, restarts, drift
// ------------------------------------------------------------------------------------------------

export interface RefDiagnostics {
  stops: { bar: number; startBeat: number; beats: number }[];
  restarts: { bar: number; notesReplayed: number; offsetBeats: number }[];
  driftMsAtEnd: number | null;
}

/**
 * Stops: silences between sounded notes (and from the last note to the end of take) whose part not covered by
 * written rests is ≥ max(1 beat, 600 ms) and that contain at least one missed note's onset. Bar = displayed bar at
 * the silence start. Drift: least-squares slope of Δ (ms) against bar position (onset beat / beats per bar) over
 * matched notes, × the number of bars (02 §4.6 "slope × bars × beat"). Restarts: one per displaced segment, at the
 * bar of its first replayed note.
 */
export function refDiagnostics(
  expected: ExpectedNote[],
  a: FinalAlignment,
  played: { onsetSec: number; endSec: number }[],
  beatsPerBar: number,
  bpm: number,
  endSec: number,
  cfg: Configs,
): RefDiagnostics {
  const beat = 60 / bpm;
  const s = cfg.grading.stops;
  const minSec = Math.max(s.minBeats * beat, s.minMs / 1000);
  const rests: [number, number][] = [];
  for (let i = 1; i < expected.length; i++) if (expected[i]!.precededByRest) rests.push([expected[i - 1]!.onsetSec + expected[i - 1]!.durSec, expected[i]!.onsetSec]);
  const iv = [...played].sort((x, y) => x.onsetSec - y.onsetSec);
  const gaps: [number, number][] = [];
  let cur = iv[0]?.endSec ?? 0;
  for (const p of iv.slice(1)) {
    if (p.onsetSec > cur) gaps.push([cur, p.onsetSec]);
    cur = Math.max(cur, p.endSec);
  }
  if (endSec > cur) gaps.push([cur, endSec]);
  const missedOnsets = a.judgments.filter((j) => j.status === 'missed').map((j) => expected[j.expectedIdx]!.onsetSec);
  const stops: RefDiagnostics['stops'] = [];
  for (const [g0, g1] of gaps) {
    const covered = rests.reduce((acc, [r0, r1]) => acc + Math.max(0, Math.min(g1, r1) - Math.max(g0, r0)), 0);
    const len = g1 - g0 - covered;
    if (len < minSec || !missedOnsets.some((t) => t >= g0 && t < g1)) continue;
    const startBeat = g0 / beat;
    stops.push({ bar: startBeat < 0 ? 0 : Math.floor(startBeat / beatsPerBar + 1e-9) + 1, startBeat, beats: len / beat });
  }
  const restarts = a.displaced.map((d) => ({ bar: expected[d.fromIdx]!.bar, notesReplayed: d.detectedIds.length, offsetBeats: d.offsetBeats }));
  const pts = a.judgments.filter((j) => j.status === 'matched').map((j) => [expected[j.expectedIdx]!.onsetBeat / beatsPerBar, j.timingErrorMs!] as const);
  let driftMsAtEnd: number | null = null;
  if (pts.length >= 3) {
    const mx = pts.reduce((t, p) => t + p[0], 0) / pts.length;
    const my = pts.reduce((t, p) => t + p[1], 0) / pts.length;
    const sxy = pts.reduce((t, p) => t + (p[0] - mx) * (p[1] - my), 0);
    const sxx = pts.reduce((t, p) => t + (p[0] - mx) ** 2, 0);
    const bars = Math.max(...expected.map((e) => e.bar));
    driftMsAtEnd = sxx > 0 ? (sxy / sxx) * bars : 0;
  }
  return { stops, restarts, driftMsAtEnd };
}
