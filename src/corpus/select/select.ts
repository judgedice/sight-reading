/**
 * Excerpt selection (01 §6.3; 02 §2.6 and R22; 03 §7.2 to §7.5).
 *
 * Steps, in order:
 * 1. Resolve the level (random: uniform over the served levels from the player's level − 2 to the player's level,
 *    R22 "at or below the player's"). Key, meter, tempo and length stay open until an excerpt is chosen, so a random
 *    setting never produces an empty pool that another value would fill.
 * 2. Build the candidate pool from the manifest: intrinsic level L, L − 1 and stretch (exactly one feature at L + 1);
 *    filters of 03 §7.2 and 02 §2.6; range fit (03 §7.3) per allowed written key; tempo clipping (03 §7.5 rule 5).
 *    Each fitting written key is checked against the spelling rule (03 §7.5 rule 3) from the manifest's `spelling`
 *    column; a random key that fails is retried once with its enharmonic, a chosen key that fails is dropped (R1).
 *    Tempo clipping uses the manifest's `peakNotesPerBeat` (PLAN ruling 44), so the manifest alone decides
 *    eligibility exactly and `prepareExcerpt` on the chosen doc does not throw for a consistent corpus.
 * 3. Draw a pool (level / below / stretch) with the configured shares, then a weighted excerpt (fit margin, bar-count
 *    preference, variety by `work`, unseen first in practice), then for a random key a weighted written key
 *    (02 §2.6 rule 6).
 */
import type { CorpusApi, SelectExcerptResult } from '../../core/api.ts';
import type {
  Configs,
  CorpusManifest,
  FeatureKey,
  Instrument,
  KeySig,
  LevelDef,
  ManifestEntry,
  PracticeSettings,
  ResolvedSettings,
  Rng,
  SelectionHistory,
  SelectionResult,
} from '../../core/types.ts';
import { createRng } from '../../core/rng.ts';
import { enharmonicKey, isValidKey } from '../../theory/index.ts';
import { fitsInKey, shiftWindow, windowFits, type ShiftChoice } from '../transpose/fit.ts';
import { judgeSpelling, planTransposition } from '../transpose/spell.ts';
import {
  allowedWrittenKeys,
  bandFor,
  chooseClef,
  getInstrument,
  isBbEbF,
  isStrings,
  isWindOrBrass,
  keyAllowed,
  levelDef,
  needsBreath,
  parseMeter,
  sameKey,
} from './levels.ts';
import { bpmPlayable, clippedTempo, type TempoFacts } from './tempo.ts';

/** Levels 1..10 (02 §2.3). */
const MAX_LEVEL = 10;
/** Random level draws from the player's level down by this many levels (R22: at or below the player's). */
const RANDOM_LEVEL_SPAN = 2;
/** `leapy` excludes winds and brass up to this level (03 §7.2). */
const LEAPY_MAX_LEVEL = 6;
/** `bass-line` is served only up to this level (03 §7.2). */
const BASS_LINE_MAX_LEVEL = 5;

// Variety weights for the weighted pick (01 §6.3 step 7). These shape which eligible excerpt comes up; they never
// make an excerpt eligible or ineligible.
const W_BARS_PREFERRED = 3;
const W_RECENT_WORK = 0.3;
const RECENT_WORKS_N = 5;
const W_RECENT_ID = 0.1;
const RECENT_IDS_N = 10;
const W_SEEN_PRACTICE = 0.25;
const MARGIN_SATURATION = 4;

export type PoolId = 'level' | 'below' | 'stretch';

/**
 * A meter is shown on the setup screen when it has at least this many eligible excerpts for the instrument at the
 * difficulty (redesign 05 section 5.5). Mirrors `tokens.ui.meterChipMinExcerpts`, which this package may not import;
 * a test keeps the two equal.
 */
export const METER_MIN_EXCERPTS = 5;

/** Options beyond the frozen `selectExcerpt` signature. */
export interface SelectOptions {
  /** Entry ids to skip. */
  excludeIds?: ReadonlySet<string>;
  /** Internal: skip computing suggestions (used while computing them). */
  noSuggestions?: boolean;
  /** Threshold for the meters "Any" time draws from (default `METER_MIN_EXCERPTS`). */
  meterMinExcerpts?: number;
}

interface KeyOption {
  key: KeySig;
  shift: ShiftChoice;
  weight: number;
  /** The drawn random key failed the spelling rule and `key` is its enharmonic (03 §7.5 rule 3). */
  enharmonicRetry: boolean;
}

