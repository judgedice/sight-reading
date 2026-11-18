/**
 * Components, weights, gates, letter grade (02 §4.3 to §4.7). Reads the per-note credits the final alignment carries
 * (`NoteJudgment.credit`, 02 §4.3) and every weight and cutoff from `config/grading-config.json`.
 */
import type { Configs, FinalAlignment, Instrument, LetterGrade, VerdictCounts } from '../core/types.ts';

export interface ComponentResult {
  P: number;
  I: number | null;
  R: number;
  weights: { P: number; I: number; R: number };
  raw: number;
  matched: number;
  n: number;
  status: 'ok' | 'incomplete';
  score: number;
  grade: LetterGrade;
  stars: 0 | 1 | 2 | 3;
  shine: boolean;
  counts: VerdictCounts;
}

const PERCENT = 100;

export function inLevels(level: number, r: readonly [number, number]): boolean {
  return level >= r[0] && level <= r[1];
}

/** 02 §4.4 weights, moving I's weight to P when I is not judged or the instrument is below 80 Hz. */
export function weightsFor(inst: Instrument, level: number, iJudged: boolean, cfg: Configs): { P: number; I: number; R: number } {
  const group = inst.pitchKind === 'fixed' ? 'fixed' : 'continuous';
  const row = cfg.grading.components.weights.find((w) => w.group === group && inLevels(level, w.levels));
  if (!row) throw new Error(`grade: no component weight row for ${group} at level ${level}`);
  if (!iJudged || inst.lowFundamental) return { P: row.P + row.I, I: 0, R: row.R };
  return { P: row.P, I: row.I, R: row.R };
}

export function letterFor(score: number, cfg: Configs): { grade: LetterGrade; stars: 0 | 1 | 2 | 3; shine: boolean } {
  const rows = [...cfg.grading.grades.scale].sort((a, b) => b.minScore - a.minScore);
  const row = rows.find((r) => score >= r.minScore) ?? rows[rows.length - 1];
  if (!row) throw new Error('grade: empty grade scale');
  return { grade: row.grade, stars: row.stars, shine: row.shine };
}

export function countVerdicts(a: FinalAlignment): VerdictCounts {
  const c: VerdictCounts = { correct: 0, early: 0, late: 0, sharp: 0, flat: 0, wrong: 0, octave: 0, missed: 0, extra: a.extras.length };
  for (const j of a.judgments) {
    if (j.status === 'missed') {
      c.missed++;
      continue;
    }
    if (j.timing === 'early') c.early++;
    if (j.timing === 'late') c.late++;
    if (j.pitch === 'sharp') c.sharp++;
    if (j.pitch === 'flat') c.flat++;
    if (j.pitch === 'wrong-pitch') c.wrong++;
    if (j.pitch === 'octave') c.octave++;
    if (j.timing === 'on-time' && (j.pitch === 'in-tune' || j.pitch === 'not-graded')) c.correct++;
  }
  return c;
}

export function computeComponents(a: FinalAlignment, inst: Instrument, level: number, cfg: Configs): ComponentResult {
  const g = cfg.grading;
  const js = a.judgments;
  const n = js.length;
  const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
  // Displaced notes are never in `extras` (01 §9.6), so a replay leaves the extras term unchanged.
  const P = n === 0 ? 0 : (PERCENT * sum(js.map((j) => j.credit.p))) / (n + g.credit.extrasWeight * a.extras.length);
  const nGraded: number[] = [];
  const dGraded: number[] = [];
  for (const j of js) {
    if (j.credit.n !== null) nGraded.push(j.credit.n);
    if (j.credit.d !== null) dGraded.push(j.credit.d);
  }
  const I = nGraded.length >= g.components.intonationMinNotes ? (PERCENT * sum(nGraded)) / nGraded.length : null;
  const meanO = n === 0 ? 0 : sum(js.map((j) => j.credit.o)) / n;
  const R =
    dGraded.length > 0
      ? PERCENT * (g.components.rhythm.onsetWeight * meanO + g.components.rhythm.durationWeight * (sum(dGraded) / dGraded.length))
      : PERCENT * meanO;
  const weights = weightsFor(inst, level, I !== null, cfg);
  const raw = weights.P * P + weights.I * (I ?? 0) + weights.R * R;
  const matched = js.filter((j) => j.status === 'matched').length;
  const status = n === 0 || matched / n < g.gates.incompleteBelowMatchedFrac ? 'incomplete' : 'ok';
  const rounded = Math.round(raw);
  const score = status === 'incomplete' ? Math.min(rounded, g.gates.incompleteScoreCap) : rounded;
  return { P, I, R, weights, raw, matched, n, status, score, ...letterFor(score, cfg), counts: countVerdicts(a) };
}
