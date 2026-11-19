/**
 * Pure setup logic (04 section 5.2, redesign 05 section 5): which options a difficulty offers, which are left out for
 * lack of music, what "Any" means, and how a changed difficulty or instrument re-filters the other rows without
 * dropping a still-valid choice. No React, no storage. The eligible-count function is injected (the app layer may not
 * import corpus/). Player-facing text is returned as copy keys with their variables (`SetupText`).
 */
import { makeMeter } from '../../../core/time.ts';
import type { Configs, Instrument, KeySig, LevelDef, PracticeSettings } from '../../../core/types.ts';
import { rangeModel, type RangeText } from '../../../instruments/range.ts';
import { copy, isCopyKey, type CopyKey, type CopyVars } from '../../../ui/copy/copy.ts';
import { instrumentName } from '../../../ui/copy/instrument-names.ts';
import { tokens } from '../../../ui/tokens.ts';
import { concertKey, keyName, keyValue, tonicName } from './key-names.ts';

export type EligibleFn = (instrumentId: string, level: number, meter: string | null) => number;

export const LEVELS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const LENGTHS: readonly (8 | 10 | 12)[] = [8, 10, 12];

/** Thresholds from design/tokens.json "ui" (04 section 5.2). */
export const THIN_LEVEL = tokens.ui.levelThinThreshold;
export const MIN_METER_EXCERPTS = tokens.ui.meterChipMinExcerpts;

export interface SetupContext {
  cfg: Configs;
  eligible: EligibleFn;
  showBeta: boolean;
  /** The player's current level on the chosen instrument (what Random level and a fresh Level row start from). */
  playerLevel: (instrumentId: string) => number;
}

export function listedInstruments(cfg: Configs, showBeta: boolean): Instrument[] {
  return cfg.instruments.instruments.filter((i) => i.status === 'launch' || showBeta);
}

/** The level whose rows apply: the chosen level, or the player's own when Random (PLAN ruling 22). */
export function effectiveLevel(p: PracticeSettings, ctx: SetupContext): number {
  const l = p.level === 'random' ? ctx.playerLevel(p.instrumentId) : p.level;
  return Math.min(10, Math.max(1, Math.round(l)));
}

export function levelDef(cfg: Configs, level: number): LevelDef {
  const d = cfg.levelByNumber[level];
  if (!d) throw new RangeError(`no level ${level}`);
  return d;
}

export type LevelStock = 'none' | 'thin' | 'ok';

export function levelCounts(ctx: SetupContext, instrumentId: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (const l of LEVELS) out[l] = ctx.eligible(instrumentId, l, null);
  return out;
}

export const stockOf = (count: number): LevelStock => (count === 0 ? 'none' : count < THIN_LEVEL ? 'thin' : 'ok');

/** Written keys allowed at the level, C-centred, majors then minors (02 section 2.3). */
export function allowedKeys(def: LevelDef): KeySig[] {
  const out: KeySig[] = [];
  const max = def.writtenKeys.maxAccidentals;
  for (const mode of ['major', 'minor'] as const) {
    if (!def.writtenKeys.modes.includes(mode)) continue;
    for (let f = -max; f <= max; f++) out.push({ fifths: f, mode });
  }
  return out;
}

/** The first level above `level` that allows more keys, for the "More keys from level n" footnote. */
export function moreKeysFromLevel(cfg: Configs, level: number): number | null {
  const cur = levelDef(cfg, level).writtenKeys;
  for (let l = level + 1; l <= 10; l++) {
    const k = levelDef(cfg, l).writtenKeys;
    if (k.maxAccidentals > cur.maxAccidentals || k.modes.length > cur.modes.length) return l;
  }
  return null;
}

export interface MeterChoice {
  meter: string;
  count: number;
  disabled: boolean;
}

/**
 * The meters the Time row shows (05 section 5.5): at least `MIN_METER_EXCERPTS` eligible excerpts; when none reaches
 * it, every meter with any music (so a difficulty with music always has a meter). The selector in
 * `src/corpus/select/select.ts` (`shownMeters`) applies the same rule, so "Any" only draws meters shown here.
 */
