/** Profile creation and manual level changes (02 §5.1, §5.6). */
import type { GradeApi } from '../../core/api.ts';
import type { Configs, InstrumentProgress, PlayerProfile, ProgressEvent } from '../../core/types.ts';

export function newInstrumentProgress(level = 1): InstrumentProgress {
  return {
    level,
    window: [],
    attemptsRanked: 0,
    bestByLevel: {},
    patternCounts: {},
    recentPrimaryPatterns: [],
    tuningOffsetCents: null,
    offerSuppressedUntil: null,
    pendingOffer: null,
    autoLevelUpUndo: null,
    autoRun: { count: 0, atMidTempo: 0 },
    placement: null,
  };
}

export function maxLevel(cfg: Configs): number {
  return cfg.levels.levels.length;
}

export const createProfile: GradeApi['createProfile'] = (id, displayName, now, activeInstrumentId, cfg) => ({
  schemaVersion: 1,
  id,
  displayName,
  createdAt: now,
  xp: 0,
  rank: 1,
  streak: { days: 0, lastDay: null },
  daily: { day: now.slice(0, 10), rankedCount: 0, attemptCount: 0, repeats: {} },
  instruments: { [activeInstrumentId]: newInstrumentProgress(1) },
  seenGroups: {},
  recentTips: [],
  rankedIndex: 0,
  lastSkipRankedIndex: null,
  activeInstrumentId,
  configVersion: cfg.configVersion,
});

/** Manual change, placement result or Undo: sets the level and resets the window and every window-derived state. */
export const setInstrumentLevel: GradeApi['setInstrumentLevel'] = (p, instrumentId, level, cfg) => {
  const lv = Math.min(maxLevel(cfg), Math.max(1, Math.round(level)));
  const cur = p.instruments[instrumentId] ?? newInstrumentProgress(lv);
  const inst: InstrumentProgress = {
    ...cur,
    level: lv,
    window: [],
    offerSuppressedUntil: null,
    pendingOffer: null,
    autoLevelUpUndo: null,
    autoRun: { count: 0, atMidTempo: 0 },
    placement: null,
  };
  return { ...p, instruments: { ...p.instruments, [instrumentId]: inst } };
};

/** Start the 3-excerpt placement for an instrument at the configured start level (02 §5.1). Returns the profile and the first level to serve. */
export function startPlacement(p: PlayerProfile, instrumentId: string, cfg: Configs): { profile: PlayerProfile; firstLevel: number } {
  const cur = p.instruments[instrumentId] ?? newInstrumentProgress(1);
  const inst: InstrumentProgress = { ...cur, placement: { step: 0, results: [] } };
  return { profile: { ...p, instruments: { ...p.instruments, [instrumentId]: inst } }, firstLevel: Math.min(maxLevel(cfg), cfg.progression.placement.startLevel) };
}

/** Accept (moves up, resets the window) or decline (suppresses the offer for N ranked attempts) a pending offer. */
export const respondToLevelOffer: GradeApi['respondToLevelOffer'] = (p, instrumentId, accept, cfg) => {
  const inst = p.instruments[instrumentId];
  if (!inst?.pendingOffer) return { profile: p, events: [] };
  if (accept) return { profile: setInstrumentLevel(p, instrumentId, inst.pendingOffer.to, cfg), events: [] };
  const declined: InstrumentProgress = {
    ...inst,
    pendingOffer: null,
    // Suppressed while attemptsRanked < until: the next N ranked attempts cannot raise an offer, the (N+1)th can.
    offerSuppressedUntil: inst.attemptsRanked + cfg.progression.levelWindow.offer.declineSuppressFor + 1,
  };
  const events: ProgressEvent[] = [];
  return { profile: { ...p, instruments: { ...p.instruments, [instrumentId]: declined } }, events };
};
