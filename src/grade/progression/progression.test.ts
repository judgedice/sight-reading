// G6 and G7 acceptance: XP worked examples, rank ladder, level window rules, placement, ranked gates (02 §5).
import { describe, expect, it } from 'vitest';
import { configs } from '../../../fixtures/follow/gen/io.ts';
import { makeMeter } from '../../core/time.ts';
import type { AttemptRecord, GateId, GradeInput, PlayerProfile, ProgressEvent } from '../../core/types.ts';
import { makeAttempt, makeCalibration, makeProfile, makeScore } from '../../store/test-data.ts';
import { computeXp } from '../xp.ts';
import { applyAttempt, applyAttemptOnDay, createProfile, effectiveStreakDays, evaluateGate, hasSeen, postRevealSkipAllowed, rankFor, respondToLevelOffer, setInstrumentLevel, startPlacement, xpInputFor } from './index.ts';

const cfg = configs();
const mid = (l: number) => (cfg.levelByNumber[l]!.tempo.minBpm + cfg.levelByNumber[l]!.tempo.maxBpm) / 2;
const base = (over: Partial<PlayerProfile> = {}) => makeProfile({ xp: 0, rank: 1, rankedIndex: 0, seenGroups: {}, streak: { days: 0, lastDay: null }, daily: { day: '2026-03-01', rankedCount: 0, attemptCount: 0, repeats: {} }, ...over });
const att = (i: number, score: number, over: Partial<AttemptRecord> = {}, ranked = true): AttemptRecord =>
  makeAttempt(i, { instrumentId: 'flute', levelServed: 2, createdAt: '2026-03-01T10:00:00.000Z', bpm: mid(2), endReason: 'complete', excerptId: `x${i}`, dedupeGroup: `g${i}`, score: makeScore(score, ranked), ...over });
const run = (p: PlayerProfile, attempts: AttemptRecord[]) => {
  const events: ProgressEvent[] = [];
  let cur = p;
  for (const a of attempts) {
    const r = applyAttempt(cur, a, cfg);
    cur = r.profile;
    events.push(...r.events);
  }
  return { p: cur, events };
};
const of = (events: ProgressEvent[], t: ProgressEvent['type']) => events.filter((e) => e.type === t);

describe('rank ladder (02 §5.5)', () => {
  it('needs both XP and level', () => {
    expect(rankFor(0, 1, cfg).rank).toBe(1);
    expect(rankFor(300, 1, cfg).rank).toBe(1);
    expect(rankFor(300, 2, cfg).rank).toBe(2);
    expect(rankFor(100000, 4, cfg).rank).toBe(4);
    const top = rankFor(52000, 10, cfg);
    expect(top).toMatchObject({ rank: 10, name: 'Maestro', next: null, progress: 1 });
  });
  it('progress is by XP towards the next rank', () => {
    const r = rankFor(650, 3, cfg);
    expect(r.rank).toBe(2);
    expect(r.next).toMatchObject({ rank: 3, xp: 1000 });
    expect(r.progress).toBeCloseTo(0.5, 6);
  });
  it('rank never goes down when the level drops', () => {
    let p = base({ xp: 290, rank: 1, instruments: { flute: makeProfile().instruments.flute! } });
    p = setInstrumentLevel(p, 'flute', 3, cfg);
    const up = applyAttempt(p, att(1, 100), cfg);
    expect(up.profile.rank).toBe(2);
    expect(of(up.events, 'rank-up')).toEqual([{ type: 'rank-up', from: 1, to: 2, name: 'Apprentice' }]);
    const down = setInstrumentLevel(up.profile, 'flute', 1, cfg);
    expect(applyAttempt(down, att(2, 100, { levelServed: 1 }), cfg).profile.rank).toBe(2);
  });
});