export function shownMeterSet(counts: readonly { meter: string; count: number }[]): Set<string> {
  const enough = counts.filter((c) => c.count >= MIN_METER_EXCERPTS);
  return new Set((enough.length > 0 ? enough : counts.filter((c) => c.count > 0)).map((c) => c.meter));
}

/** Every meter of the level with its count; `disabled` marks the ones the Time row leaves out. */
export function meterChoices(ctx: SetupContext, instrumentId: string, level: number): MeterChoice[] {
  const counts = levelDef(ctx.cfg, level).meters.map((meter) => ({ meter, count: ctx.eligible(instrumentId, level, meter) }));
  const shown = shownMeterSet(counts);
  return counts.map(({ meter, count }) => ({ meter, count, disabled: !shown.has(meter) }));
}

export const isCompoundMeter = (meter: string): boolean => {
  const [b, t] = meter.split('/').map(Number);
  return !!b && (t === 2 || t === 4 || t === 8 || t === 16) && makeMeter(b, t).countsPerBar !== b;
};

/** The level's tempo range; compound meters on the dotted-beat levels use the dotted range (02 section 2.4). */
export function tempoRange(cfg: Configs, def: LevelDef, meter: string | 'random'): { min: number; max: number } {
  const [from, to] = cfg.levels.compound.dottedBeatLevels;
  if (meter !== 'random' && isCompoundMeter(meter) && def.level >= from && def.level <= to) {
    const r = cfg.levels.compound.dottedBpm;
    return { min: r.minBpm, max: r.maxBpm };
  }
  return { min: def.tempo.minBpm, max: def.tempo.maxBpm };
}

export const midTempo = (r: { min: number; max: number }): number => Math.round((r.min + r.max) / 2);

/** The beat unit shown beside the tempo: dotted quarter for compound meters, else the meter's beat. */
export function beatUnit(meter: string | 'random'): string {
  if (meter === 'random') return '♩';
  if (isCompoundMeter(meter)) return '♩.';
  const t = Number(meter.split('/')[1]);
  return t === 2 ? '𝅗𝅥' : t === 8 || t === 16 ? '♪' : '♩';
}

export function lengthChoices(def: LevelDef): (8 | 10 | 12)[] {
  return LENGTHS.filter((n) => def.bars.includes(n));
}

/** m_random: random key, meter and tempo count; level and length do not (02 section 5.4). */
export function randomCount(p: PracticeSettings): number {
  return (p.writtenKey === 'random' ? 1 : 0) + (p.meter === 'random' ? 1 : 0) + (p.bpm === 'random' ? 1 : 0);
}

/** XP bonus percent for the random rows, or 0. */
export function randomBonusPercent(cfg: Configs, p: PracticeSettings): number {
  const n = randomCount(p);
  if (n === 0) return 0;
  const x = cfg.progression.xp;
  return Math.round((Math.min(x.randomCap, 1 + x.randomPerSetting * n) - 1) * 100);
}

/**
 * Re-filters every row for the chosen instrument and level. A choice that is still valid is kept; one that is not
 * falls back to Random (key, time, length), the nearest level with music, or the nearest tempo in range.
 */
