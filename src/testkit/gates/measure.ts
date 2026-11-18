/**
 * Per-take measurements against the scenario's ground truth (P18, 01 section 13.2).
 *
 * Ground truth comes from the render (P3: 7.4 onsets and pitch on the dry signal) and the perturbation plan. Verdict
 * ground truth is derived from the resolved tolerances with the same rule functions the follower and the grader use
 * (`classifyPitch`, `intonationVerdict`, `noteVerdict`), applied to the true onset and pitch: "scenarios provide truth
 * labels; P18 derives verdicts from tolerances" (BUILD-NOTES P3).
 *
 * Guard band: a note whose true timing error lies within `TIMING_GUARD_MS` of tRed or of the match window, whose true
 * deviation lies within `CENTS_GUARD` of redCents, or whose true steady time lies within `STEADY_GUARD_MS` of the
 * minimum steady time while its deviation is beyond red, has no measurable right answer (the detector's own error is
 * of that size: 01 section 8.1, 8.4). Those notes are counted and compared separately (`boundary`) and kept out of
 * the agreement gate.
 */
import type { Configs, ExpectedNote, FollowerEvent, PitchVerdict, ResolvedTolerance } from '../../core/types.ts';
import { classifyPitch, intonationVerdict, liveIntonationEligible, noteVerdict } from '../../rules/index.ts';
import { toMidi } from '../../theory/index.ts';
import type { ScenarioRender, ScenarioTruthNote } from '../scenarios/index.ts';
import { TIMBRES } from '../synth/timbres.ts';
import type { TakeRun } from './run-take.ts';
import type { CentsSample, ConditionId, Job, OnsetSample, TakeRecord } from './types.ts';

export const ONSET_TOL_SEC = 0.03;
export const TIMING_GUARD_MS = 15;
export const CENTS_GUARD = 5;
export const STEADY_GUARD_MS = 40;
/** In-tune for the false-red count: no injected intonation error and |true deviation| at most this. */
export const IN_TUNE_MAX_CENTS = 10;
/** A false extra this close to a bleed click, with no played note within `CLICK_CLEAR_SEC`, is click-induced. */
const CLICK_NEAR_SEC = 0.025;
const CLICK_CLEAR_SEC = 0.08;
/** A detected extra this close to a played extra or displaced note is that note. */
const EXTRA_MATCH_SEC = 0.06;

const pitchGroup = (p: PitchVerdict | null): string => (p === 'in-tune' || p === 'not-graded' || p === null ? 'ok' : p);
const mod = (n: number, m: number): number => ((n % m) + m) % m;

function floorClassOf(r: ScenarioRender, t: ScenarioTruthNote): OnsetSample['floorClass'] {
  if (r.plan.base.inst.family === 'voice') return 'voice';
  return t.onsetRule === 'pitch-change' ? 'slurred' : 'articulated';
}

function vibratoOn(r: ScenarioRender): boolean {
  const v = r.plan.performance.vibrato;
  return v === undefined ? TIMBRES[r.plan.base.timbre].vibrato !== null : v !== null;
}

/** Greedy one-to-one onset matching at ±30 ms (as the P4c and P4d gates): playedIdx -> detected id. */
function matchOnsets(r: ScenarioRender, run: TakeRun): { tp: number; fp: number; fn: number; pairs: Map<number, number> } {
  const det = run.detected;
  const required = r.truth.filter((t) => t.detectable).sort((a, b) => a.onsetSec - b.onsetSec);
  const optional = r.truth.filter((t) => !t.detectable);
  const used = new Set<number>();
  const pairs = new Map<number, number>();
  let tp = 0;
  let fn = 0;
  for (const t of required) {
    let best = -1;
    let bd = Infinity;
    det.forEach((n, j) => {
      if (used.has(j)) return;
      const d = Math.abs((n.onset as number) - t.onsetSec);
      if (d < bd) {
        bd = d;
        best = j;
      }
    });
    if (best >= 0 && bd <= ONSET_TOL_SEC) {
      used.add(best);
      pairs.set(t.playedIdx, best);
      tp++;
    } else fn++;
  }
  let fp = 0;
  det.forEach((n, j) => {
    if (used.has(j)) return;
    if (optional.some((t) => Math.abs(t.onsetSec - (n.onset as number)) <= ONSET_TOL_SEC)) return;
    fp++;
  });
  return { tp, fp, fn, pairs };
}

