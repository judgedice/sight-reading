/**
 * Pure setup logic (04 section 5.2): which options a level offers, which are disabled for lack of music, what Random
 * means, and how a changed level re-filters the other rows without dropping a still-valid choice.
 * No React, no storage. The eligible-count function is injected (the app layer may not import corpus/).
 */
import { makeMeter } from '../../../core/time.ts';
import type { Configs, Instrument, KeySig, LevelDef, PracticeSettings } from '../../../core/types.ts';
import { tokens } from '../../../ui/tokens.ts';
import { keyValue } from './key-names.ts';

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

export function meterChoices(ctx: SetupContext, instrumentId: string, level: number): MeterChoice[] {
  return levelDef(ctx.cfg, level).meters.map((meter) => {
    const count = ctx.eligible(instrumentId, level, meter);
    return { meter, count, disabled: count < MIN_METER_EXCERPTS };
  });
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