interface Candidate {
  entry: ManifestEntry;
  pool: PoolId;
  keys: KeyOption[];
  tempo: { minBpm: number; maxBpm: number };
  weight: number;
}

/** A request with the level resolved and every other random field left open (null). */
interface Request {
  inst: Instrument;
  level: number;
  def: LevelDef;
  meter: string | null;
  /** With time set to Any: the meters the setup screen shows, the only ones drawn from (05 section 5.5). */
  anyMeters: ReadonlySet<string> | null;
  writtenKey: KeySig | null;
  bpm: number | null;
  bars: 8 | 10 | 12 | null;
  ranked: boolean;
}

const FEATURES: readonly FeatureKey[] = ['meter', 'rhythm', 'interval', 'leaps', 'span', 'mode', 'chromatic', 'double', 'density'];

/** 02 §2.6 rules 1 to 3: which pool an entry belongs to at level L, or null when it is never served at L. */
export function poolOf(entry: ManifestEntry, level: number): PoolId | null {
  if (entry.level === level) return 'level';
  if (entry.level === level - 1) return 'below';
  if (entry.level === level + 1) {
    let above = 0;
    for (const k of FEATURES) {
      const v = entry.featureLevels[k];
      if (v > level + 1) return null;
      if (v === level + 1) above++;
    }
    return above === 1 ? 'stretch' : null;
  }
  return null;
}

function flagAllowed(entry: ManifestEntry, req: Request): boolean {
  for (const f of entry.flags) {
    if (f === 'noBreath' && needsBreath(req.inst)) return false;
    if (f === 'leapy' && isWindOrBrass(req.inst) && req.level <= LEAPY_MAX_LEVEL) return false;
    if (f === 'bass-line' && (req.inst.clefs[0]?.clef !== 'bass' || req.level > BASS_LINE_MAX_LEVEL)) return false;
  }
  return true;
}

function keyWeight(k: KeySig, req: Request, cfg: Configs): number {
  const rk = cfg.levels.selection.randomKey;
  let w = 1;
  if (isStrings(req.inst) && k.fifths > 0) w *= rk.stringsSharpWeight;
  if (isBbEbF(req.inst) && req.level <= rk.lowAccMaxLevel && Math.abs(k.fifths) <= rk.lowAccMax) w *= rk.transposingLowAccWeight;
  return w;
}

/** Keys that would make the same written key appear more than `maxSameKeyInRow` times in a row (02 §2.6 rule 6). */
function blockedKey(h: SelectionHistory, cfg: Configs): KeySig | null {
  const n = cfg.levels.selection.randomKey.maxSameKeyInRow;
  const recent = h.recentWrittenKeys;
  if (n <= 0 || recent.length < n) return null;
  const first = recent[0]!;
  for (let i = 1; i < n; i++) if (!sameKey(recent[i]!, first)) return null;
  return first;
}

function tempoFacts(entry: ManifestEntry): TempoFacts {
  return {
    meter: parseMeter(entry.meter),
    minBpm: entry.minBpm,
    maxBpm: entry.maxBpm,
    minIoiTicks: entry.minIoiTicks,
    minRepeatIoiTicks: entry.minRepeatIoiTicks,
    peakNotesPerBeat: entry.peakNotesPerBeat,
  };
}

/** Spelling verdicts per instrument and entry, keyed by `spellingSlot` (selection runs often; this keeps it cheap). */
const spellingCache = new WeakMap<Instrument, WeakMap<ManifestEntry, Map<number, boolean>>>();

/** A number unique per (written key, shift, doubles allowed) for one entry and instrument. */
function spellingSlot(key: KeySig, t: number, doubles: boolean): number {
  return ((((key.fifths + 16) * 2 + (key.mode === 'minor' ? 1 : 0)) * 1024 + (t + 512)) * 2) + (doubles ? 1 : 0);
}

/** 03 §7.5 rule 3 for one written key, from the manifest's spelling column. */
function spellingOk(entry: ManifestEntry, key: KeySig, t: number, req: Request): boolean {
  const doubles = req.def.doubleAccidentals;
  let byEntry = spellingCache.get(req.inst);
  if (!byEntry) spellingCache.set(req.inst, (byEntry = new WeakMap()));
  let m = byEntry.get(entry);
  if (!m) byEntry.set(entry, (m = new Map()));
  const slot = spellingSlot(key, t, doubles);
  let ok = m.get(slot);
  if (ok === undefined) {
    const plan = planTransposition({ fifths: entry.fifths, mode: entry.mode }, key, t, req.inst);
    ok = judgeSpelling(entry.spelling, plan.writtenInterval, doubles).verdict === 'ok';
    m.set(slot, ok);
  }
  return ok;
}

