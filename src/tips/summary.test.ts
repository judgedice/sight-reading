// Session summary (02 §6.1 item 8; PLAN ruling 55): top 3 patterns of the session with their tips, the focus card,
// totals, and the every-10 cadence, over the shipped config/tips.json.
import { describe, expect, it } from 'vitest';
import { configs } from '../../fixtures/follow/gen/io.ts';
import type { AttemptRecord, PatternResult } from '../core/types.ts';
import { makeAttempt, makeScore } from '../store/test-data.ts';
import { focusPatternId, summarizeSession, summaryDue } from './summary.ts';

const cfg = configs();
const catalog = cfg.tips;
const pr = (id: string, lostPoints: number, bars: number[] = [2, 4]): PatternResult => ({ id, lostPoints, notes: [], bars });

function attempt(i: number, score: number, patterns: PatternResult[], tipsShown: string[] = [], over: Partial<AttemptRecord> = {}): AttemptRecord {
  const s = makeScore(score);
  const graded = { ...s, patterns, tipsShown, xp: { ...s.xp, total: 10 * i } };
  return makeAttempt(i, { levelServed: 4, ...over, score: over.score === null ? null : graded });
}

describe('summarizeSession', () => {
  it('ranks patterns by attempts fired, then lostPoints, top 3, each with its tip; clean read and voids left out', () => {
    const attempts = [
      attempt(1, 80, [pr('E12', 6), pr('E1', 4)], ['U12']),
      attempt(2, 85, [pr('E12', 5), pr('E16', 9)]),
      attempt(3, 90, [pr('E1', 3), pr('E16', 3), pr('E13', 7)], [], { instrumentId: 'trumpet-bb' }),
      attempt(4, 99, [pr('E30', 0, [])], ['U18']),
      attempt(5, 0, [pr('E13', 50)], [], { endReason: 'void', voidReason: 'interrupted', score: null }),
    ];
    const s = summarizeSession({ attempts, catalog, recentPrimaries: [], streakDays: 2, familyOf: (id) => cfg.instrumentById[id]?.family });
    expect(s.takes).toBe(5);
    expect(s.patterns.map((p) => [p.id, p.count])).toEqual([
      ['E16', 2],
      ['E12', 2],
      ['E1', 2],
    ]);
    expect(s.patterns[0]!.lostPoints).toBe(12);
    for (const p of s.patterns) {
      expect(p.name).toBe(catalog.patterns.find((d) => d.id === p.id)!.name);
      expect(p.tip, p.id).not.toBeNull();
      expect(p.tip!.patternId).toBe(p.id);
      expect(p.tip!.text).not.toMatch(/[{}]/);
    }
    // E12 keeps the tip the player was shown (U12); E1 falls back to its universal tip, and E16 (family-only) to the
    // attempt's instrument family tip that asserts no cause.
    expect(s.patterns.find((p) => p.id === 'E12')!.tip!.id).toBe('U12');
    expect(s.patterns.find((p) => p.id === 'E1')!.tip!.id).toBe('U01');
    const e16 = catalog.tips.find((t) => t.id === s.patterns[0]!.tip!.id)!;
    expect([e16.scope, e16.family, e16.assertsCause]).toEqual(['family', cfg.instrumentById[attempts[2]!.instrumentId]!.family, false]);
    // Without the family lookup a family-only pattern has no tip.
    expect(summarizeSession({ attempts, catalog, recentPrimaries: [], streakDays: 2 }).patterns[0]!.tip).toBeNull();
    // Evidence from the latest occurrence.
    expect(s.patterns.find((p) => p.id === 'E1')!.tip!.evidence).toContain('2 and 4');
    expect(s.averageScore).toBe(Math.round((80 + 85 + 90 + 99) / 4));
    expect(s.best).toMatchObject({ score: 99, attemptId: attempts[3]!.id });
    expect(s.xp).toBe(10 + 20 + 30 + 40);
    expect(s.streakDays).toBe(2);
    expect(s.focus).toBeNull();
  });

  it('a family tip the player was shown is kept for its pattern', () => {
    const s = summarizeSession({ attempts: [attempt(1, 80, [pr('E16', 6)], ['HB01'])], catalog, recentPrimaries: [], streakDays: 0 });
    expect(s.patterns[0]!.tip!.id).toBe('HB01');
  });

  it('the focus card: one pattern primary in 3 of the last 5 attempts', () => {
    const s = (rp: string[]) => summarizeSession({ attempts: [attempt(1, 80, [pr('E12', 6)])], catalog, recentPrimaries: rp, streakDays: 0 }).focus;
    expect(s(['E12', 'E1', 'E12', 'E16', 'E12'])).toEqual({ id: 'E12', name: catalog.patterns.find((d) => d.id === 'E12')!.name });
    expect(s(['E12', 'E1', 'E12', 'E16', 'E16', 'E12'])).toBeNull();
    // The clean read is never a focus.
    expect(focusPatternId(['E30', 'E30', 'E30', 'E1'], catalog)).toBeNull();
  });

  it('empty session', () => {
    const s = summarizeSession({ attempts: [], catalog, recentPrimaries: [], streakDays: 0 });
    expect(s).toEqual({ takes: 0, averageScore: null, xp: 0, best: null, patterns: [], streakDays: 0, focus: null });
  });

  it('is due every 10 attempts', () => {
    expect([0, 9, 10, 11, 20].map((n) => summaryDue(n, catalog))).toEqual([false, false, true, false, true]);
  });
});
