/**
 * Aggregation of take records into the gate results of 01 section 13.2 and the PLAN rulings (19, 40, 45, 47, 50, 54).
 *
 * Thresholds are the spec's and the rulings', never tuned to the measurement. A gate that fails is reported as failing.
 */
import type { Configs, FloorViolation, MeasurementBudget } from '../../core/types.ts';
import { checkFloors } from '../../rules/index.ts';
import { GOLDEN_CASES, type GoldenCase } from '../scenarios/index.ts';
import { CONDITIONS, INJECTED_PATTERNS, LAUNCH_TIMBRES, type ConditionId, type OnsetSample, type TakeRecord } from './types.ts';

export const quantile = (xs: readonly number[], q: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] as number;
};
const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = (xs: readonly number[]): number | null => {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const rms = (xs: readonly number[]): number | null => (xs.length ? Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length) : null);
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export interface ErrorStats {
  n: number;
  mean: number | null;
  sd: number | null;
  rms: number | null;
  e90: number | null;
}
export function errorStats(xs: readonly number[]): ErrorStats {
  return { n: xs.length, mean: mean(xs), sd: sd(xs), rms: rms(xs), e90: quantile(xs.map(Math.abs), 0.9) };
}

export interface InstrumentStats {
  takes: number;
  tp: number;
  fp: number;
  fn: number;
  f1: number | null;
  verdictN: number;
  verdictAgree: number | null;
  boundaryN: number;
  boundaryAgree: number | null;
  falseMissedRate: number | null;
  falseExtrasPerTake: number | null;
  clickExtras: number;
  divergence: number | null;
  pitchClassAcc: number | null;
  octaveRate: number | null;
  falseRedEligible: number;
  falseRedLive: number | null;
  falseRedFinal: number | null;
  falseWrongLive: number | null;
  onset: ErrorStats;
  /** 01 section 8.4 subsets: non-vibrato >= 250 ms steady, vibrato >= 360 ms steady, and every graded note (>= 150 ms). */
  c90Steady: number | null;
  c90SteadyN: number;
  c90All: number | null;
  vibrato: boolean;
  examples: string[];
}

export interface GateResult {
  id: string;
  scope: string;
  metric: string;
  value: number | null;
  op: '>=' | '<=' | '==';
  threshold: number;
  pass: boolean;
  source: string;
  note?: string | undefined;
}

export interface Summary {
  takes: number;
  skipped: { job: string; why: string }[];
  perInstrument: Record<ConditionId, Record<string, InstrumentStats>>;
  onsetByClass: Record<ConditionId, Record<string, ErrorStats>>;
  onsetByRule: Record<ConditionId, Record<string, Record<string, ErrorStats>>>;
  latency: Record<string, { n: number; p50: number | null; p95: number | null; max: number | null }>;
  intonationLatency: Record<string, { n: number; p50: number | null; p95: number | null }>;
  hopP95Ms: number | null;
  displacement: Record<string, { renders: number; pass: number; lostPlaceOnce: number; examples: string[] }>;
  perfect: { n: number; onlyE30: number; anyNonE30: number; fired: Record<string, number>; e30: number };
  tips: Record<string, { n: number; skipped: number; hits: number; cross: Record<string, number>; timbres: Record<string, number> }>;
  ghost: { n: number; ok: number; examples: string[] };
  floorViolations: FloorViolation[];
  measuredSigma: Record<string, { measured: number | null; table: number; used: number }>;
  measuredC90: { measured: number | null; table: number };
  gates: GateResult[];
}

const scenarioRecords = (rs: readonly TakeRecord[], c: ConditionId, timbre?: string): TakeRecord[] =>
  rs.filter((r) => r.job.kind === 'scenario' && r.condition === c && (timbre === undefined || r.timbre === timbre));