/**
 * The written key to serve for a fitting key: itself when its spelling passes; for a random key, its enharmonic when
 * that passes instead (03 §7.5 rule 3, retried once); otherwise null. A chosen key is never changed (R1).
 */
function spelledKey(entry: ManifestEntry, key: KeySig, t: number, req: Request): { key: KeySig; enharmonicRetry: boolean } | null {
  if (spellingOk(entry, key, t, req)) return { key, enharmonicRetry: false };
  if (req.writtenKey !== null) return null;
  const enh = enharmonicKey(key);
  if (isValidKey(enh) && keyAllowed(req.def, enh) && spellingOk(entry, enh, t, req)) return { key: enh, enharmonicRetry: true };
  return null;
}

function buildCandidate(entry: ManifestEntry, pool: PoolId, req: Request, h: SelectionHistory, cfg: Configs, blocked: KeySig | null): Candidate | null {
  if (req.meter !== null && entry.meter !== req.meter) return null;
  if (req.meter === null && req.anyMeters !== null && !req.anyMeters.has(entry.meter)) return null;
  if (!req.def.bars.includes(entry.bars)) return null;
  if (req.ranked && (entry.familiarity >= 2 || entry.dedupeGroup in h.seenGroups)) return null;
  if (!flagAllowed(entry, req)) return null;
  // R8: modal only under a random key; 03 §7.5 rule 4: major to major and minor to minor.
  if (entry.modal !== null && req.writtenKey !== null) return null;
  if (!req.def.writtenKeys.modes.includes(entry.mode)) return null;

  const band = bandFor(req.inst, req.def);
  if (!windowFits(shiftWindow(entry.rangeConcert, req.inst, band))) return null;

  const facts = tempoFacts(entry);
  const tempo = clippedTempo(facts, req.inst, req.def, cfg);
  if (!tempo) return null;
  if (req.bpm !== null && !bpmPlayable(req.bpm, facts, req.inst, req.def, cfg)) return null;

  const source: KeySig = { fifths: entry.fifths, mode: entry.mode };
  const keys: KeyOption[] = [];
  const tryKeys = req.writtenKey !== null ? [req.writtenKey] : allowedWrittenKeys(req.def, entry.mode).filter((k) => !blocked || !sameKey(k, blocked));
  for (const key of tryKeys) {
    const shift = fitsInKey(source, entry.rangeConcert, key, req.inst, band);
    if (!shift) continue;
    const spelled = spelledKey(entry, key, shift.t, req);
    if (!spelled) continue;
    keys.push({ key: spelled.key, shift, weight: req.writtenKey !== null ? 1 : keyWeight(key, req, cfg), enharmonicRetry: spelled.enharmonicRetry });
  }
  if (keys.length === 0) return null;

  let weight = (1 + Math.min(MARGIN_SATURATION, Math.max(...keys.map((k) => k.shift.margin)))) / (1 + MARGIN_SATURATION);
  if (req.bars !== null && entry.bars === req.bars) weight *= W_BARS_PREFERRED;
  const workIdx = h.recentWorks.indexOf(entry.work);
  if (workIdx >= 0 && workIdx < RECENT_WORKS_N) weight *= W_RECENT_WORK;
  const idIdx = h.recentExcerptIds.indexOf(entry.id);
  if (idIdx >= 0 && idIdx < RECENT_IDS_N) weight *= W_RECENT_ID;
  if (!req.ranked && entry.dedupeGroup in h.seenGroups) weight *= W_SEEN_PRACTICE;
  return { entry, pool, keys, tempo, weight };
}

interface Pool {
  byPool: Record<PoolId, Candidate[]>;
  /** Unseen eligible excerpts at L (02 §2.6 rule 3). */
  unseenAtLevel: number;
}

