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
import { copy } from '../../../ui/copy/copy.ts';
import { beatUnit } from '../setup/model.ts';
import { keyName } from '../setup/key-names.ts';
import { servedMeter } from '../history/model.ts';
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
  const id = weakestComponent(s);
  // "Notes is the one to work on" only when that component is below 90: nothing to work on in a clean one.
  return id !== null && (s.components[id] ?? 100) < FOCUS_BELOW ? id : null;
}

/** A component scoring this or more is not named as the one to work on. */
export const FOCUS_BELOW = 90;

function weakestComponent(s: AttemptScore): ComponentId | null {
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

/** The drift line shows only from this size, ms (round 2, 01-ux: a few milliseconds is not worth a sentence). */
export const DRIFT_MIN_MS = 20;

/**
 * Drift in words (05 section 8.11): "You slowed down slightly by the end", with "(24 ms)" only when the player shows
 * cents and milliseconds in review. Null when there is no drift to name.
 */
export function driftLine(s: AttemptScore, showMs = false): string | null {
  const drift = s.diagnostics.driftMsAtEnd;
  if (drift === null || Math.abs(drift) < DRIFT_MIN_MS) return null;
  const words = text(drift > 0 ? 'results.drift.behind' : 'results.drift.ahead');
  return showMs ? `${words} ${text('results.drift.ms', { ms: Math.round(Math.abs(drift)) })}` : words;
}

/** Plain text lines: stops, drift, restarts. Omitted when empty (02 section 4.6). */
export function diagnosticLines(s: AttemptScore, showMs = false): string[] {
  const d = s.diagnostics;
  const out: string[] = [];
  for (const st of d.stops) out.push(text('results.stops', { n: d.stops.length, bar: st.bar, beats: Math.round(st.beats) }));
  const drift = driftLine(s, showMs);
  if (drift) out.push(drift);
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
    // The difficulty offer (05 section 4.4): "Go to difficulty 3" or "Stay at difficulty 2".
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

// ---- header state (05 section 8.11) ----------------------------------------------------------

/**
 * The results header's state: which badge, which reason line, and what the score area shows.
 * - `ranked`: Ranked badge, no reason.
 * - `practice`: Practice by choice, no reason (the badge says it).
 * - `practice-reason`: Practice with the reason from `ranked.reason.*` (for example "You listened first").
 * - `not-calibrated`: Practice with `ranked.reason.calibration` and "Calibrate now".
 * - `void`: "Not graded" heading, the void reason, the clean score with its line, its own actions.
 * - `not-listening`: practised without listening: "Not graded · no XP", the clean score.
 * - `incomplete`: Incomplete badge with its explanation as visible text.
 */
export type HeaderStateKind = 'ranked' | 'practice' | 'practice-reason' | 'not-calibrated' | 'void' | 'not-listening' | 'incomplete';

export interface HeaderState {
  kind: HeaderStateKind;
  badge: 'ranked' | 'practice' | 'not-graded' | 'incomplete' | null;
  /** The visible reason line, or null. */
  reason: string | null;
  /** Show "Calibrate now" next to the reason. */
  calibrateNow: boolean;
  /** The score area shows the clean score, no marks. */
  clean: boolean;
}

export function headerState(record: AttemptRecord, cfg: Configs): HeaderState {
  const s = record.score;
  if (record.endReason === 'void') {
    return { kind: 'void', badge: 'not-graded', reason: record.voidReason ? text(voidKey(record.voidReason)) : null, calibrateNow: false, clean: true };
  }
  if (!record.listening || !s) return { kind: 'not-listening', badge: null, reason: null, calibrateNow: false, clean: true };
  if (s.status === 'incomplete') {
    return { kind: 'incomplete', badge: 'incomplete', reason: text('badge.incomplete.tooltip', { cap: cfg.grading.gates.incompleteScoreCap }), calibrateNow: false, clean: false };
  }
  if (s.ranked) return { kind: 'ranked', badge: 'ranked', reason: null, calibrateNow: false, clean: false };
  const reasons = s.rankedReasons.filter((r) => r !== 'practice-mode');
  if (reasons.length === 0) return { kind: 'practice', badge: 'practice', reason: null, calibrateNow: false, clean: false };
  const calibration = reasons.includes('calibration');
  // The calibration reason leads, since it carries the one fix on this screen.
  const ordered = calibration ? ['calibration' as const, ...reasons.filter((r) => r !== 'calibration')] : reasons;
  return {
    kind: calibration ? 'not-calibrated' : 'practice-reason',
    badge: 'practice',
    reason: ordered.map(reasonText).join(' '),
    calibrateNow: calibration,
    clean: false,
  };
}

function voidKey(reason: NonNullable<AttemptRecord['voidReason']>): TextKey {
  switch (reason) {
    case 'interrupted':
      return 'void.interrupted';
    case 'no-signal':
      return 'void.noSignal';
    case 'device-change':
      return 'void.deviceChange';
    case 'backlog':
      return 'void.backlog';
    case 'capture-gap':
      return 'void.captureGap';
    case 'stopped-before-first-note':
      return 'void.stopped';
  }
}

/** The rank line beside the XP: "Student · 81% to Section player", or "Rank 10 of 10" at the top. */
export function rankLine(cfg: Configs, profile: Pick<PlayerProfile, 'xp' | 'rank'>): { text: string; fraction: number } {
  const bar = rankBar(cfg, profile);
  if (!bar.next) return { text: bar.label, fraction: 1 };
  if (bar.needsLevel) return { text: bar.label, fraction: 1 };
  return { text: text('home.rankLine', { rank: bar.name, percent: Math.round(bar.fraction * 100), nextRank: bar.next.name }), fraction: bar.fraction };
}

// ---- "One thing to try" hear buttons (06 section 6.15) ------------------------------------------

export interface HearSpan {
  from: number;
  to: number;
  label: string;
}

/**
 * The hear buttons for a tip's bars: a bar on its own is "Hear bar 2"; a run of bars is heard two bars at a time from
 * its start, "Hear bars 3 to 4" (a longer run is too long to hear twice). At most three buttons.
 */
export function hearSpans(bars: readonly number[], max = 3): HearSpan[] {
  const sorted = [...new Set(bars)].filter((b) => Number.isFinite(b) && b >= 1).sort((a, b) => a - b);
  const out: HearSpan[] = [];
  let i = 0;
  while (i < sorted.length && out.length < max) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    const from = sorted[i]!;
    if (j === i) out.push({ from, to: from, label: text('action.hearBar', { bar: from }) });
    else {
      const to = Math.min(sorted[j]!, from + 1);
      out.push({ from, to, label: text('action.hearBars', { from, to }) });
    }
    i = j + 1;
  }
  return out;
}

// ---- the header summary, from the stored record (01-ux 16.3) ----------------------------------------------

/**
 * "Difficulty 1 · F major · 4/4 · ♩ = 60 · 8 bars" from the stored try, so it reads the same after a reload. The meter
 * and the bar count come from what was asked when that was a number, else from the prepared excerpt when it is the
 * same piece; a part that cannot be told is left out, never "random".
 */
export function recordSummary(record: AttemptRecord, prepared?: { meter: { beats: number; beatType: number }; measures: readonly { isPickup?: boolean }[] } | null): string {
  const meter = servedMeter(record, prepared);
  const asked = record.settingsResolved.bars;
  const bars = typeof asked === 'number' ? asked : prepared ? prepared.measures.filter((m) => !m.isPickup).length : null;
  const parts = [
    copy('progress.instrumentLevel', { level: record.levelServed }),
    keyName(record.writtenKey),
    ...(meter ? [meter] : []),
    copy('tempo.marking', { unit: beatUnit(meter ?? '4/4'), bpm: record.bpm }),
    ...(bars !== null ? [copy('setup.length.chip', { bars })] : []),
  ];
  return parts.join(' \u00b7 ');
}
