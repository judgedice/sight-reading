/**
 * Pure view models for the progress screen (04 section 5.7). No React. Thresholds and sizes come from config
 * (progression.json, levels), never from literals here.
 */
import type { Configs, InstrumentProgress, PlayerProfile } from '../../../core/types.ts';
import { patternDef } from '../results/model.ts';

export type LadderState = 'achieved' | 'current' | 'future';

export interface LadderItem {
  rank: number;
  name: string;
  xp: number;
  minLevel: number;
  state: LadderState;
}

/** The ten rank emblems (04 5.7 item 2). A rank the player has reached is achieved; the current one is ringed. */
export function ladder(cfg: Configs, profile: Pick<PlayerProfile, 'rank'>): LadderItem[] {
  return cfg.progression.ranks.table.map((r) => ({
    rank: r.rank,
    name: r.name,
    xp: r.xp,
    minLevel: r.minLevel,
    state: r.rank === profile.rank ? 'current' : r.rank < profile.rank ? 'achieved' : 'future',
  }));
}

/** One square of the level window: a ranked take at this level, or an empty slot. */
export interface WindowSquare {
  score: number;
  /** Score at or above the level's offer score: a check glyph. */
  passed: boolean;
  /** Played at or above the level's mid tempo: a small tempo mark. */
  midTempo: boolean;
}

/** `size` squares, oldest first; empty slots are null. Scores of the last `size` ranked takes at this level. */
export function windowSquares(progress: Pick<InstrumentProgress, 'window'>, cfg: Configs): (WindowSquare | null)[] {
  const size = cfg.progression.levelWindow.size;
  const passScore = cfg.progression.levelWindow.offer.score;
  const recent = progress.window.slice(-size);
  const squares: (WindowSquare | null)[] = Array.from({ length: size }, () => null);
  const offset = size - recent.length;
  recent.forEach((e, i) => {
    squares[offset + i] = { score: e.score, passed: e.score >= passScore, midTempo: e.atMidTempo };
  });
  return squares;
}

export interface BestByLevel {
  level: number;
  score: number;
}

/** Best score per level, highest level first. */
export function bestByLevel(progress: Pick<InstrumentProgress, 'bestByLevel'>): BestByLevel[] {
  return Object.entries(progress.bestByLevel)
    .map(([level, score]) => ({ level: Number(level), score }))
    .filter((b) => Number.isFinite(b.level) && Number.isFinite(b.score))
    .sort((a, b) => b.level - a.level);
}

export interface InstrumentCard {
  id: string;
  label: string;
  level: number;
  attemptsRanked: number;
  squares: (WindowSquare | null)[];
  best: BestByLevel[];
}

/** One card per played instrument; the active instrument first, then by label. */
export function instrumentCards(cfg: Configs, profile: PlayerProfile): InstrumentCard[] {
  const cards = Object.entries(profile.instruments).map(([id, p]) => ({
    id,
    label: cfg.instrumentById[id]?.label ?? id,
    level: p.level,
    attemptsRanked: p.attemptsRanked,
    squares: windowSquares(p, cfg),
    best: bestByLevel(p),
  }));
  return cards.sort((a, b) => {
    if (a.id === profile.activeInstrumentId) return -1;
    if (b.id === profile.activeInstrumentId) return 1;
    return a.label.localeCompare(b.label);
  });
}

export interface Slip {
  id: string;
  name: string;
  count: number;
}

/** Up to `limit` patterns the player has fired on this instrument, most frequent first (04 5.7 item 5). */
export function topSlips(cfg: Configs, progress: Pick<InstrumentProgress, 'patternCounts'> | undefined, limit = 5): Slip[] {
  if (!progress) return [];
  return Object.entries(progress.patternCounts)
    .filter(([, n]) => n > 0)
    .map(([id, count]) => ({ id, count, name: patternDef(cfg, id)?.name ?? id }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** Slips need a few takes before they mean anything (04 9.1: fewer than 3 attempts is the empty state). */
export const SLIPS_MIN_ATTEMPTS = 3;

/** Instrument whose slips the card shows: the active one when played, else the first played. */
export function slipsInstrument(profile: PlayerProfile): string | null {
  if (profile.instruments[profile.activeInstrumentId]) return profile.activeInstrumentId;
  return Object.keys(profile.instruments)[0] ?? null;
}