function instrumentStats(rs: readonly TakeRecord[]): InstrumentStats {
  const sum = (f: (r: TakeRecord) => number): number => rs.reduce((a, r) => a + f(r), 0);
  const tp = sum((r) => r.onset.tp);
  const fp = sum((r) => r.onset.fp);
  const fn = sum((r) => r.onset.fn);
  const vib = rs.some((r) => r.cents.some((c) => c.vibrato));
  const steady = rs.flatMap((r) => r.cents.filter((c) => c.steadyMs >= (c.vibrato ? 360 : 250)).map((c) => Math.abs(c.errCents)));
  const all = rs.flatMap((r) => r.cents.filter((c) => c.steadyMs >= 150).map((c) => Math.abs(c.errCents)));
  const fr = { e: sum((r) => r.falseRed.eligible), l: sum((r) => r.falseRed.live), f: sum((r) => r.falseRed.final), w: sum((r) => r.falseRed.liveWrong) };
  return {
    takes: rs.length,
    tp,
    fp,
    fn,
    f1: tp + fp + fn > 0 ? (2 * tp) / (2 * tp + fp + fn) : null,
    verdictN: sum((r) => r.verdict.n),
    verdictAgree: ratio(sum((r) => r.verdict.agree), sum((r) => r.verdict.n)),
    boundaryN: sum((r) => r.verdict.boundary),
    boundaryAgree: ratio(sum((r) => r.verdict.boundaryAgree), sum((r) => r.verdict.boundary)),
    falseMissedRate: ratio(sum((r) => r.falseMissed), sum((r) => r.truthMatched)),
    falseExtrasPerTake: ratio(sum((r) => r.falseExtras), rs.length),
    clickExtras: sum((r) => r.clickExtras),
    divergence: ratio(sum((r) => r.rejudged), sum((r) => r.judgments)),
    pitchClassAcc: ratio(sum((r) => r.pitchClassOk), sum((r) => r.pitchClassN)),
    octaveRate: ratio(sum((r) => r.octaveErrors), sum((r) => r.pitchClassN)),
    falseRedEligible: fr.e,
    falseRedLive: ratio(fr.l, fr.e),
    falseRedFinal: ratio(fr.f, fr.e),
    falseWrongLive: ratio(fr.w, fr.e),
    onset: errorStats(rs.flatMap((r) => r.onset.samples.map((s) => s.errMs))),
    c90Steady: quantile(steady, 0.9),
    c90SteadyN: steady.length,
    c90All: quantile(all, 0.9),
    vibrato: vib,
    examples: rs.flatMap((r) => r.verdict.examples.map((x) => `${r.id}: ${x}`)).slice(0, 6),
  };
}

/** 01 section 12: sound-to-judgment p95 by window class. 1024: 75 ms budget, 79 ms accepted by PLAN ruling 47. */
export const LATENCY_P95_MS: Record<string, { limit: number; budget: number; source: string }> = {
  '512': { limit: 60, budget: 60, source: '01 §12' },
  '1024': { limit: 79, budget: 75, source: '01 §12, PLAN R47 (79 ms accepted)' },
  '2048': { limit: 105, budget: 105, source: '01 §12' },
};

/** Ruling 54: reverberant rooms are a known limit for these launch instruments (the R45 target was missed). */
export const R54_ROOM_LIMIT = new Set(['voice', 'cello', 'violin', 'flute']);

function sigmaBudget(budget: MeasurementBudget, measured: Record<string, number | null>): { budget: MeasurementBudget; info: Summary['measuredSigma'] } {
  const det: Record<string, string> = { articulated: 'detector-articulated', slurred: 'detector-slurred', voice: 'detector-voice' };
  const path = budget.timingFloors.worstRankedPath;
  const phone = path.startsWith('phone');
  const info: Summary['measuredSigma'] = {};
  const totals = budget.onsetError.totals.map((t) => {
    if (t.path !== path) return t;
    const comp = budget.onsetError.components.find((c) => c.id === det[t.floorClass]);
    const table = (phone ? comp?.phoneMs : comp?.laptopMs) ?? 0;
    const m = measured[t.floorClass] ?? null;
    const used = Math.max(m ?? 0, table);
    info[t.floorClass] = { measured: m, table, used };
    // 01 §8.2: sigma_detector = max(measured synthetic sigma, table value); the other components are unchanged.
    return { ...t, sigmaMs: Math.sqrt(Math.max(0, t.sigmaMs ** 2 - table ** 2 + used ** 2)) };
  });
  return { budget: { ...budget, onsetError: { ...budget.onsetError, totals } }, info };
}

