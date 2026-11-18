/**
 * Session summary (02 §6.1 item 8; 04 §5.10; PLAN ruling 55). Pure: the session's attempt records and the tip catalog
 * in, numbers, patterns and tips out. Shown after "Done for now" or every `selection.summary.every` attempts.
 *
 * - Takes, average graded score, XP and the best graded take.
 * - The top `selection.summary.topPatterns` patterns of the session (the clean read excluded), ranked by how many
 *   attempts fired them, then by their total lostPoints, then by catalog order. Each carries its tip: the tip the
 *   player was last shown for that pattern in this session, else the first enabled universal tip of the pattern at the
 *   level of its latest attempt whose placeholders fill, else (given `familyOf`) such a family tip of that attempt's
 *   instrument that asserts no cause (02 §6.1 item 5). The evidence line is the latest attempt's.
 * - A text-only focus card when one pattern was primary in at least `focus.minPrimary` of the last `focus.ofLast`
 *   attempts (recent primaries, most recent first; the clean read never becomes a focus).
 *
 * `TipsApi` (frozen) names only `selectTips`; this is exported beside it and re-exported by session/ for the app.
 */
import type { AttemptRecord, PatternResult, Tip, TipCatalog, TipDef } from '../core/types.ts';
import { evidenceLine, fillTipText } from './text.ts';

export interface SessionSummaryInput {
  /** This practice session's attempts, oldest first. */
  attempts: readonly AttemptRecord[];
  catalog: TipCatalog;
  /** Primary pattern per recent attempt on the active instrument, most recent first. */
  recentPrimaries: readonly string[];
  /** The profile's streak, days (0 when none). */
  streakDays: number;
  /**
   * Family of an instrument id (tips/ may not read the instrument table). With it, a pattern that has no universal
   * tip (E16 is family-only) falls back to a family tip of the attempt's instrument that asserts no cause.
   */
  familyOf?: (instrumentId: string) => string | undefined;
}

export interface SummaryPattern {
  id: string;
  /** Pattern name from the catalog (≤ 40 characters). */
  name: string;
  /** Attempts of the session that fired it. */
  count: number;
  /** Sum of its lostPoints over those attempts. */
  lostPoints: number;
  /** Its tip, or null when the catalog has none that applies. */
  tip: Tip | null;
}

export interface SessionSummary {
  takes: number;
  /** Mean of the graded scores, rounded; null when nothing was graded. */
  averageScore: number | null;
  xp: number;
  best: { attemptId: string; score: number; title: string } | null;
  patterns: SummaryPattern[];
  streakDays: number;
  /** The focus card's pattern, or null. */
  focus: { id: string; name: string } | null;
}

/** "Work: movement", or the work alone (04 §5.10 best take). */
export const attemptTitle = (a: AttemptRecord): string => (a.credit.movement ? `${a.credit.work}: ${a.credit.movement}` : a.credit.work);

/** True after every Nth attempt of the session (02 §6.1 item 8: every 10). */
export function summaryDue(attemptsThisSession: number, catalog: TipCatalog): boolean {
  const every = catalog.selection.summary.every;
  return every > 0 && attemptsThisSession > 0 && attemptsThisSession % every === 0;
}

/** The focus card's pattern id (02 §6.1 item 8), or null. */
export function focusPatternId(recentPrimaries: readonly string[], catalog: TipCatalog): string | null {
  const { minPrimary, ofLast } = catalog.selection.summary.focus;
  const tally = new Map<string, number>();
  for (const id of recentPrimaries.slice(0, ofLast)) {
    if (id === catalog.selection.cleanReadPatternId) continue;
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [id, n] of tally) if (n >= minPrimary && (best === null || n > (tally.get(best) ?? 0))) best = id;
  return best;
}

interface Occurrence {
  attempt: AttemptRecord;
  result: PatternResult;
}

function tipOf(def: TipDef, occ: Occurrence, catalog: TipCatalog): Tip | null {
  const text = fillTipText(def.text, occ.result.params);
  if (text === null) return null;
  const pdef = catalog.patterns.find((p) => p.id === occ.result.id);
  return {
    id: def.id,
    patternId: occ.result.id,
    text,
    evidence: evidenceLine(occ.result, pdef, catalog),
    bars: [...new Set(occ.result.bars)].sort((a, b) => a - b),
    primary: false,
  };
}