function buildPool(m: CorpusManifest, req: Request, h: SelectionHistory, cfg: Configs, opts: SelectOptions): Pool {
  const withdrawn = new Set(m.withdrawn);
  const blocked = req.writtenKey === null ? blockedKey(h, cfg) : null;
  const byPool: Record<PoolId, Candidate[]> = { level: [], below: [], stretch: [] };
  let unseenAtLevel = 0;
  if (req.writtenKey !== null && !keyAllowed(req.def, req.writtenKey)) return { byPool, unseenAtLevel };
  for (const entry of m.entries) {
    if (withdrawn.has(entry.id) || opts.excludeIds?.has(entry.id)) continue;
    const pool = poolOf(entry, req.level);
    if (!pool) continue;
    const c = buildCandidate(entry, pool, req, h, cfg, blocked);
    if (!c) continue;
    byPool[pool].push(c);
    if (pool === 'level' && !(entry.dedupeGroup in h.seenGroups)) unseenAtLevel++;
  }
  return { byPool, unseenAtLevel };
}

/**
 * Pool shares (02 §2.6 rules 2 and 3): L − 1 takes `maxFracFromLevelBelow`, stretch takes `stretchRate` (or
 * `stretchRateLowPool` when fewer than `lowPoolUnseen` unseen excerpts remain at L), level L the rest. An empty
 * pool's share goes to level L, or to stretch when L is empty; L − 1 never takes more than its share unless it is
 * the only pool left with anything in it, which `selectExcerpt` refuses (empty pool) to keep the 20% cap.
 */
export function poolShares(sizes: Record<PoolId, number>, unseenAtLevel: number, cfg: Configs): Record<PoolId, number> {
  const sel = cfg.levels.selection;
  const below = sizes.below > 0 ? sel.maxFracFromLevelBelow : 0;
  const stretchRate = unseenAtLevel < sel.lowPoolUnseen ? sel.stretchRateLowPool : sel.stretchRate;
  if (sizes.level === 0 && sizes.stretch === 0) return { level: 0, below: 0, stretch: 0 };
  if (sizes.level === 0) return { level: 0, below, stretch: 1 - below };
  if (sizes.stretch === 0) return { level: 1 - below, below, stretch: 0 };
  const stretch = Math.min(stretchRate, 1 - below);
  return { level: 1 - below - stretch, below, stretch };
}

function weightedIndex<T>(items: readonly T[], weight: (t: T) => number, rng: Rng): number {
  let total = 0;
  for (const it of items) total += weight(it);
  if (!(total > 0)) return rng.int(0, items.length);
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weight(items[i]!);
    if (r < 0) return i;
  }
  return items.length - 1;
}

const POOLS: readonly PoolId[] = ['level', 'below', 'stretch'];

function resolveLevel(s: PracticeSettings, h: SelectionHistory, m: CorpusManifest, rng: Rng): number {
  if (s.level !== 'random') return s.level;
  const top = Math.min(MAX_LEVEL, Math.max(1, h.playerLevel));
  const range: number[] = [];
  for (let l = Math.max(1, top - RANDOM_LEVEL_SPAN); l <= top; l++) range.push(l);
  const served = range.filter((l) => m.stats.servedLevels.includes(l));
  const from = served.length > 0 ? served : range;
  return from[rng.int(0, from.length)]!;
}

function nearestBars(n: number): 8 | 10 | 12 {
  return n <= 9 ? 8 : n <= 11 ? 10 : 12;
}

function makeRequest(s: PracticeSettings, level: number, cfg: Configs, anyMeters: ReadonlySet<string> | null = null): Request {
  return {
    inst: getInstrument(cfg, s.instrumentId),
    level,
    def: levelDef(cfg, level),
    meter: s.meter === 'random' ? null : s.meter,
    anyMeters: s.meter === 'random' ? anyMeters : null,
    writtenKey: s.writtenKey === 'random' ? null : s.writtenKey,
    bpm: s.bpm === 'random' ? null : s.bpm,
    bars: s.bars === 'random' ? null : s.bars,
    ranked: s.mode === 'ranked',
  };
}

function poolSize(p: Pool): number {
  return p.byPool.level.length + p.byPool.stretch.length;
}

