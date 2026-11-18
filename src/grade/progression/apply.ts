/**
 * `applyAttempt` (02 §5): folds one finished attempt into the player's profile and returns the events the results
 * screen shows. Pure and immutable; the input profile is never changed.
 *
 * Calendar day: `PlatformServices.localDay()` is the device's local day, but `applyAttempt`'s frozen signature has
 * no day argument, so it uses the attempt's UTC date. The session should call `applyAttemptOnDay` with the local day.
 */
import type { GradeApi } from '../../core/api.ts';
import type { AttemptRecord, Configs, InstrumentProgress, LevelWindowEntry, PlayerProfile, ProgressEvent } from '../../core/types.ts';
import { dayDiff } from './days.ts';
import { maxLevel, newInstrumentProgress, setInstrumentLevel } from './profile.ts';
import { maxLevelOf, rankFor } from './rank.ts';

const RECENT_PRIMARY_KEEP = 5;
const RECENT_TIPS_KEEP = 10;
const PRIMARY_MIN_LOST = 3;

export const applyAttempt: GradeApi['applyAttempt'] = (p, a, cfg) => applyAttemptOnDay(p, a, cfg, a.createdAt.slice(0, 10));

export function applyAttemptOnDay(p: PlayerProfile, a: AttemptRecord, cfg: Configs, day: string): { profile: PlayerProfile; events: ProgressEvent[] } {
  const events: ProgressEvent[] = [];
  let next: PlayerProfile = { ...p, seenGroups: { ...p.seenGroups } };
  // Revealed means seen, whatever happened after (02 §5.3). Voids and practise-without-listening included.
  if (!(a.dedupeGroup in next.seenGroups)) next.seenGroups[a.dedupeGroup] = a.createdAt;
  // A post-reveal skip, or an interruption void after the first note, uses the skip allowance (R33).
  if (a.countsAsSkip) next.lastSkipRankedIndex = next.rankedIndex;

  const score = a.score;
  if (a.endReason === 'void' || !a.listening || !score) return { profile: next, events };

  const prog = cfg.progression;
  // ---- day roll-over, streak break, daily counters ----------------------------------------
  let daily = next.daily;
  let streak = next.streak;
  if (daily.day !== day) {
    daily = { day, rankedCount: 0, attemptCount: 0, repeats: {} };
    if (streak.lastDay !== null && streak.days > 0 && dayDiff(streak.lastDay, day) > 1) {
      events.push({ type: 'streak-broken', previousDays: streak.days });
      streak = { days: 0, lastDay: streak.lastDay };
    }
  }
  const prevRepeat = daily.repeats[a.excerptId];
  daily = {
    ...daily,
    attemptCount: daily.attemptCount + 1,
    rankedCount: daily.rankedCount + (score.ranked ? 1 : 0),
    repeats: { ...daily.repeats, [a.excerptId]: prevRepeat === undefined ? 0 : prevRepeat + 1 },
  };
  if (score.ranked && daily.rankedCount >= prog.xp.streakMinRankedPerDay && streak.lastDay !== day) {
    const continues = streak.lastDay !== null && streak.days > 0 && dayDiff(streak.lastDay, day) === 1;
    streak = { days: continues ? streak.days + 1 : 1, lastDay: day };
    events.push({ type: 'streak', days: streak.days });
  }
  next = { ...next, daily, streak };

  // ---- XP and rank ------------------------------------------------------------------------
  const amount = Math.max(0, score.xp.total);
  const oldRank = next.rank;
  next.xp = next.xp + amount;
  events.push({ type: 'xp', amount, total: next.xp });
  if (score.ranked) next.rankedIndex = next.rankedIndex + 1;

  // ---- recent tips -------------------------------------------------------------------------
  if (score.tipsShown.length > 0) next.recentTips = [...score.tipsShown, ...next.recentTips.filter((t) => !score.tipsShown.includes(t))].slice(0, RECENT_TIPS_KEEP);

  // ---- instrument progress -----------------------------------------------------------------
  let inst: InstrumentProgress = { ...(next.instruments[a.instrumentId] ?? newInstrumentProgress(1)) };
  const counts = { ...inst.patternCounts };
  for (const pat of score.patterns) counts[pat.id] = (counts[pat.id] ?? 0) + 1;
  inst.patternCounts = counts;
  const primary = primaryPattern(score.patterns);
  if (primary) inst.recentPrimaryPatterns = [primary, ...inst.recentPrimaryPatterns].slice(0, RECENT_PRIMARY_KEEP);
  if (score.ranked) inst.attemptsRanked += 1;

  if (a.placement && inst.placement) {
    if (score.ranked) inst = placementStep(inst, a, score.score, cfg, events, a.instrumentId);
    next.instruments = { ...next.instruments, [a.instrumentId]: inst };
  } else {
    if (score.ranked && !a.placement) {
      const prevBest = inst.bestByLevel[a.levelServed];
      if (prevBest === undefined || score.score > prevBest) {
        inst.bestByLevel = { ...inst.bestByLevel, [a.levelServed]: score.score };
        if (prevBest !== undefined) events.push({ type: 'best', instrumentId: a.instrumentId, level: a.levelServed, score: score.score });
      }
    }
    next.instruments = { ...next.instruments, [a.instrumentId]: inst };
    if (score.ranked && !a.placement) next = updateWindow(next, a, score.score, cfg, events);
  }

  // ---- rank (never down) -------------------------------------------------------------------
  const r = rankFor(next.xp, maxLevelOf(next), cfg);
  if (r.rank > oldRank) {
    next.rank = r.rank;
    events.push({ type: 'rank-up', from: oldRank, to: r.rank, name: r.name });
  }
  return { profile: next, events };
}

