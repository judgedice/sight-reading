/** Pure view models for the results panel (04 section 5.5). No React; every value comes from the AttemptRecord. */
import type {
  AttemptRecord,
  AttemptScore,
  Configs,
  ExcerptCreditSnapshot,
  Instrument,
  PatternDef,
  PlayerProfile,
  ProgressEvent,
  RankedReason,
  Tip,
  VerdictCounts,
} from '../../../core/types.ts';
import { text, type TextKey } from './text.ts';

// ---- header credit line (5.5.1) -------------------------------------------------------------

/** "Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC0"; CC BY items also end "· {corpus} · Adapted". */
export function creditLine(c: ExcerptCreditSnapshot): string {
  const work = c.catalog ? text('credit.work', { title: c.work, catalog: c.catalog }) : text('credit.workOnly', { title: c.work });
  const base = text('credit.line', {
    composer: c.composer,
    dates: c.composerDates ?? '',
    work,
    a: c.sourceMeasures[0],
    b: c.sourceMeasures[1],
    licenceShort: text(`licence.${c.license}`),
  });
  const line = c.composerDates ? base : base.replace(' ()', '');
  return c.license === 'CC-BY-4.0' ? `${line} · ${text(`corpus.${c.corpus}`)} · ${text('credit.sheet.adapted')}` : line;
}

// ---- badges (5.5.2) -------------------------------------------------------------------------

export type BadgeKind = 'ranked' | 'practice' | 'incomplete' | 'timing-offset' | 'beta';

export interface Badge {
  kind: BadgeKind;
  label: string;
  /** Reason or explanation. For practice the first reason is `detail` and the rest are `tooltip`. */
  detail?: string;
  tooltip?: string;
}

const reasonText = (r: RankedReason): string => text(`ranked.reason.${r}`);

export function badgesFor(record: AttemptRecord, cfg: Configs): Badge[] {
  const s = record.score;
  if (!s) return [];
  const out: Badge[] = [];
  if (s.ranked) {
    out.push({ kind: 'ranked', label: text('badge.ranked') });
  } else {
    const [first, ...rest] = s.rankedReasons;
    const b: Badge = { kind: 'practice', label: text('badge.practice') };
    if (first) b.detail = reasonText(first);
    if (rest.length) b.tooltip = rest.map(reasonText).join(' ');
    out.push(b);
  }
  if (s.status === 'incomplete') {
    out.push({
      kind: 'incomplete',
      label: text('badge.incomplete'),
      detail: text('badge.incomplete.tooltip', { cap: cfg.grading.gates.incompleteScoreCap }),
    });
  }
  if (record.calibration.method === 'reported') out.push({ kind: 'timing-offset', label: text('badge.timingOffset') });
  if (record.beta) out.push({ kind: 'beta', label: text('badge.beta') });
  return out;
}

// ---- components (5.5.3) ---------------------------------------------------------------------

export type ComponentId = 'P' | 'I' | 'R';

export interface ComponentRow {
  id: ComponentId;
  label: string;
  /** null: nothing to judge (no bar, no number). */
  value: number | null;
  explainer: string;
  detail?: string;
  unavailableText?: string;
}

/** The component that lost the most points: w × (100 − value) with the attempt's own weights (never the lowest). */
export function focusComponent(s: AttemptScore): ComponentId | null {
  let best: ComponentId | null = null;
  let bestLost = 0;
  for (const id of ['P', 'I', 'R'] as const) {
    const v = s.components[id];
    if (v === null) continue;
    const lost = s.weights[id] * (100 - v);
    if (lost > bestLost + 1e-9) {
      best = id;
      bestLost = lost;
    }
  }
  return best;
}

/** Median of the absolute timing error over notes judged early or late, ms, and which side most of them sit on. */
export function typicalTiming(record: AttemptRecord): { ms: number; side: 'behind' | 'ahead' } | null {
  const errs: number[] = [];
  for (const j of record.judgments) {
    if (j.status === 'matched' && (j.timing === 'early' || j.timing === 'late') && j.timingErrorMs !== null) errs.push(j.timingErrorMs);
  }
  if (errs.length === 0) return null;
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const mid = Math.floor(abs.length / 2);
  const median = abs.length % 2 ? abs[mid]! : (abs[mid - 1]! + abs[mid]!) / 2;
  const behind = errs.filter((e) => e > 0).length;
  return { ms: Math.round(median), side: behind * 2 >= errs.length ? 'behind' : 'ahead' };
}