/** Settings changes that would give a non-empty pool, most specific first (04 §11 empty state). */
function suggestionsFor(m: CorpusManifest, s: PracticeSettings, h: SelectionHistory, cfg: Configs, level: number, opts: SelectOptions): Partial<PracticeSettings>[] {
  const tries: Partial<PracticeSettings>[] = [];
  if (s.meter !== 'random') tries.push({ meter: 'random' });
  if (s.writtenKey !== 'random') tries.push({ writtenKey: 'random' });
  if (s.bpm !== 'random') tries.push({ bpm: 'random' });
  if (s.mode === 'ranked') tries.push({ mode: 'practice' });
  if (level > 1) tries.push({ level: level - 1 });
  const all: Partial<PracticeSettings> = { meter: 'random', writtenKey: 'random', bpm: 'random', mode: 'practice' };
  tries.push(all);
  const out: Partial<PracticeSettings>[] = [];
  for (const t of tries) {
    const s2: PracticeSettings = { ...s, ...t };
    const lvl = typeof t.level === 'number' ? t.level : level;
    const p = buildPool(m, makeRequest(s2, lvl, cfg, shownMetersFor(m, s2.instrumentId, lvl, cfg, opts)), h, cfg, {
      ...opts,
      noSuggestions: true,
    });
    if (poolSize(p) > 0) {
      if (t === all && out.length > 0) continue;
      out.push(t);
    }
  }
  return out;
}

/** `selectExcerpt` with options; see the module comment. */
export function selectExcerptWith(
  m: CorpusManifest,
  s: PracticeSettings,
  h: SelectionHistory,
  cfg: Configs,
  rng: Rng,
  opts: SelectOptions = {},
): SelectExcerptResult {
  const seed = s.seed ?? rng.int(0, 0x7fffffff);
  const r = createRng(seed);
  const level = resolveLevel(s, h, m, r);
  const req = makeRequest(s, level, cfg, shownMetersFor(m, s.instrumentId, level, cfg, opts));
  const pool = buildPool(m, req, h, cfg, opts);
  const empty = (): SelectExcerptResult => ({
    error: 'empty-pool',
    suggestions: opts.noSuggestions ? [] : suggestionsFor(m, s, h, cfg, level, opts),
  });
  if (poolSize(pool) === 0) return empty();
  const shares = poolShares(
    { level: pool.byPool.level.length, below: pool.byPool.below.length, stretch: pool.byPool.stretch.length },
    pool.unseenAtLevel,
    cfg,
  );
  const live = POOLS.filter((p) => pool.byPool[p].length > 0 && shares[p] > 0);
  const poolId = live[weightedIndex(live, (p) => shares[p], r)]!;
  const cands = pool.byPool[poolId];
  const cand = cands[weightedIndex(cands, (c) => c.weight, r)]!;
  const opt = cand.keys[weightedIndex(cand.keys, (k) => k.weight, r)]!;
  return buildResult(cand, opt.key, opt.shift, opt.enharmonicRetry, req, s, seed, r);
}

function buildResult(
  cand: Candidate,
  writtenKey: KeySig,
  shift: ShiftChoice,
  enharmonicRetry: boolean,
  req: Request,
  s: PracticeSettings,
  seed: number,
  r: Rng,
): SelectionResult {
  const entry = cand.entry;
  const plan = planTransposition({ fifths: entry.fifths, mode: entry.mode }, writtenKey, shift.t, req.inst);
  const cI = req.inst.writtenMinusSounding.chromatic;
  const writtenRange: [number, number] = [entry.rangeConcert[0] + shift.t + cI, entry.rangeConcert[1] + shift.t + cI];
  let bpm: number;
  if (req.bpm !== null) bpm = req.bpm;
  else {
    const lo = Math.ceil(cand.tempo.minBpm);
    const hi = Math.floor(cand.tempo.maxBpm);
    bpm = hi >= lo ? r.int(lo, hi + 1) : cand.tempo.minBpm;
  }
  const randomized: ResolvedSettings['randomized'] = [];
  if (s.level === 'random') randomized.push('level');
  if (s.writtenKey === 'random') randomized.push('key');
  if (s.meter === 'random') randomized.push('meter');
  if (s.bpm === 'random') randomized.push('tempo');
  if (s.bars === 'random') randomized.push('bars');
  const settings: ResolvedSettings = {
    instrumentId: req.inst.id,
    level: req.level,
    writtenKey,
    meter: entry.meter,
    bpm,
    bars: req.bars ?? nearestBars(entry.bars),
    randomized,
    seed,
  };
  return {
    entry,
    settings,
    levelServed: req.level,
    stretch: cand.pool === 'stretch',
    fromLevelBelow: cand.pool === 'below',
    transposition: plan.concertInterval,
    writtenKey,
    concertKey: plan.concertKey,
    clef: chooseClef(req.inst, req.level, writtenRange),
    bpmRange: { ...cand.tempo },
    octaveDisplaced: Math.abs(shift.t) >= 12,
    enharmonicRetry,
  };
}