describe('XP', () => {
  it('records the attempt XP and never decreases', () => {
    const a = att(1, 85);
    a.score!.xp = { total: 35, base: 34, factors: [] };
    const r = applyAttempt(base(), a, cfg);
    expect(r.profile.xp).toBe(35);
    expect(of(r.events, 'xp')).toEqual([{ type: 'xp', amount: 35, total: 35 }]);
    const z = att(2, 85, { endReason: 'void' });
    expect(applyAttempt(r.profile, z, cfg).profile.xp).toBe(35);
  });
  it('worked example L5, S85, mid tempo, random key, 6 day streak = 35 (02 §5.4) via profile-derived inputs', () => {
    const p = base({ streak: { days: 6, lastDay: '2026-03-01' }, instruments: { flute: { ...makeProfile().instruments.flute!, level: 5 } } });
    const xp = xpInputFor(p, { instrumentId: 'flute', excerptId: 'e', randomized: { key: true, meter: false, tempo: false }, placement: false }, '2026-03-01');
    expect(xp).toMatchObject({ playerLevel: 5, streakDays: 6, dailyCountBefore: 0, repeatIndexToday: 0 });
    const input = { cfg, level: 5, bpm: mid(5), meter: makeMeter(4, 4), xp, ranking: { metronome: 'audible' } } as unknown as GradeInput;
    expect(computeXp(input, 85, 'ok', true).total).toBe(35);
  });
  it('farming is worthless: L5 player at L1, S100 earns 3', () => {
    const xp = { playerLevel: 5, randomized: { key: false, meter: false, tempo: false }, streakDays: 0, dailyCountBefore: 0, repeatIndexToday: 0, placement: false };
    const input = { cfg, level: 1, bpm: mid(1), meter: makeMeter(4, 4), xp, ranking: { metronome: 'audible' } } as unknown as GradeInput;
    expect(computeXp(input, 100, 'ok', true).total).toBe(3);
  });
  it('xpInputFor tracks the daily cap, repeats and a broken streak', () => {
    const p = base({ streak: { days: 4, lastDay: '2026-03-01' }, daily: { day: '2026-03-01', rankedCount: 3, attemptCount: 61, repeats: { e: 0 } } });
    const q = { instrumentId: 'flute', excerptId: 'e', randomized: { key: false, meter: false, tempo: false }, placement: false };
    expect(xpInputFor(p, q, '2026-03-01')).toMatchObject({ dailyCountBefore: 61, repeatIndexToday: 1, streakDays: 4 });
    expect(xpInputFor(p, q, '2026-03-02')).toMatchObject({ dailyCountBefore: 0, repeatIndexToday: 0, streakDays: 4 });
    expect(xpInputFor(p, q, '2026-03-03')).toMatchObject({ streakDays: 0 });
    expect(effectiveStreakDays({ days: 0, lastDay: null }, '2026-03-03')).toBe(0);
  });
});

describe('streak and daily counters', () => {
  it('a streak day needs 3 ranked attempts; practice counts toward the cap only', () => {
    const { p, events } = run(base(), [att(1, 80), att(2, 80, {}, false), att(3, 80), att(4, 80)]);
    expect(p.daily).toMatchObject({ rankedCount: 3, attemptCount: 4 });
    expect(p.streak).toEqual({ days: 1, lastDay: '2026-03-01' });
    expect(of(events, 'streak')).toHaveLength(1);
  });
  it('consecutive days extend; a missed day breaks', () => {
    const day = (d: string, n: number) => Array.from({ length: 3 }, (_, k) => att(n + k, 80, { createdAt: `${d}T10:00:00.000Z` }));
    const two = run(base(), [...day('2026-03-01', 1), ...day('2026-03-02', 10)]);
    expect(two.p.streak).toEqual({ days: 2, lastDay: '2026-03-02' });
    const broken = run(two.p, [att(20, 80, { createdAt: '2026-03-05T10:00:00.000Z' })]);
    expect(of(broken.events, 'streak-broken')).toEqual([{ type: 'streak-broken', previousDays: 2 }]);
    expect(broken.p.streak.days).toBe(0);
    expect(broken.p.daily).toMatchObject({ day: '2026-03-05', attemptCount: 1 });
  });
  it('tracks repeats of an excerpt within a day', () => {
    const { p } = run(base(), [att(1, 80, { excerptId: 'same' }), att(2, 80, { excerptId: 'same' }), att(3, 80, { excerptId: 'same' })]);
    expect(p.daily.repeats.same).toBe(2);
  });
  it('applyAttemptOnDay uses the given local day', () => {
    const r = applyAttemptOnDay(base(), att(1, 80), cfg, '2026-04-09');
    expect(r.profile.daily.day).toBe('2026-04-09');
  });
});