export function normalize(p: PracticeSettings, ctx: SetupContext): PracticeSettings {
  const listed = listedInstruments(ctx.cfg, ctx.showBeta);
  const next: PracticeSettings = { ...p };
  if (!listed.some((i) => i.id === next.instrumentId)) {
    next.instrumentId = listed[0]?.id ?? next.instrumentId;
  }
  if (next.level !== 'random') {
    const counts = levelCounts(ctx, next.instrumentId);
    let l = Math.min(10, Math.max(1, Math.round(next.level)));
    if (counts[l] === 0) {
      const open = LEVELS.filter((x) => counts[x]! > 0).sort((a, b) => Math.abs(a - l) - Math.abs(b - l) || a - b);
      if (open[0] !== undefined) l = open[0];
    }
    next.level = l;
  }
  const level = effectiveLevel(next, ctx);
  const def = levelDef(ctx.cfg, level);
  if (next.writtenKey !== 'random' && !allowedKeys(def).some((k) => keyValue(k) === keyValue(next.writtenKey as KeySig))) {
    next.writtenKey = 'random';
  }
  if (next.meter !== 'random') {
    const choice = meterChoices(ctx, next.instrumentId, level).find((m) => m.meter === next.meter);
    if (!choice || choice.disabled) next.meter = 'random';
  }
  if (next.bpm !== 'random') {
    const r = tempoRange(ctx.cfg, def, next.meter);
    next.bpm = Math.min(r.max, Math.max(r.min, Math.round(next.bpm)));
  }
  if (next.bars !== 'random' && !lengthChoices(def).includes(next.bars)) next.bars = 'random';
  return next;
}

/** One suggestion for an empty pool, built from counts alone (the session adds seen-ness). */
export function localSuggestions(p: PracticeSettings, ctx: SetupContext): Partial<PracticeSettings>[] {
  const level = effectiveLevel(p, ctx);
  if (ctx.eligible(p.instrumentId, level, p.meter === 'random' ? null : p.meter) > 0) return [];
  const out: Partial<PracticeSettings>[] = [];
  if (p.meter !== 'random' && ctx.eligible(p.instrumentId, level, null) > 0) out.push({ meter: 'random' });
  const near = LEVELS.filter((l) => l !== level && ctx.eligible(p.instrumentId, l, null) > 0).sort(
    (a, b) => Math.abs(a - level) - Math.abs(b - level) || a - b,
  );
  if (near[0] !== undefined && p.level !== 'random') out.push({ level: near[0] });
  return out;
}

// =====================================================================================
// Redesign 05 section 5: the setup model the new controls read
// =====================================================================================

/** A line of player-facing text: a copy key and its variables. Format with `setupText`. */
export interface SetupText {
  key: CopyKey;
  vars: CopyVars;
}

const text = (key: CopyKey, vars: CopyVars = {}): SetupText => ({ key, vars });

/** Formats a `SetupText` (or a range line from `src/instruments/range.ts`) with the copy catalogue. */
export function setupText(t: SetupText | RangeText, extra: CopyVars = {}): string {
  if (!isCopyKey(t.key)) throw new RangeError(`unknown copy key ${t.key}`);
  const vars: Record<string, string | number> = { ...t.vars, ...extra };
  const keyVars = 'keyVars' in t ? t.keyVars : undefined;
  for (const [name, key] of Object.entries(keyVars ?? {})) {
    if (!isCopyKey(key)) throw new RangeError(`unknown copy key ${key}`);
    vars[name] = copy(key);
  }
  return copy(t.key, vars);
}

/** "7 to 8", "1, 7 to 8": runs of difficulties, for "No music yet for {instrument} at difficulty {levels}." */
export function formatLevelList(levels: readonly number[]): string {
  const sorted = [...levels].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const l of sorted) {
    const last = runs[runs.length - 1];
    if (last && l === last[1] + 1) last[1] = l;
    else runs.push([l, l]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : copy('range.cardText', { low: a, high: b }))).join(', ');
}

/** "3/4 or 2/4". Uses `setup.time.listOr` ("{list} or {last}") when the catalogue has it, else a comma list. */
export function formatMeterList(meters: readonly string[]): string {
  if (meters.length <= 1) return meters.join('');
  const listKey = 'setup.time.listOr';
  if (isCopyKey(listKey)) return copy(listKey, { list: meters.slice(0, -1).join(', '), last: meters[meters.length - 1]! });
  return meters.join(', ');
}

/** Percent of the XP bonus one "Any" row adds, for the "+8% XP" tags. */
export const anyXpPercent = (cfg: Configs): number => Math.round(cfg.progression.xp.randomPerSetting * 100);

/** The nearest difficulty with music in a direction, or null (stepping skips difficulties without music, 5.3). */
export function stepLevel(counts: Readonly<Record<number, number>>, level: number, dir: 1 | -1): number | null {
  for (let l = level + dir; l >= 1 && l <= 10; l += dir) if ((counts[l] ?? 0) > 0) return l;
  return null;
}