function segmentsMatch(got: TakeRecord['displaced'], want: TakeRecord['expectedDisplaced']): boolean {
  if (got.length !== want.length) return false;
  return want.every((w) => got.some((g) => Math.abs(g.offsetBeats - w.offsetBeats) < 0.25 && Math.abs(g.fromIdx - w.fromIdx) <= 1 && Math.abs(g.toIdx - w.toIdx) <= 1));
}

export function summarize(records: readonly TakeRecord[], cfg: Configs): Summary {
  const gates: GateResult[] = [];
  const gate = (g: Omit<GateResult, 'pass'>): void => {
    const v = g.value;
    const pass = v !== null && (g.op === '>=' ? v >= g.threshold - 1e-12 : g.op === '<=' ? v <= g.threshold + 1e-12 : v === g.threshold);
    gates.push({ ...g, pass });
  };
  const conditions = CONDITIONS.filter((c) => records.some((r) => r.job.kind === 'scenario' && r.condition === c));

  const perInstrument = {} as Summary['perInstrument'];
  const onsetByClass = {} as Summary['onsetByClass'];
  const onsetByRule = {} as Summary['onsetByRule'];
  for (const c of conditions) {
    perInstrument[c] = {};
    onsetByRule[c] = {};
    for (const t of LAUNCH_TIMBRES) {
      const rs = scenarioRecords(records, c, t);
      if (rs.length === 0) continue;
      perInstrument[c][t] = instrumentStats(rs);
      const byRule: Record<string, number[]> = {};
      for (const s of rs.flatMap((r) => r.onset.samples)) (byRule[s.rule] ??= []).push(s.errMs);
      onsetByRule[c][t] = Object.fromEntries(Object.entries(byRule).map(([k, v]) => [k, errorStats(v)]));
    }
    const byClass: Record<string, number[]> = {};
    for (const s of scenarioRecords(records, c).flatMap((r) => r.onset.samples) as OnsetSample[]) (byClass[s.floorClass] ??= []).push(s.errMs);
    onsetByClass[c] = Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, errorStats(v)]));
  }

  // ---- per-instrument 13.2 gates (clean and the device condition) and the R45 room target
  for (const c of conditions) {
    for (const [t, s] of Object.entries(perInstrument[c])) {
      const scope = `${t} / ${c}`;
      if (c === 'planned') {
        gate({ id: 'room-f1', scope, metric: 'onset F1 at ±30 ms', value: s.f1, op: '>=', threshold: 0.93, source: 'PLAN R45', note: R54_ROOM_LIMIT.has(t) ? 'known limit in reverberant rooms (PLAN R54)' : undefined });
        continue;
      }
      gate({ id: 'onset-f1', scope, metric: 'onset F1 at ±30 ms', value: s.f1, op: '>=', threshold: 0.97, source: '01 §13.2' });
      gate({ id: 'pitch-class', scope, metric: 'pitch-class accuracy on matched notes', value: s.pitchClassAcc, op: '>=', threshold: 0.99, source: '01 §13.2' });
      gate({ id: 'octave', scope, metric: 'octave error rate', value: s.octaveRate, op: '<=', threshold: 0.005, source: '01 §13.2' });
      gate({ id: 'verdict', scope, metric: 'judgment agreement with ground truth', value: s.verdictAgree, op: '>=', threshold: 0.95, source: '01 §13.2' });
      gate({ id: 'false-missed', scope, metric: 'false missed rate', value: s.falseMissedRate, op: '<=', threshold: 0.01, source: '01 §13.2' });
      gate({ id: 'false-extras', scope, metric: 'false extras per take', value: s.falseExtrasPerTake, op: '<=', threshold: 1, source: '01 §13.2' });
      if (c === 'device') gate({ id: 'click-extras', scope, metric: 'click-induced extras', value: s.clickExtras, op: '==', threshold: 0, source: '01 §13.2' });
      gate({ id: 'divergence', scope, metric: 'live vs final divergence', value: s.divergence, op: '<=', threshold: 0.03, source: '01 §13.2' });
      if (s.falseRedEligible > 0) gate({ id: 'false-red', scope, metric: 'live sharp/flat on in-tune notes', value: s.falseRedLive, op: '<=', threshold: 0.01, source: 'PLAN R19' });
      if (c === 'clean' && s.c90SteadyN > 0) {
        gate({ id: 'c90', scope, metric: s.vibrato ? 'c90, vibrato, >= 360 ms steady' : 'c90, non-vibrato, >= 250 ms steady', value: s.c90Steady, op: '<=', threshold: 5, source: '01 §8.4' });
      }
    }
  }

  // ---- latency (clean and device takes; capture conditions do not change the analysis path's timing)
  const latRecords = records.filter((r) => r.job.kind === 'scenario' && r.condition !== 'planned');
  const latency: Summary['latency'] = {};
  for (const w of ['512', '1024', '2048']) {
    const xs = latRecords.filter((r) => String(r.windowSamples) === w).flatMap((r) => r.judgmentLatencyMs);
    if (xs.length === 0) continue;
    latency[w] = { n: xs.length, p50: quantile(xs, 0.5), p95: quantile(xs, 0.95), max: quantile(xs, 1) };
    const L = LATENCY_P95_MS[w] as (typeof LATENCY_P95_MS)[string];
    gate({ id: 'latency', scope: `window ${w}`, metric: 'sound to judgment p95, ms', value: latency[w].p95, op: '<=', threshold: L.limit, source: L.source, note: L.limit !== L.budget ? `budget ${L.budget} ms` : undefined });
  }
  const intonationLatency: Summary['intonationLatency'] = {};
  for (const t of LAUNCH_TIMBRES) {
    const xs = records.filter((r) => r.job.kind === 'scenario' && r.timbre === t).flatMap((r) => r.intonationLatencyMs);
    if (xs.length) intonationLatency[t] = { n: xs.length, p50: quantile(xs, 0.5), p95: quantile(xs, 0.95) };
  }
  const hops = records.map((r) => r.hopP95Ms).filter((x): x is number => x !== null);

  // ---- false reds over all launch instruments (ruling 19 decides on the whole set)
  for (const c of conditions.filter((x) => x !== 'planned')) {
    const rs = scenarioRecords(records, c);
    const e = rs.reduce((a, r) => a + r.falseRed.eligible, 0);
    const l = rs.reduce((a, r) => a + r.falseRed.live, 0);
    gate({ id: 'false-red-all', scope: `all launch / ${c}`, metric: 'live sharp/flat on in-tune notes', value: ratio(l, e), op: '<=', threshold: 0.01, source: 'PLAN R19' });
  }

  // ---- floors with the measured detector error (01 §8.2: sigma_detector = max(measured, table))
  const device = onsetByClass['device'] ?? onsetByClass['clean'] ?? {};
  const measured: Record<string, number | null> = { articulated: device['articulated']?.rms ?? null, slurred: device['slurred']?.rms ?? null, voice: device['voice']?.rms ?? null };
  const sb = sigmaBudget(cfg.budget, measured);
  const allC90 = quantile(scenarioRecords(records, 'device').flatMap((r) => r.cents.filter((c) => c.steadyMs >= 150).map((c) => Math.abs(c.errCents))), 0.9);
  const budget2: MeasurementBudget = { ...sb.budget, cents: { ...sb.budget.cents, c90Cents: Math.max(allC90 ?? 0, cfg.budget.cents.c90Cents) } };
  const floorViolations = conditions.length ? checkFloors(cfg, budget2) : [];
  if (conditions.length) gate({ id: 'floors', scope: 'all', metric: 'floor check with measured sigma and c90 (violations)', value: floorViolations.length, op: '==', threshold: 0, source: '01 §8.2, §13.2' });

  // ---- displacement (golden cases)
  const displacement: Summary['displacement'] = {};
  for (const gc of GOLDEN_CASES) {
    const rs = records.filter((r) => r.job.kind === 'golden' && r.job.case === gc);
    if (rs.length === 0) continue;
    const ok = rs.filter((r) => segmentsMatch(r.displaced, r.expectedDisplaced));
    const wantsLost = rs[0]?.expectedDisplaced.length ? 1 : 0;
    displacement[gc] = {
      renders: rs.length,
      pass: ok.length,
      lostPlaceOnce: rs.filter((r) => r.lostPlace === wantsLost).length,
      examples: rs.filter((r) => !ok.includes(r)).slice(0, 4).map((r) => `${r.id}: got ${JSON.stringify(r.displaced.map((d) => [d.fromIdx, d.toIdx, +d.offsetBeats.toFixed(2)]))}`),
    };
    gate({ id: 'displacement', scope: gc as GoldenCase, metric: 'renders with the expected segments', value: ratio(ok.length, rs.length), op: '>=', threshold: 0.95, source: '01 §13.2' });
  }

  // ---- tip precision (02 §6.2)
  const perf = records.filter((r) => r.job.kind === 'perfect');
  const fired: Record<string, number> = {};
  for (const r of perf) for (const p of r.patterns) fired[p] = (fired[p] ?? 0) + 1;
  const anyNon = perf.filter((r) => r.patterns.some((p) => p !== 'E30')).length;
  const perfect = { n: perf.length, onlyE30: perf.filter((r) => r.patterns.every((p) => p === 'E30')).length, anyNonE30: anyNon, fired, e30: fired['E30'] ?? 0 };
  if (perf.length) gate({ id: 'tips-perfect', scope: `${perf.length} perfect takes`, metric: 'takes firing a pattern other than E30', value: anyNon, op: '==', threshold: 0, source: '02 §6.2' });
  const tips: Summary['tips'] = {};
  for (const p of INJECTED_PATTERNS) {
    const all = records.filter((r) => r.job.kind === 'tip' && r.job.pattern === p);
    if (all.length === 0) continue;
    const rs = all.filter((r) => !r.skipped);
    const cross: Record<string, number> = {};
    const timbres: Record<string, number> = {};
    for (const r of rs) {
      timbres[r.timbre] = (timbres[r.timbre] ?? 0) + 1;
      for (const q of r.patterns) if (q !== p && q !== 'E30') cross[q] = (cross[q] ?? 0) + 1;
    }
    const hits = rs.filter((r) => r.patterns.includes(p)).length;
    tips[p] = { n: rs.length, skipped: all.length - rs.length, hits, cross, timbres };
    gate({ id: 'tips-hit', scope: p, metric: 'injected pattern fires', value: rs.length ? hits / rs.length : null, op: '>=', threshold: 0.9, source: '02 §6.2', note: rs.length ? undefined : 'no fitting excerpt' });
    const worst = Object.entries(cross).sort((a, b) => b[1] - a[1])[0];
    gate({ id: 'tips-cross', scope: p, metric: `worst cross-firing${worst ? ` (${worst[0]})` : ''}`, value: rs.length ? (worst?.[1] ?? 0) / rs.length : null, op: '<=', threshold: 0.05, source: '02 §6.2' });
  }

  // ---- ghost spelling (ruling 50)
  const gr = records.filter((r) => r.job.kind === 'scenario' || r.job.kind === 'tip');
  const ghost = { n: gr.reduce((a, r) => a + r.ghostSpelling.n, 0), ok: gr.reduce((a, r) => a + r.ghostSpelling.ok, 0), examples: gr.flatMap((r) => r.ghostSpelling.examples.map((x) => `${r.id}: ${x}`)).slice(0, 6) };
  if (ghost.n) gate({ id: 'ghost-spelling', scope: 'all wrong notes with a ghost', metric: 'ghosts spelled per ruling 50', value: ghost.ok / ghost.n, op: '>=', threshold: 1, source: 'PLAN R50' });

  return {
    takes: records.length,
    skipped: records.filter((r) => r.skipped).map((r) => ({ job: JSON.stringify(r.job), why: r.skipped as string })),
    perInstrument,
    onsetByClass,
    onsetByRule,
    latency,
    intonationLatency,
    hopP95Ms: quantile(hops, 0.95),
    displacement,
    perfect,
    tips,
    ghost,
    floorViolations,
    measuredSigma: sb.info,
    measuredC90: { measured: allC90, table: cfg.budget.cents.c90Cents },
    gates,
  };
}