/** The tip for a pattern from its occurrences in the session (latest last). */
function summaryTip(patternId: string, occs: readonly Occurrence[], catalog: TipCatalog, familyOf: SessionSummaryInput['familyOf']): Tip | null {
  const forPattern = catalog.tips.filter((t) => t.enabled && t.patterns.includes(patternId));
  // The tip last shown for this pattern.
  for (let k = occs.length - 1; k >= 0; k--) {
    const occ = occs[k] as Occurrence;
    for (const id of occ.attempt.score?.tipsShown ?? []) {
      const def = forPattern.find((t) => t.id === id);
      const tip = def ? tipOf(def, occ, catalog) : null;
      if (tip) return tip;
    }
  }
  const latest = occs[occs.length - 1];
  if (!latest) return null;
  const level = latest.attempt.levelServed;
  const inLevel = (d: TipDef): boolean => level >= d.minLevel && level <= d.maxLevel;
  for (const def of forPattern) {
    if (def.scope !== 'universal' || !inLevel(def)) continue;
    const tip = tipOf(def, latest, catalog);
    if (tip) return tip;
  }
  const instrumentId = latest.attempt.instrumentId;
  const family = familyOf?.(instrumentId);
  if (family === undefined) return null;
  for (const def of forPattern) {
    if (def.scope !== 'family' || def.family !== family || def.assertsCause || !inLevel(def)) continue;
    if (def.instruments && !def.instruments.includes(instrumentId)) continue;
    const tip = tipOf(def, latest, catalog);
    if (tip) return tip;
  }
  return null;
}

export function summarizeSession(i: SessionSummaryInput): SessionSummary {
  const cat = i.catalog;
  const sel = cat.selection;
  const graded = i.attempts.filter((a) => a.score !== null && a.listening);
  const averageScore = graded.length ? Math.round(graded.reduce((n, a) => n + (a.score?.score ?? 0), 0) / graded.length) : null;
  const xp = i.attempts.reduce((n, a) => n + (a.score?.xp.total ?? 0), 0);
  let best: SessionSummary['best'] = null;
  for (const a of graded) {
    const score = a.score?.score ?? 0;
    if (!best || score > best.score) best = { attemptId: a.id, score, title: attemptTitle(a) };
  }

  const occurrences = new Map<string, Occurrence[]>();
  for (const a of i.attempts) {
    if (a.endReason === 'void') continue;
    const seen = new Set<string>();
    for (const p of a.score?.patterns ?? []) {
      if (p.id === sel.cleanReadPatternId || seen.has(p.id)) continue;
      seen.add(p.id);
      const list = occurrences.get(p.id);
      if (list) list.push({ attempt: a, result: p });
      else occurrences.set(p.id, [{ attempt: a, result: p }]);
    }
  }
  const order = (id: string): number => {
    const k = cat.patterns.findIndex((p) => p.id === id);
    return k < 0 ? Number.MAX_SAFE_INTEGER : k;
  };
  const name = (id: string): string => cat.patterns.find((p) => p.id === id)?.name ?? id;
  const patterns: SummaryPattern[] = [...occurrences.entries()]
    .map(([id, occs]) => ({ id, occs, count: occs.length, lostPoints: occs.reduce((n, o) => n + o.result.lostPoints, 0) }))
    .sort((a, b) => b.count - a.count || b.lostPoints - a.lostPoints || order(a.id) - order(b.id))
    .slice(0, sel.summary.topPatterns)
    .map((p) => ({ id: p.id, name: name(p.id), count: p.count, lostPoints: Math.round(p.lostPoints * 10) / 10, tip: summaryTip(p.id, p.occs, cat, i.familyOf) }));

  const focusId = focusPatternId(i.recentPrimaries, cat);
  return {
    takes: i.attempts.length,
    averageScore,
    xp,
    best,
    patterns,
    streakDays: i.streakDays,
    focus: focusId === null ? null : { id: focusId, name: name(focusId) },
  };
}