describe('level window, offers and auto level-up (02 §5.6)', () => {
  const fresh = () => setInstrumentLevel(base(), 'flute', 2, cfg);
  it('window keeps the last 5 ranked attempts at the level, excludes practice, void, placement and lower levels', () => {
    const list = [att(1, 70), att(2, 70, {}, false), att(3, 70, { endReason: 'void', score: null }), att(4, 70, { levelServed: 1 }), att(5, 70, { placement: true }), ...[6, 7, 8, 9, 10, 11].map((i) => att(i, 70))];
    const { p } = run(fresh(), list);
    const inst = p.instruments.flute!;
    expect(inst.window).toHaveLength(5);
    expect(inst.window.map((w) => w.attemptId)).toEqual([7, 8, 9, 10, 11].map((i) => makeAttempt(i).id));
  });
  it('a stretch excerpt counts as the level; incomplete counts at its capped score', () => {
    const { p } = run(fresh(), [att(1, 80, { levelServed: 3, stretch: true }), att(2, 50, { endReason: 'stopped' })]);
    expect(p.instruments.flute!.window.map((w) => w.score)).toEqual([80, 50]);
  });
  it('offers a level up at 4 of 5 >= 85, mean >= 85, 2 at mid tempo', () => {
    const slow = mid(2) - 5;
    const { p, events } = run(fresh(), [att(1, 90), att(2, 88, { bpm: slow }), att(3, 86, { bpm: slow }), att(4, 60, { bpm: slow }), att(5, 99)]);
    // 4 of 5 >= 85 but mean 84.6: no offer
    expect(of(events, 'level-up-offer')).toHaveLength(0);
    const ok = run(fresh(), [att(1, 90), att(2, 88, { bpm: slow }), att(3, 86, { bpm: slow }), att(4, 84, { bpm: slow }), att(5, 99)]);
    expect(of(ok.events, 'level-up-offer')).toEqual([{ type: 'level-up-offer', instrumentId: 'flute', from: 2, to: 3 }]);
    expect(ok.p.instruments.flute!.pendingOffer).toEqual({ to: 3 });
    expect(p.instruments.flute!.pendingOffer).toBeNull();
  });
  it('no offer without 2 mid-tempo attempts', () => {
    const slow = mid(2) - 5;
    const { events } = run(fresh(), [90, 90, 90, 90, 90].map((s, i) => att(i + 1, s, { bpm: slow })));
    expect(of(events, 'level-up-offer')).toHaveLength(0);
  });
  it('a compound take on a dotted-beat difficulty is at mid tempo against the dotted range (02 §2.4)', () => {
    const [level] = cfg.levels.compound.dottedBeatLevels;
    const d = cfg.levels.compound.dottedBpm;
    const dottedMid = Math.ceil((d.minBpm + d.maxBpm) / 2);
    const at4 = setInstrumentLevel(base(), 'flute', level, cfg);
    const sixEight = (i: number, meter: string): AttemptRecord => {
      const a = att(i, 90, { levelServed: level, bpm: dottedMid });
      return { ...a, settingsResolved: { ...a.settingsResolved, level, meter } };
    };
    // The served meter passed by the session, with the meter requested as random.
    const served = applyAttemptOnDay(at4, sixEight(1, 'random'), cfg, '2026-03-01', makeMeter(6, 8));
    expect(served.profile.instruments.flute!.window).toEqual([expect.objectContaining({ atMidTempo: true })]);
    // The requested meter when the session does not pass one.
    expect(applyAttempt(at4, sixEight(2, '6/8'), cfg).profile.instruments.flute!.window[0]!.atMidTempo).toBe(true);
    // A simple meter at the same tempo is below the level's quarter-note mid.
    expect(applyAttempt(at4, sixEight(3, '3/4'), cfg).profile.instruments.flute!.window[0]!.atMidTempo).toBe(false);
  });
  it('accepting moves up and resets the window; declining suppresses for 5 ranked attempts', () => {
    const ok = run(fresh(), [90, 90, 90, 90, 90].map((s, i) => att(i + 1, s)));
    const acc = respondToLevelOffer(ok.p, 'flute', true, cfg);
    expect(acc.profile.instruments.flute).toMatchObject({ level: 3, window: [], pendingOffer: null });
    const dec = respondToLevelOffer(ok.p, 'flute', false, cfg).profile;
    expect(dec.instruments.flute).toMatchObject({ pendingOffer: null, offerSuppressedUntil: 3 + 5 + 5 + 1 });
    const more = run(dec, [6, 7, 8, 9, 10].map((i) => att(i, 88)));
    expect(of(more.events, 'level-up-offer')).toHaveLength(0);
    const again = run(more.p, [att(11, 88)]);
    expect(of(again.events, 'level-up-offer')).toHaveLength(1);
  });
  it('responding without a pending offer changes nothing', () => {
    const p = fresh();
    expect(respondToLevelOffer(p, 'flute', true, cfg).profile).toBe(p);
  });
  it('auto level-up after 8 consecutive >= 90 with 2 at mid tempo, with undo', () => {
    const slow = mid(2) - 5;
    const list = Array.from({ length: 8 }, (_, i) => att(i + 1, 92, { bpm: i < 2 ? mid(2) : slow }));
    const { p, events } = run(fresh(), list);
    expect(of(events, 'level-up-auto')).toEqual([{ type: 'level-up-auto', instrumentId: 'flute', from: 2, to: 3 }]);
    expect(p.instruments.flute).toMatchObject({ level: 3, window: [], autoLevelUpUndo: { from: 2 }, autoRun: { count: 0, atMidTempo: 0 } });
    const undone = setInstrumentLevel(p, 'flute', 2, cfg);
    expect(undone.instruments.flute).toMatchObject({ level: 2, autoLevelUpUndo: null });
  });
  it('a score under 90 resets the auto run', () => {
    const list = [...Array.from({ length: 7 }, (_, i) => att(i + 1, 95)), att(8, 80), att(9, 95)];
    const { events, p } = run(fresh(), list);
    expect(of(events, 'level-up-auto')).toHaveLength(0);
    expect(p.instruments.flute!.autoRun.count).toBe(1);
  });
  it('suggests level down at mean < 60 or 3 below 55, never automatically', () => {
    const a = run(setInstrumentLevel(base(), 'flute', 3, cfg), [1, 2, 3, 4, 5].map((i) => att(i, 58, { levelServed: 3, bpm: mid(3) })));
    expect(of(a.events, 'level-down-suggestion')).toHaveLength(1);
    expect(a.p.instruments.flute!.level).toBe(3);
    const b = run(setInstrumentLevel(base(), 'flute', 3, cfg), [54, 54, 54, 95, 95].map((s, i) => att(i + 1, s, { levelServed: 3 })));
    expect(of(b.events, 'level-down-suggestion')).toHaveLength(1);
    const d = run(setInstrumentLevel(base(), 'flute', 1, cfg), [1, 2, 3, 4, 5].map((i) => att(i, 20, { levelServed: 1 })));
    expect(of(d.events, 'level-down-suggestion')).toHaveLength(0);
  });
  it('manual level change resets the window', () => {
    const { p } = run(fresh(), [att(1, 90)]);
    const m = setInstrumentLevel(p, 'flute', 7, cfg);
    expect(m.instruments.flute).toMatchObject({ level: 7, window: [] });
    expect(setInstrumentLevel(p, 'flute', 99, cfg).instruments.flute!.level).toBe(10);
  });
  it('best score events fire only when beating an earlier best', () => {
    const { events, p } = run(fresh(), [att(1, 70), att(2, 80), att(3, 75)]);
    expect(of(events, 'best')).toEqual([{ type: 'best', instrumentId: 'flute', level: 2, score: 80 }]);
    expect(p.instruments.flute!.bestByLevel[2]).toBe(80);
  });
  it('does not mutate its inputs', () => {
    const p = fresh();
    const before = JSON.stringify(p);
    applyAttempt(p, att(1, 90), cfg);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('placement (02 §5.1)', () => {
  const start = () => startPlacement(base({ instruments: {} }), 'flute', cfg);
  const pa = (i: number, level: number, score: number) => att(i, score, { levelServed: level, placement: true });
  it('starts at L2', () => expect(start().firstLevel).toBe(2));
  it('walks +2 on >= 85, -1 on < 60, same otherwise; final = highest level with score >= 75', () => {
    const { p, events } = run(start().profile, [pa(1, 2, 90), pa(2, 4, 50), pa(3, 3, 80)]);
    expect(of(events, 'placement-step')).toEqual([
      { type: 'placement-step', instrumentId: 'flute', nextLevel: 4 },
      { type: 'placement-step', instrumentId: 'flute', nextLevel: 3 },
    ]);
    expect(of(events, 'placement-done')).toEqual([{ type: 'placement-done', instrumentId: 'flute', level: 3 }]);
    expect(p.instruments.flute).toMatchObject({ level: 3, placement: null, window: [] });
  });
  it('final level is at least 1 and placement attempts earn XP but skip the window', () => {
    const r = run(start().profile, [pa(1, 2, 40), pa(2, 1, 40), pa(3, 1, 40)]);
    expect(of(r.events, 'placement-done')).toEqual([{ type: 'placement-done', instrumentId: 'flute', level: 1 }]);
    expect(r.p.xp).toBeGreaterThan(0);
    expect(r.p.instruments.flute!.window).toEqual([]);
    expect(r.p.instruments.flute!.bestByLevel).toEqual({});
  });
  it('an unranked placement attempt does not consume a step', () => {
    const a = att(1, 90, { levelServed: 2, placement: true }, false);
    expect(applyAttempt(start().profile, a, cfg).profile.instruments.flute!.placement).toEqual({ step: 0, results: [] });
  });
});

describe('seen, skip and voids (02 §5.3)', () => {
  it('marks seen at reveal, even for voids and unheard takes', () => {
    const v = applyAttempt(base(), att(1, 0, { endReason: 'void', score: null }), cfg).profile;
    expect(hasSeen(v, 'g1')).toBe(true);
    const u = applyAttempt(base(), att(2, 0, { listening: false, score: null }), cfg).profile;
    expect(hasSeen(u, 'g2')).toBe(true);
    expect(u.xp).toBe(0);
  });
  it('an interruption void counts against the skip limit and burns no XP', () => {
    const p = base({ rankedIndex: 10 });
    const r = applyAttempt(p, att(1, 0, { endReason: 'void', score: null, countsAsSkip: true }), cfg).profile;
    expect(r.lastSkipRankedIndex).toBe(10);
    expect(postRevealSkipAllowed(r, cfg)).toBe(false);
    expect(postRevealSkipAllowed({ ...r, rankedIndex: 14 }, cfg)).toBe(false);
    expect(postRevealSkipAllowed({ ...r, rankedIndex: 15 }, cfg)).toBe(true);
    expect(postRevealSkipAllowed(p, cfg)).toBe(true);
  });
  it('ranked attempts advance rankedIndex; practice does not', () => {
    const { p } = run(base(), [att(1, 80), att(2, 80, {}, false)]);
    expect(p.rankedIndex).toBe(1);
    expect(p.instruments.flute!.attemptsRanked).toBe(4);
  });
  it('records pattern counts, primary pattern, and recent tips', () => {
    const a = att(1, 80);
    a.score!.patterns = [{ id: 'E1', lostPoints: 2, notes: [], bars: [] }, { id: 'E16', lostPoints: 6, notes: [], bars: [] }];
    a.score!.tipsShown = ['U02', 'U03'];
    const p = applyAttempt(base({ recentTips: ['U02', 'U09'] }), a, cfg).profile;
    expect(p.instruments.flute!.patternCounts).toMatchObject({ E1: 3, E16: 1 });
    expect(p.instruments.flute!.recentPrimaryPatterns[0]).toBe('E16');
    expect(p.recentTips).toEqual(['U02', 'U03', 'U09']);
  });
});

describe('createProfile', () => {
  it('starts at XP 0, rank 1', () => {
    const p = createProfile('id-1', 'Ada', '2026-03-01T08:00:00.000Z', 'violin', cfg);
    expect(p).toMatchObject({ xp: 0, rank: 1, activeInstrumentId: 'violin', rankedIndex: 0, configVersion: cfg.configVersion });
    expect(p.instruments.violin!.level).toBe(1);
    expect(p.daily.day).toBe('2026-03-01');
  });
});

describe('measurement gate (05 §4, G7)', () => {
  const good = () => ({
    calibration: { ...makeCalibration('r'), method: 'loopback' as const, spreadMs: 1, clicksDetected: 8, roundTripMs: 60, stale: false, aecSuspected: false, sanityToneCents: 0 },
    applied: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    sampleRateOk: true,
    recheck: null,
    captureGaps: 0,
    latencyCompensationMs: 60,
  });
  const gate = (over: Record<string, unknown> = {}, calOver: Record<string, unknown> = {}): GateId[] => {
    const g = { ...good(), ...over };
    g.calibration = over.calibration === undefined ? { ...g.calibration, ...calOver } : (over.calibration as never);
    return evaluateGate(g as never, cfg);
  };
  it('passes a clean take', () => expect(gate()).toEqual([]));
  it('missing, stale or reported calibration is unmeasured', () => {
    expect(gate({ calibration: null })).toEqual(['calibration-unmeasured']);
    expect(gate({}, { stale: true })).toEqual(['calibration-unmeasured']);
    expect(gate({}, { method: 'reported' })).toEqual(['calibration-unmeasured']);
  });
  it('flags quality, AEC, processing, recheck, gaps and RTL', () => {
    expect(gate({}, { spreadMs: 3.5 })).toEqual(['calibration-quality']);
    expect(gate({}, { aecSuspected: true })).toEqual(['aec-suspected']);
    expect(gate({ applied: { echoCancellation: true, noiseSuppression: false, autoGainControl: null } })).toEqual(['processing-on']);
    expect(gate({ recheck: { status: 'unmeasured', measuredMs: null, clicks: 0, madMs: null, usedFresh: false, promptRecalibrate: false } })).toEqual(['recheck']);
    expect(gate({ recheck: { status: 'measured', measuredMs: 90, clicks: 4, madMs: 1, usedFresh: true, promptRecalibrate: true } })).toEqual([]);
    expect(gate({ captureGaps: 1 })).toEqual(['capture-gap']);
    expect(gate({ latencyCompensationMs: 121 })).toEqual(['rtl-high']);
    expect(gate({ sampleRateOk: false })).toEqual(['sample-rate']);
  });
});