export function componentRows(record: AttemptRecord, instrument: Instrument | undefined): ComponentRow[] {
  const s = record.score;
  if (!s) return [];
  const fixed = instrument?.pitchKind === 'fixed';
  const c = s.diagnostics.counts;
  const rows: ComponentRow[] = [];
  const wrongish = c.wrong + c.octave;
  rows.push({
    id: 'P',
    label: text('component.notes.label'),
    value: s.components.P,
    explainer: text('component.notes.explain'),
    detail: [text('results.counts.right', { n: c.correct }), text('results.counts.wrong', { n: wrongish }), text('results.counts.missed', { n: c.missed }), text('results.counts.extra', { n: c.extra })].join(', '),
  });
  if (!fixed) {
    const row: ComponentRow = {
      id: 'I',
      label: text('component.inTune.label'),
      value: s.components.I,
      explainer: text('component.inTune.explain'),
      unavailableText: text('component.inTune.notEnough'),
    };
    if (s.components.I !== null) row.detail = text('results.counts.pitch', { n: c.sharp + c.flat });
    rows.push(row);
  }
  const typical = typicalTiming(record);
  const rhythm: ComponentRow = {
    id: 'R',
    label: text('component.rhythm.label'),
    value: s.components.R,
    explainer: text(fixed ? 'component.rhythm.keyboard' : 'component.rhythm.explain'),
  };
  if (typical) rhythm.detail = text('component.detail', { late: c.late, early: c.early, ms: typical.ms, side: text(typical.side === 'behind' ? 'component.side.behind' : 'component.side.ahead') });
  rows.push(rhythm);
  return rows;
}

// ---- diagnostics and counts (5.5.3) ---------------------------------------------------------

/** Plain text lines: stops, drift, restarts. Omitted when empty (02 section 4.6). */
export function diagnosticLines(s: AttemptScore): string[] {
  const d = s.diagnostics;
  const out: string[] = [];
  for (const st of d.stops) out.push(text('results.stops', { n: d.stops.length, bar: st.bar, beats: Math.round(st.beats) }));
  if (d.driftMsAtEnd !== null && Math.abs(d.driftMsAtEnd) >= 1) {
    const ms = Math.round(Math.abs(d.driftMsAtEnd));
    out.push(text(d.driftMsAtEnd > 0 ? 'results.drift.behind' : 'results.drift.ahead', { ms }));
  }
  for (const r of d.restarts) out.push(text('results.restart', { bar: r.bar, n: r.notesReplayed }));
  return out;
}

export type CountKind = 'total' | 'correct' | 'timing' | 'pitch' | 'wrong' | 'missed' | 'extra';

export interface CountPart {
  kind: CountKind;
  n: number;
  label: string;
}

/** "42 notes · 35 right · 3 early or late · 2 out of tune · 1 wrong note · 1 missed · 1 extra", zeros omitted. */
export function countParts(s: AttemptScore): CountPart[] {
  const d = s.diagnostics;
  const c: VerdictCounts = d.counts;
  const parts: [CountKind, number, string][] = [
    ['total', d.n, text('results.counts.total', { n: d.n })],
    ['correct', c.correct, text('results.counts.right', { n: c.correct })],
    ['timing', c.early + c.late, text('results.counts.timing', { n: c.early + c.late })],
    ['pitch', c.sharp + c.flat, text('results.counts.pitch', { n: c.sharp + c.flat })],
    ['wrong', c.wrong + c.octave, text('results.counts.wrong', { n: c.wrong + c.octave })],
    ['missed', c.missed, text('results.counts.missed', { n: c.missed })],
    ['extra', c.extra, text('results.counts.extra', { n: c.extra })],
  ];
  return parts.filter(([k, n]) => k === 'total' || k === 'correct' || n > 0).map(([kind, n, label]) => ({ kind, n, label }));
}