interface TruthVerdict {
  status: 'matched' | 'missed';
  timing: string | null;
  pitch: string;
  boundary: boolean;
}

function truthVerdict(e: ExpectedNote, tol: ResolvedTolerance, t: ScenarioTruthNote | undefined, r: ScenarioRender, cfg: Configs): TruthVerdict {
  if (!t) return { status: 'missed', timing: null, pitch: 'ok', boundary: false };
  const inst = r.plan.base.inst;
  const deltaMs = (t.scoreOnsetSec - e.onsetSec) * 1000;
  const c = classifyPitch(e.concertMidi, t.midi + t.cents / 100, 0, inst, cfg);
  const steadyMs = (t.offsetSec - t.onsetSec) * 1000 - tol.attackExcludeMs;
  const intonation = c.kind === 'correct' ? intonationVerdict(c.devCents, steadyMs, tol) : 'not-graded';
  const v = noteVerdict({ deltaMs, pitch: c, intonation }, tol);
  const tRedMs = tol.tRedSec * 1000;
  const winMs = tol.matchWindowSec * 1000;
  let boundary = Math.abs(Math.abs(deltaMs) - tRedMs) < TIMING_GUARD_MS || Math.abs(Math.abs(deltaMs) - winMs) < TIMING_GUARD_MS;
  if (c.kind === 'correct' && tol.redCents !== null) {
    if (Math.abs(Math.abs(c.devCents) - tol.redCents) < CENTS_GUARD) boundary = true;
    if (Math.abs(c.devCents) > tol.redCents - CENTS_GUARD && Math.abs(steadyMs - tol.minSteadyMs) < STEADY_GUARD_MS) boundary = true;
  }
  if (Math.abs(deltaMs) > winMs) return { status: 'missed', timing: null, pitch: 'ok', boundary };
  return { status: 'matched', timing: v.timing, pitch: pitchGroup(v.pitch), boundary };
}

export interface MeasureMeta {
  job: Job;
  condition: ConditionId;
  expectedDisplaced?: { fromIdx: number; toIdx: number; offsetBeats: number }[];
  skipped?: string | null;
}