export const selectExcerpt: CorpusApi['selectExcerpt'] = (m, s, h, cfg, rng) => selectExcerptWith(m, s, h, cfg, rng);

/**
 * The meters shown on the setup screen (redesign 05 section 5.5): those in the level's list with at least `min`
 * eligible excerpts, in `levels.json` order. When none reaches `min`, every meter with any eligible music is shown
 * (each marked "few pieces"), so a difficulty with music always has a meter to draw from. The setup model in
 * `src/app/screens/setup/model.ts` applies the same rule to the same counts.
 */
export function shownMeters(counts: readonly { meter: string; count: number }[], min: number): string[] {
  const enough = counts.filter((c) => c.count >= min);
  return (enough.length > 0 ? enough : counts.filter((c) => c.count > 0)).map((c) => c.meter);
}

/** `countEligible` per meter is a full manifest scan; cache the shown set per manifest, configs and request. */
const shownCache = new WeakMap<CorpusManifest, WeakMap<Configs, Map<string, ReadonlySet<string>>>>();

/**
 * Shown meters for an instrument and level, from the same history-free counts the setup screen uses (`countEligible`),
 * so "Any" never draws a meter the screen left out. `excludeIds` only narrows the draw afterwards.
 */
function shownMetersFor(m: CorpusManifest, instrumentId: string, level: number, cfg: Configs, opts: SelectOptions): ReadonlySet<string> {
  const min = opts.meterMinExcerpts ?? METER_MIN_EXCERPTS;
  const slot = `${instrumentId}|${level}|${min}`;
  let byCfg = shownCache.get(m);
  if (!byCfg) shownCache.set(m, (byCfg = new WeakMap()));
  let byKey = byCfg.get(cfg);
  if (!byKey) byCfg.set(cfg, (byKey = new Map()));
  const hit = byKey.get(slot);
  if (hit) return hit;
  const counts = levelDef(cfg, level).meters.map((meter) => ({ meter, count: countEligible(m, instrumentId, level, meter, cfg) }));
  const out: ReadonlySet<string> = new Set(shownMeters(counts, min));
  byKey.set(slot, out);
  return out;
}

/**
 * Eligible excerpts for 04's setup screen (04 §5.2): practice-mode pool size (level, L − 1 and stretch) at the level
 * for the instrument, any allowed written key, any tempo in range, optionally one meter. History-free.
 */
export const countEligible: CorpusApi['countEligible'] = (m, instrumentId, level, meter, cfg) => {
  const s: PracticeSettings = {
    instrumentId,
    level,
    writtenKey: 'random',
    meter: meter ?? 'random',
    bpm: 'random',
    bars: 'random',
    mode: 'practice',
    listening: true,
    metronome: 'audible',
    clickTimbre: 'tick',
    outputMode: 'speakers',
    a4Hz: 440,
  };
  const h: SelectionHistory = { seenGroups: {}, recentExcerptIds: [], recentWorks: [], recentWrittenKeys: [], playerLevel: level };
  const p = buildPool(m, makeRequest(s, level, cfg), h, cfg, {});
  // L − 1 alone is never served (its share is capped), so it only counts next to level L or stretch excerpts.
  return poolSize(p) === 0 ? 0 : p.byPool.level.length + p.byPool.below.length + p.byPool.stretch.length;
};

/**
 * Unseen excerpts a ranked request at `level` could serve for the instrument (level L and stretch), any key, meter and
 * tempo (round 3, R77). Zero means the player has read every piece at their difficulty: Home and results then offer
 * the next difficulty. `seenGroups` is the profile's (dedupe group → first reveal).
 */
export function countUnseenRanked(m: CorpusManifest, instrumentId: string, level: number, seenGroups: Readonly<Record<string, string>>, cfg: Configs): number {
  const s: PracticeSettings = {
    instrumentId,
    level,
    writtenKey: 'random',
    meter: 'random',
    bpm: 'random',
    bars: 'random',
    mode: 'ranked',
    listening: true,
    metronome: 'audible',
    clickTimbre: 'tick',
    outputMode: 'speakers',
    a4Hz: 440,
  };
  const h: SelectionHistory = { seenGroups: { ...seenGroups }, recentExcerptIds: [], recentWorks: [], recentWrittenKeys: [], playerLevel: level };
  return poolSize(buildPool(m, makeRequest(s, level, cfg, shownMetersFor(m, instrumentId, level, cfg, {})), h, cfg, {}));
}