export function rejudgedCount(record: AttemptRecord): number {
  return record.judgments.reduce((n, j) => n + (j.rejudged ? 1 : 0), 0);
}

/** More than 10% of the attempt's notes re-judged: results banner (6.6). */
export function manyRejudged(record: AttemptRecord): boolean {
  const n = record.judgments.length;
  return n > 0 && rejudgedCount(record) / n > 0.1;
}

export function clippingBanner(record: AttemptRecord, cfg: Configs): boolean {
  const f = record.score?.diagnostics.signal.clippingFrac ?? 0;
  return f > cfg.grading.gates.clippingBannerFrac;
}

// ---- XP, rank and level (5.5.4) -------------------------------------------------------------

export interface XpView {
  headline: string | null;
  /** Lines for factors not equal to 1.00, base first. Empty for practice and no-XP attempts. */
  factors: string[];
}

const fmt2 = (v: number): string => (Math.round(v * 100) / 100).toFixed(2);

function randomLabel(record: AttemptRecord): TextKey | null {
  const s = record.settingsResolved;
  const rand: TextKey[] = [];
  if (s.writtenKey === 'random') rand.push('xp.factor.randomKey');
  if (s.meter === 'random') rand.push('xp.factor.randomMeter');
  if (s.bpm === 'random') rand.push('xp.factor.randomTempo');
  return rand.length === 1 ? rand[0]! : null;
}

export function xpView(record: AttemptRecord, cfg: Configs, profile: PlayerProfile | undefined): XpView {
  const s = record.score;
  if (!s || !record.listening) return { headline: null, factors: [] };
  const x = cfg.progression.xp;
  const byId = new Map(s.xp.factors.map((f) => [f.id, f.value]));
  if (s.status === 'incomplete') return { headline: text('xp.none.incomplete'), factors: [] };
  if (byId.get('repeat') === 0 || (s.xp.total === 0 && byId.has('repeat'))) return { headline: text('xp.none.repeat'), factors: [] };
  if (byId.has('practice') || byId.has('repeat')) {
    const mult = byId.get('practice') ?? byId.get('repeat') ?? x.practiceMult;
    return { headline: text('xp.practice', { xp: s.xp.total, percent: Math.round(mult * 100) }), factors: [] };
  }
  const factors: string[] = [text('xp.factor.levelBase', { level: record.levelServed, value: s.xp.base })];
  for (const f of s.xp.factors) {
    if (Math.abs(f.value - 1) < 0.005) continue;
    const value = fmt2(f.value);
    switch (f.id) {
      case 'q':
        factors.push(text('xp.factor.score', { value }));
        break;
      case 'm_tempo':
        factors.push(text('results.xp.factor.tempo', { value }));
        break;
      case 'm_random': {
        const key = randomLabel(record);
        factors.push(key ? text(key, { value }) : text('results.xp.factor.random', { value }));
        break;
      }
      case 'm_mode':
        factors.push(text('results.xp.factor.countInOnly', { value }));
        break;
      case 'm_streak':
        factors.push(text('xp.factor.streak', { days: profile ? Math.min(profile.streak.days, x.streakMaxDays) : Math.round((f.value - 1) / x.streakPerDay), value }));
        break;
      case 'm_daily':
        factors.push(text('xp.factor.dailyLimit', { limit: x.dailyFullCount, value }));
        break;
      case 'm_below':
        factors.push(text('xp.factor.belowLevel', { value }));
        break;
      default:
        break;
    }
  }
  return { headline: text('xp.headline', { xp: s.xp.total }), factors };
}

export interface RankBar {
  rank: number;
  name: string;
  total: number;
  xp: number;
  next: { name: string; xp: number; minLevel: number } | null;
  /** 0..1: (xp - current threshold) / (next threshold - current threshold); 1 at the top rank. */
  fraction: number;
  /** XP reached but the minimum level is not (the bar is full). */
  needsLevel: boolean;
  label: string;
}