export interface DifficultySegment {
  level: number;
  filled: boolean;
  hasMusic: boolean;
}

export interface DifficultyRow {
  value: number;
  max: number;
  /** "Follow my progress" is on (`level === 'random'`): the stepper is hidden. */
  follow: boolean;
  /** Difficulties with music for this instrument; the stepper steps through these only. */
  withMusic: number[];
  skipped: number[];
  counts: Record<number, number>;
  segments: DifficultySegment[];
  prev: number | null;
  next: number | null;
  /** "No music yet for Baritone voice at difficulty 7 to 8." */
  skippedNote: SetupText | null;
  /** Fewer than `levelThinThreshold` excerpts at this difficulty. */
  few: boolean;
  fewNote: SetupText | null;
  /** The level description from levels.json. */
  description: string;
  /** "At difficulty 2: C3 to C4". */
  servedLine: RangeText;
  /** With follow on: "Difficulty 2 of 10 (follows your progress)" and its hint. */
  followValue: SetupText | null;
  followHint: SetupText | null;
}

export interface KeyOption {
  key: KeySig;
  value: string;
  /** "G major". */
  name: string;
  /** "G", "B♭". */
  tonic: string;
  accidentals: number;
  side: 'none' | 'sharp' | 'flat';
  /** Transposing instruments: "concert F major" as text. */
  concert: SetupText | null;
  selected: boolean;
}

export interface KeyGroup {
  mode: 'major' | 'minor';
  label: SetupText;
  keys: KeyOption[];
}

export interface KeyRow {
  any: { selected: boolean; label: SetupText; hint: SetupText; xpTag: SetupText };
  /** Major, then Minor (when the difficulty allows it). */
  groups: KeyGroup[];
  /** The next difficulty that adds keys, or null. */
  moreFrom: number | null;
  moreNote: SetupText | null;
}

export interface TimeOption {
  meter: string;
  beats: number;
  unit: number;
  count: number;
  /** Fewer than `levelThinThreshold` excerpts: shows "few pieces". */
  few: boolean;
  selected: boolean;
  a11y: SetupText;
}

export interface TimeRow {
  any: { selected: boolean; label: SetupText; xpTag: SetupText };
  options: TimeOption[];
  /** Meters the difficulty allows but the row leaves out, in levels.json order. */
  hidden: string[];
  hiddenNote: SetupText | null;
  /** The selected meter has few pieces: "Few pieces here: some may repeat." */
  fewNote: SetupText | null;
}

export interface TempoRow {
  any: boolean;
  range: { min: number; max: number };
  beatUnit: string;
  anyLabel: SetupText;
  anyValue: SetupText;
  xpTag: SetupText;
}

export type LengthRow =
  | { kind: 'only'; bars: 8 | 10 | 12; note: SetupText }
  | { kind: 'choice'; any: { selected: boolean; label: SetupText }; options: { bars: 8 | 10 | 12; selected: boolean }[] };

export interface SetupModel {
  instrument: Instrument;
  instrumentName: string;
  level: number;
  difficulty: DifficultyRow;
  key: KeyRow;
  time: TimeRow;
  tempo: TempoRow;
  length: LengthRow;
  /** "Choosing Any: +24% XP", or null when the sum is 0. */
  xp: { percent: number; line: SetupText | null };
}

/** Key options of one mode, by number of accidentals, sharp side before flat side: C, G, F, D, B♭, A, E♭… */
export function orderedKeys(def: LevelDef, mode: 'major' | 'minor'): KeySig[] {
  if (!def.writtenKeys.modes.includes(mode)) return [];
  const out: KeySig[] = [{ fifths: 0, mode }];
  for (let n = 1; n <= def.writtenKeys.maxAccidentals; n++) out.push({ fifths: n, mode }, { fifths: -n, mode });
  return out;
}