/** Highest lostPoints at or above the primary threshold; E30 (clean read) when nothing else qualifies. */
function primaryPattern(patterns: { id: string; lostPoints: number }[]): string | null {
  let best: { id: string; lostPoints: number } | null = null;
  for (const pat of patterns) if (pat.lostPoints >= PRIMARY_MIN_LOST && (!best || pat.lostPoints > best.lostPoints)) best = pat;
  if (best) return best.id;
  return patterns.some((pat) => pat.id === 'E30') ? 'E30' : null;
}

function placementStep(inst: InstrumentProgress, a: AttemptRecord, score: number, cfg: Configs, events: ProgressEvent[], instrumentId: string): InstrumentProgress {
  const pl = cfg.progression.placement;
  const results = [...inst.placement!.results, { level: a.levelServed, score }];
  if (results.length >= pl.excerpts) {
    let final = pl.minLevel;
    for (const r of results) if (r.score >= pl.finalMinScore) final = Math.max(final, r.level);
    final = Math.min(maxLevel(cfg), final);
    events.push({ type: 'placement-done', instrumentId, level: final });
    return { ...inst, level: final, window: [], offerSuppressedUntil: null, pendingOffer: null, autoLevelUpUndo: null, autoRun: { count: 0, atMidTempo: 0 }, placement: null };
  }
  const delta = score >= pl.upIfAtLeast ? pl.upBy : score < pl.downIfBelow ? -pl.downBy : 0;
  const nextLevel = Math.min(maxLevel(cfg), Math.max(pl.minLevel, a.levelServed + delta));
  events.push({ type: 'placement-step', instrumentId, nextLevel });
  return { ...inst, placement: { step: results.length, results } };
}

/** Level window, offer, auto level-up and level-down suggestion (02 §5.6) after a ranked, non-placement attempt. */
function updateWindow(p: PlayerProfile, a: AttemptRecord, score: number, cfg: Configs, events: ProgressEvent[]): PlayerProfile {
  const w = cfg.progression.levelWindow;
  const id = a.instrumentId;
  let inst = p.instruments[id]!;
  const level = inst.level;
  // Stretch excerpts (one level up) count as L; excerpts served below L are outside the window.
  const counts = a.levelServed === level || (a.stretch && a.levelServed === level + 1);
  if (!counts) return p;
  const def = cfg.levelByNumber[level];
  const mid = def ? (def.tempo.minBpm + def.tempo.maxBpm) / 2 : Infinity;
  const atMid = a.bpm >= mid;
  const entry: LevelWindowEntry = { attemptId: a.id, score, atMidTempo: atMid };
  const window = [...inst.window, entry].slice(-w.size);
  const run = score >= w.auto.score ? { count: inst.autoRun.count + 1, atMidTempo: inst.autoRun.atMidTempo + (atMid ? 1 : 0) } : { count: 0, atMidTempo: 0 };
  inst = { ...inst, window, autoRun: run };

  const top = maxLevel(cfg);
  if (run.count >= w.auto.consecutive && run.atMidTempo >= w.auto.minAtMidTempo && level < top) {
    const from = level;
    const lifted = setInstrumentLevel({ ...p, instruments: { ...p.instruments, [id]: inst } }, id, level + 1, cfg);
    const li = lifted.instruments[id]!;
    events.push({ type: 'level-up-auto', instrumentId: id, from, to: level + 1 });
    return { ...lifted, instruments: { ...lifted.instruments, [id]: { ...li, autoLevelUpUndo: { from } } } };
  }

  if (window.length >= w.size) {
    const mean = window.reduce((s, e) => s + e.score, 0) / window.length;
    const high = window.filter((e) => e.score >= w.offer.score).length;
    const midCount = window.filter((e) => e.atMidTempo).length;
    const suppressed = inst.offerSuppressedUntil !== null && inst.attemptsRanked < inst.offerSuppressedUntil;
    if (level < top && !inst.pendingOffer && !suppressed && high >= w.offer.minCount && mean >= w.offer.meanMin && midCount >= w.offer.minAtMidTempo) {
      inst = { ...inst, pendingOffer: { to: level + 1 } };
      events.push({ type: 'level-up-offer', instrumentId: id, from: level, to: level + 1 });
    }
    const low = window.filter((e) => e.score < w.down.countScore).length;
    if (level > 1 && (mean < w.down.meanBelow || low >= w.down.countBelow)) events.push({ type: 'level-down-suggestion', instrumentId: id, level });
  }
  return { ...p, instruments: { ...p.instruments, [id]: inst } };
}