export function rankBar(cfg: Configs, profile: Pick<PlayerProfile, 'xp' | 'rank'>): RankBar {
  const table = cfg.progression.ranks.table;
  const rank = Math.min(table.length, Math.max(1, profile.rank));
  const cur = table.find((r) => r.rank === rank) ?? table[0]!;
  const nxt = table.find((r) => r.rank === rank + 1) ?? null;
  const fraction = nxt ? Math.min(1, Math.max(0, (profile.xp - cur.xp) / Math.max(1, nxt.xp - cur.xp))) : 1;
  const needsLevel = nxt !== null && profile.xp >= nxt.xp;
  let label: string;
  if (!nxt) label = text('rank.header', { n: rank, total: table.length });
  else if (needsLevel) label = `${cur.name} · ${text('rank.bar.needsLevel', { level: nxt.minLevel })}`;
  else label = text('rank.bar', { rank: cur.name, n: rank, total: table.length, xp: profile.xp.toLocaleString('en'), next: nxt.xp.toLocaleString('en'), nextRank: nxt.name, level: nxt.minLevel });
  return { rank, name: cur.name, total: table.length, xp: profile.xp, next: nxt ? { name: nxt.name, xp: nxt.xp, minLevel: nxt.minLevel } : null, fraction, needsLevel, label };
}

export type LevelCard =
  | { kind: 'offer'; instrumentId: string; from: number; to: number; text: string }
  | { kind: 'auto'; instrumentId: string; from: number; to: number; text: string }
  | { kind: 'down'; instrumentId: string; level: number; lower: number; text: string };

/** Level cards for this instrument from the attempt's progress events. */
export function levelCards(events: readonly ProgressEvent[], instrumentId: string, cfg: Configs): LevelCard[] {
  const out: LevelCard[] = [];
  const auto = cfg.progression.levelWindow.auto;
  for (const e of events) {
    if (e.type === 'level-up-offer' && e.instrumentId === instrumentId) out.push({ kind: 'offer', instrumentId, from: e.from, to: e.to, text: text('level.offer', { level: e.from, next: e.to }) });
    else if (e.type === 'level-up-auto' && e.instrumentId === instrumentId) out.push({ kind: 'auto', instrumentId, from: e.from, to: e.to, text: text('level.autoUp', { level: e.to, n: auto.consecutive, score: auto.score }) });
    else if (e.type === 'level-down-suggestion' && e.instrumentId === instrumentId) {
      const lower = Math.max(cfg.progression.placement.minLevel, e.level - 1);
      out.push({ kind: 'down', instrumentId, level: e.level, lower, text: text('level.down', { level: e.level, lower }) });
    }
  }
  return out;
}

/** The personal-best ribbon: "New best at level 5" from a 'best' event for this instrument. */
export function personalBest(events: readonly ProgressEvent[], instrumentId: string): string | null {
  const e = events.find((x) => x.type === 'best' && x.instrumentId === instrumentId);
  return e && e.type === 'best' ? text('results.personalBest', { level: e.level }) : null;
}

export function rankUpEvent(events: readonly ProgressEvent[]): Extract<ProgressEvent, { type: 'rank-up' }> | null {
  for (const e of events) if (e.type === 'rank-up') return e;
  return null;
}

// ---- tips ----------------------------------------------------------------------------------

export function patternDef(cfg: Configs, id: string): PatternDef | undefined {
  return cfg.tips.patterns.find((p) => p.id === id);
}

export function dimensionLabel(dimension: PatternDef['dimension']): string {
  return text(`tips.dimension.${dimension}` as TextKey);
}

export function tipHeadline(cfg: Configs, tip: Tip): string {
  if (tip.patternId === cfg.tips.selection.cleanReadPatternId) return text('tips.cleanRead');
  return patternDef(cfg, tip.patternId)?.name ?? tip.patternId;
}

/** The one-line tip preview on results (04 section 5.6, with the interstitial off). */
export function tipPreview(cfg: Configs, tips: readonly Tip[]): { line: string; evidence: string } | null {
  const t = tips.find((x) => x.primary) ?? tips[0];
  if (!t) return null;
  return { line: text('results.tipPreview', { headline: tipHeadline(cfg, t) }), evidence: t.evidence };
}