export function measureTake(r: ScenarioRender, run: TakeRun, meta: MeasureMeta): TakeRecord {
  const cfg = run.config.cfg;
  const { base } = r.plan;
  const inst = base.inst;
  const cond = r.capture.conditions;
  const pert = r.plan.perturbation;

  // ---- onsets
  const m = matchOnsets(r, run);
  const samples: OnsetSample[] = [];
  const cents: CentsSample[] = [];
  const vib = vibratoOn(r);
  for (const [pi, dj] of m.pairs) {
    const t = r.truth[pi] as ScenarioTruthNote;
    const d = run.detected[dj];
    if (!d) continue;
    samples.push({ rule: t.onsetRule, floorClass: floorClassOf(r, t), errMs: ((d.onset as number) - t.onsetSec) * 1000 });
    const truthMidi = t.midi + t.cents / 100;
    const err = (d.midi - truthMidi) * 100;
    if (Math.abs(err) < 50 && d.steadyMs > 0) cents.push({ errCents: err, steadyMs: d.steadyMs, vibrato: vib });
  }

  // ---- verdicts against ground truth
  const truthByExpected = new Map<number, ScenarioTruthNote>();
  r.truth.forEach((t) => {
    if (t.truth.kind === 'match') truthByExpected.set(t.truth.idx, t);
  });
  const finalBy = new Map(run.alignment.judgments.map((j) => [j.expectedIdx, j]));
  const liveBy = new Map<number, { t: number; pitch: string | null; timing: string | null }[]>();
  const ghostBy = new Map<number, Extract<FollowerEvent, { type: 'ghost' }>['ghost']>();
  let lostPlace = 0;
  for (const { t, event } of run.live) {
    if (event.type === 'judgment') {
      const list = liveBy.get(event.judgment.expectedIdx) ?? [];
      list.push({ t, pitch: event.judgment.pitch, timing: event.judgment.timing });
      liveBy.set(event.judgment.expectedIdx, list);
    } else if (event.type === 'ghost' && event.ghost.targetExpectedIdx !== null) {
      ghostBy.set(event.ghost.targetExpectedIdx, event.ghost);
    } else if (event.type === 'status' && event.kind === 'lost-place') lostPlace++;
  }

  const verdict: TakeRecord['verdict'] = { n: 0, agree: 0, boundary: 0, boundaryAgree: 0, examples: [] };
  let truthMatched = 0;
  let falseMissed = 0;
  let pitchClassN = 0;
  let pitchClassOk = 0;
  let octaveErrors = 0;
  const falseRed = { eligible: 0, live: 0, final: 0, liveWrong: 0 };
  const judgmentLatencyMs: number[] = [];
  const intonationLatencyMs: number[] = [];
  const ghostSpelling: TakeRecord['ghostSpelling'] = { n: 0, ok: 0, examples: [] };

  for (const e of base.expected) {
    const tol = run.tolerances[e.idx] as ResolvedTolerance;
    const t = truthByExpected.get(e.idx);
    const tv = truthVerdict(e, tol, t, r, cfg);
    const j = finalBy.get(e.idx);
    const got = j ? { status: j.status, timing: j.timing, pitch: pitchGroup(j.pitch) } : { status: 'missed', timing: null, pitch: 'ok' };
    const agree = got.status === tv.status && (tv.status === 'missed' || (got.timing === tv.timing && got.pitch === tv.pitch));
    if (tv.boundary) {
      verdict.boundary++;
      if (agree) verdict.boundaryAgree++;
    } else {
      verdict.n++;
      if (agree) verdict.agree++;
      else if (verdict.examples.length < 5) {
        const tt = t ? ` true Δ ${((t.scoreOnsetSec - e.onsetSec) * 1000).toFixed(0)} ms, ${(t.midi + t.cents / 100 - e.concertMidi).toFixed(2)} st` : '';
        verdict.examples.push(`#${e.idx}: truth ${tv.status} ${tv.timing ?? ''} ${tv.pitch}${tt}; final ${got.status} ${got.timing ?? ''} ${got.pitch}${j?.timingErrorMs !== null && j?.timingErrorMs !== undefined ? ` (${j.timingErrorMs.toFixed(0)} ms)` : ''}`);
      }
    }
    if (!t || tv.status !== 'matched') continue;
    truthMatched++;
    if (!tv.boundary && j?.status === 'missed') falseMissed++;
    const truthMidi = t.midi + t.cents / 100;
    if (j?.status === 'matched' && j.playedConcertMidi !== null) {
      pitchClassN++;
      const dp = Math.round(j.playedConcertMidi);
      const tp = Math.round(truthMidi);
      if (mod(dp, 12) === mod(tp, 12)) pitchClassOk++;
      if (dp !== tp && (dp - tp) % 12 === 0) octaveErrors++;
    }
    const lives = liveBy.get(e.idx) ?? [];
    if (j?.status === 'matched' && lives.length > 0) judgmentLatencyMs.push(((lives[0] as { t: number }).t - t.onsetSec) * 1000);

    const nt = pert.notes[e.idx];
    const injectedPitch = nt ? nt.errors.some((k) => k === 'cents' || k === 'semitone' || k === 'octave') : false;
    const c = classifyPitch(e.concertMidi, truthMidi, 0, inst, cfg);
    if (!injectedPitch && c.kind === 'correct' && Math.abs(c.devCents) <= IN_TUNE_MAX_CENTS && liveIntonationEligible(e, tol) && j?.status === 'matched') {
      falseRed.eligible++;
      if (lives.some((x) => x.pitch === 'sharp' || x.pitch === 'flat')) falseRed.live++;
      if (lives.some((x) => x.pitch === 'wrong-pitch' || x.pitch === 'octave')) falseRed.liveWrong++;
      if (j.pitch === 'sharp' || j.pitch === 'flat') falseRed.final++;
    }
    if (nt?.errors.includes('cents') && tv.pitch !== 'ok') {
      const first = lives.find((x) => x.pitch === tv.pitch);
      if (first) intonationLatencyMs.push((first.t - t.onsetSec) * 1000);
    }
    if (nt && nt.semis !== 0 && j?.pitch === 'wrong-pitch') {
      const g = ghostBy.get(e.idx);
      if (g && g.kind === 'wrong-pitch') {
        ghostSpelling.n++;
        const playedWritten = e.concertMidi + nt.semis + inst.semis;
        const sameLetter = g.writtenPitch.step === e.writtenPitch.step;
        const ok = toMidi(g.writtenPitch) === playedWritten && (Math.abs(nt.semis) <= 1 ? sameLetter : !sameLetter);
        if (ok) ghostSpelling.ok++;
        else if (ghostSpelling.examples.length < 5) {
          const w = g.writtenPitch;
          ghostSpelling.examples.push(`#${e.idx} target ${e.writtenPitch.step}${e.writtenPitch.alter}/${e.writtenPitch.octave} played ${nt.semis > 0 ? '+' : ''}${nt.semis} st, ghost ${w.step}${w.alter}/${w.octave}`);
        }
      }
    }
  }

  // ---- extras
  const legitExtras = r.truth.filter((t) => t.truth.kind !== 'match').map((t) => t.scoreOnsetSec);
  const allOnsets = r.truth.map((t) => t.scoreOnsetSec);
  const bleedTimes = r.bleedClickTimes.map((x) => x - r.t0Sec);
  let falseExtras = 0;
  let clickExtras = 0;
  for (const x of run.alignment.extras) {
    const s = x.onsetSec as number;
    if (legitExtras.some((y) => Math.abs(y - s) <= EXTRA_MATCH_SEC)) continue;
    falseExtras++;
    if (bleedTimes.some((c) => Math.abs(c - s) <= CLICK_NEAR_SEC) && !allOnsets.some((y) => Math.abs(y - s) <= CLICK_CLEAR_SEC)) clickExtras++;
  }

  return {
    job: meta.job,
    id: r.plan.id,
    timbre: base.timbre,
    instrumentId: base.instrumentId,
    family: inst.family,
    windowSamples: inst.detection.windowSamples,
    condition: meta.condition,
    outputMode: run.outputMode,
    roomRt60: cond.room?.rt60Sec ?? null,
    bleed: cond.clickBleed ? `${cond.clickBleed.timbre} ${cond.clickBleed.bleedDb} dB` : null,
    skipped: meta.skipped ?? null,
    onset: { tp: m.tp, fp: m.fp, fn: m.fn, samples },
    cents,
    verdict,
    truthMatched,
    falseMissed,
    falseExtras,
    clickExtras,
    judgments: run.alignment.judgments.length,
    rejudged: run.alignment.judgments.filter((j) => j.rejudged).length,
    pitchClassN,
    pitchClassOk,
    octaveErrors,
    falseRed,
    judgmentLatencyMs,
    intonationLatencyMs,
    ghostSpelling,
    patterns: run.score.patterns.map((p) => p.id),
    displaced: run.alignment.displaced.map((d) => ({ fromIdx: d.fromIdx, toIdx: d.toIdx, offsetBeats: d.offsetBeats as number })),
    expectedDisplaced: meta.expectedDisplaced ?? pert.displaced,
    lostPlace,
    score: run.score.score as number,
    grade: run.score.grade,
    hopP95Ms: run.hopP95Ms,
  };
}