function difficultyRow(p: PracticeSettings, ctx: SetupContext, inst: Instrument, name: string, level: number, def: LevelDef): DifficultyRow {
  const counts = levelCounts(ctx, inst.id);
  const withMusic = LEVELS.filter((l) => (counts[l] ?? 0) > 0);
  const skipped = LEVELS.filter((l) => (counts[l] ?? 0) === 0);
  const count = counts[level] ?? 0;
  const few = count > 0 && count < THIN_LEVEL;
  const follow = p.level === 'random';
  return {
    value: level,
    max: 10,
    follow,
    withMusic,
    skipped,
    counts,
    segments: LEVELS.map((l) => ({ level: l, filled: l <= level, hasMusic: (counts[l] ?? 0) > 0 })),
    prev: stepLevel(counts, level, -1),
    next: stepLevel(counts, level, 1),
    skippedNote: skipped.length > 0 ? text('home.levelNoMusic', { instrument: name, levels: formatLevelList(skipped) }) : null,
    few,
    fewNote: few ? text('home.levelFewMusic') : null,
    description: def.description,
    servedLine: rangeModel(ctx.cfg, inst, level).servedLine,
    followValue: follow ? text('setup.difficulty.followValue', { level, max: 10 }) : null,
    followHint: follow ? text('setup.difficulty.followHint') : null,
  };
}

function keyRow(p: PracticeSettings, ctx: SetupContext, inst: Instrument, level: number, def: LevelDef): KeyRow {
  const chosen = p.writtenKey === 'random' ? null : keyValue(p.writtenKey);
  const transposing = inst.writtenMinusSounding.chromatic !== 0;
  const groups: KeyGroup[] = (['major', 'minor'] as const)
    .map((mode) => ({
      mode,
      label: text(mode === 'major' ? 'setup.key.major' : 'setup.key.minor'),
      keys: orderedKeys(def, mode).map(
        (k): KeyOption => ({
          key: k,
          value: keyValue(k),
          name: keyName(k),
          tonic: tonicName(k),
          accidentals: Math.abs(k.fifths),
          side: k.fifths === 0 ? 'none' : k.fifths > 0 ? 'sharp' : 'flat',
          concert: transposing ? text('setup.key.concert', { key: keyName(concertKey(k, inst)) }) : null,
          selected: chosen === keyValue(k),
        }),
      ),
    }))
    .filter((g) => g.keys.length > 0);
  const moreFrom = moreKeysFromLevel(ctx.cfg, level);
  return {
    any: {
      selected: chosen === null,
      label: text('setup.key.any'),
      hint: text('home.keyRandom', { max: def.writtenKeys.maxAccidentals }),
      xpTag: text('setup.xpTag', { percent: anyXpPercent(ctx.cfg) }),
    },
    groups,
    moreFrom,
    moreNote: moreFrom !== null ? text('home.keyFootnote', { n: moreFrom }) : null,
  };
}

function timeRow(p: PracticeSettings, ctx: SetupContext, inst: Instrument, name: string, level: number): TimeRow {
  const choices = meterChoices(ctx, inst.id, level);
  const options = choices
    .filter((c) => !c.disabled)
    .map((c): TimeOption => {
      const [beats, unit] = c.meter.split('/').map(Number) as [number, number];
      return {
        meter: c.meter,
        beats,
        unit,
        count: c.count,
        few: c.count < THIN_LEVEL,
        selected: p.meter === c.meter,
        a11y: text('setup.time.a11y', { beats, unit }),
      };
    });
  const hidden = choices.filter((c) => c.disabled).map((c) => c.meter);
  const sel = options.find((o) => o.selected);
  return {
    any: { selected: p.meter === 'random', label: text('setup.time.any'), xpTag: text('setup.xpTag', { percent: anyXpPercent(ctx.cfg) }) },
    options,
    hidden,
    hiddenNote: hidden.length > 0 ? text('setup.time.unavailable', { meters: formatMeterList(hidden), instrument: name, level }) : null,
    fewNote: sel?.few ? text('home.levelFewMusic') : null,
  };
}

