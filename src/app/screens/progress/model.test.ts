import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfigs } from '../../../rules/index.ts';
import { makeProfile } from '../../../store/test-data.ts';
import type { Configs, InstrumentProgress } from '../../../core/types.ts';
import { patternDef } from '../results/model.ts';
import { bestByLevel, instrumentCards, ladder, slipsInstrument, topSlips, windowSquares } from './model.ts';

const read = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as unknown;
const cfg: Configs = loadConfigs({
  grading: read('config/grading-config.json'),
  levels: read('config/levels.json'),
  instruments: read('config/instruments.json'),
  progression: read('config/progression.json'),
  tips: read('config/tips.json'),
  budget: read('config/measurement-budget.json'),
  trumpetValves: read('data/trumpet-valves.json'),
} as never);

function progress(over: Partial<InstrumentProgress> = {}): InstrumentProgress {
  return {
    level: 2, window: [], attemptsRanked: 0, bestByLevel: {}, patternCounts: {}, recentPrimaryPatterns: [],
    tuningOffsetCents: null, offerSuppressedUntil: null, pendingOffer: null, autoLevelUpUndo: null,
    autoRun: { count: 0, atMidTempo: 0 }, placement: null, ...over,
  };
}

describe('ladder', () => {
  it('marks achieved, current and future ranks from the profile rank', () => {
    const items = ladder(cfg, { rank: 3 });
    expect(items).toHaveLength(cfg.progression.ranks.table.length);
    expect(items.slice(0, 2).every((r) => r.state === 'achieved')).toBe(true);
    expect(items[2]?.state).toBe('current');
    expect(items.slice(3).every((r) => r.state === 'future')).toBe(true);
    expect(items[3]?.xp).toBe(cfg.progression.ranks.table[3]?.xp);
  });
});

describe('windowSquares', () => {
  it('pads to the configured window size with empty slots on the left and flags passes and tempo', () => {
    const size = cfg.progression.levelWindow.size;
    const pass = cfg.progression.levelWindow.offer.score;
    const sq = windowSquares(progress({ window: [
      { attemptId: 'a', score: pass - 1, atMidTempo: false },
      { attemptId: 'b', score: pass, atMidTempo: true },
    ] }), cfg);
    expect(sq).toHaveLength(size);
    expect(sq.slice(0, size - 2).every((x) => x === null)).toBe(true);
    expect(sq[size - 2]).toEqual({ score: pass - 1, passed: false, midTempo: false });
    expect(sq[size - 1]).toEqual({ score: pass, passed: true, midTempo: true });
  });

  it('keeps only the last window-size entries', () => {
    const size = cfg.progression.levelWindow.size;
    const many = Array.from({ length: size + 3 }, (_, i) => ({ attemptId: `x${i}`, score: 50 + i, atMidTempo: false }));
    const sq = windowSquares(progress({ window: many }), cfg);
    expect(sq.map((x) => x?.score)).toEqual(many.slice(-size).map((e) => e.score));
  });
});

describe('bestByLevel', () => {
  it('lists the best score per level, highest level first, and skips non-numeric keys', () => {
    expect(bestByLevel(progress({ bestByLevel: { 1: 88, 3: 71, 2: 90 } }))).toEqual([
      { level: 3, score: 71 },
      { level: 2, score: 90 },
      { level: 1, score: 88 },
    ]);
  });
});

describe('instrumentCards', () => {
  it('puts the active instrument first, then by label, with labels from config', () => {
    const profile = makeProfile({
      activeInstrumentId: 'violin',
      instruments: { flute: progress({ level: 2 }), violin: progress({ level: 4 }), cello: progress({ level: 1 }) },
    });
    const cards = instrumentCards(cfg, profile);
    expect(cards[0]?.id).toBe('violin');
    expect(cards.slice(1).map((c) => c.id)).toEqual(['cello', 'flute']);
    expect(cards[0]?.label).toBe(cfg.instrumentById['violin']?.label);
  });
});

describe('topSlips and slipsInstrument', () => {
  it('returns up to five fired patterns, most frequent first, with their names', () => {
    const counts = { E1: 2, E2: 9, E3: 0, E4: 5, E5: 1, E6: 4, E7: 3 };
    const slips = topSlips(cfg, progress({ patternCounts: counts }));
    expect(slips.map((s) => s.id)).toEqual(['E2', 'E4', 'E6', 'E7', 'E1']);
    expect(slips[0]?.count).toBe(9);
    expect(slips[0]?.name).toBe(patternDef(cfg, 'E2')?.name ?? 'E2');
  });

  it('is empty without an instrument', () => {
    expect(topSlips(cfg, undefined)).toEqual([]);
  });

  it('picks the active instrument when played, else the first played one', () => {
    expect(slipsInstrument(makeProfile({ activeInstrumentId: 'violin', instruments: { flute: progress(), violin: progress() } }))).toBe('violin');
    expect(slipsInstrument(makeProfile({ activeInstrumentId: 'cello', instruments: { flute: progress() } }))).toBe('flute');
    expect(slipsInstrument(makeProfile({ activeInstrumentId: 'cello', instruments: {} }))).toBeNull();
  });
});