function lengthRow(p: PracticeSettings, level: number, def: LevelDef): LengthRow {
  const lengths = lengthChoices(def);
  if (lengths.length <= 1) {
    const bars = lengths[0] ?? 8;
    return { kind: 'only', bars, note: text('setup.length.only', { bars, level }) };
  }
  return {
    kind: 'choice',
    any: { selected: p.bars === 'random', label: text('setup.length.any') },
    options: lengths.map((bars) => ({ bars, selected: p.bars === bars })),
  };
}

/** Everything the setup controls show for these settings (05 section 5). Pass normalized settings. */
export function setupModel(p: PracticeSettings, ctx: SetupContext): SetupModel {
  const inst = ctx.cfg.instrumentById[p.instrumentId];
  if (!inst) throw new RangeError(`unknown instrument ${p.instrumentId}`);
  const name = instrumentName(inst);
  const level = effectiveLevel(p, ctx);
  const def = levelDef(ctx.cfg, level);
  const range = tempoRange(ctx.cfg, def, p.meter);
  const percent = randomBonusPercent(ctx.cfg, p);
  return {
    instrument: inst,
    instrumentName: name,
    level,
    difficulty: difficultyRow(p, ctx, inst, name, level, def),
    key: keyRow(p, ctx, inst, level, def),
    time: timeRow(p, ctx, inst, name, level),
    tempo: {
      any: p.bpm === 'random',
      range,
      beatUnit: beatUnit(p.meter),
      anyLabel: text('setup.tempo.any'),
      anyValue: text('setup.tempo.anyValue', { min: range.min, max: range.max }),
      xpTag: text('setup.xpTag', { percent: anyXpPercent(ctx.cfg) }),
    },
    length: lengthRow(p, level, def),
    xp: { percent, line: percent > 0 ? text('xp.randomHint', { percent }) : null },
  };
}

export type FallbackRow = 'difficulty' | 'key' | 'time' | 'length';

export interface FallbackNote {
  row: FallbackRow;
  /** Shown under the row for `FALLBACK_NOTE_MS` and announced politely (05 section 5.9). */
  note: SetupText;
}

/** How long a fallback note stays under its row (05 section 5.9). */
export const FALLBACK_NOTE_MS = 6000;

/**
 * The notes 05 section 5.9 asks for, comparing what was asked for (`requested`, before `normalize`) with what
 * `normalize` made of it. A clamped tempo is silent.
 */
export function fallbackNotes(requested: PracticeSettings, next: PracticeSettings, ctx: SetupContext): FallbackNote[] {
  const out: FallbackNote[] = [];
  const inst = ctx.cfg.instrumentById[next.instrumentId];
  const level = effectiveLevel(next, ctx);
  if (requested.level !== 'random' && next.level !== 'random') {
    const asked = Math.min(10, Math.max(1, Math.round(requested.level)));
    if (asked !== next.level && inst) {
      out.push({
        row: 'difficulty',
        note: text('setup.fallback.difficulty', { level: next.level, instrument: instrumentName(inst), from: asked }),
      });
    }
  }
  if (requested.writtenKey !== 'random' && next.writtenKey === 'random') {
    out.push({ row: 'key', note: text('setup.fallback.key', { key: keyName(requested.writtenKey), level }) });
  }
  if (requested.meter !== 'random' && next.meter === 'random') {
    out.push({ row: 'time', note: text('setup.fallback.time', { meter: requested.meter, level }) });
  }
  if (requested.bars !== 'random' && next.bars === 'random') {
    out.push({ row: 'length', note: text('setup.fallback.length', { bars: requested.bars, level }) });
  }
  return out;
}

/** Applies a change through `normalize` and returns the fallback notes it caused. */
export function applySetupChange(
  current: PracticeSettings,
  patch: Partial<PracticeSettings>,
  ctx: SetupContext,
): { next: PracticeSettings; notes: FallbackNote[] } {
  const requested: PracticeSettings = { ...current, ...patch };
  const next = normalize(requested, ctx);
  return { next, notes: fallbackNotes(requested, next, ctx) };
}
