// P13 acceptance (01 P13 row; 02 §6.1 items 4 to 7, §6.3 to §6.4): at most two tips, recency and family rules,
// clean-read fallback, instrument-specific text keys, and determinism. Inputs are synthetic PatternResults over the
// real config/tips.json, so the tests exercise the shipped catalog.
import { describe, expect, it } from 'vitest';
import { configs } from '../../fixtures/follow/gen/io.ts';
import type { Instrument, PatternResult, TipCatalog, TipSelectionInput } from '../core/types.ts';
import { selectTips } from './select.ts';
import { evidenceLine, formatBars } from './text.ts';

const cfg = configs();
const catalog = cfg.tips;
const inst = (id: string): Instrument => cfg.instrumentById[id]!;

function pr(id: string, lostPoints: number, bars: number[] = [1, 2], params?: Record<string, number>): PatternResult {
  const p: PatternResult = { id, lostPoints, notes: [], bars };
  if (params) p.params = params;
  return p;
}

function input(over: Partial<TipSelectionInput> & { instrumentId?: string; catalog?: TipCatalog } = {}): TipSelectionInput {
  const { instrumentId, ...rest } = over;
  return {
    patterns: [],
    instrument: inst(instrumentId ?? 'flute'),
    level: 3,
    recentTipIds: [],
    recentPrimaries: [],
    catalog,
    ...rest,
  };
}

const ids = (tips: { id: string }[]) => tips.map((t) => t.id);

describe('selectTips: thresholds and count', () => {
  it('returns nothing without patterns', () => {
    expect(selectTips(input())).toEqual([]);
  });

  it('needs lostPoints of at least 3 for the primary tip', () => {
    expect(selectTips(input({ patterns: [pr('E4', 2.9)] }))).toEqual([]);
    const [t] = selectTips(input({ patterns: [pr('E4', 3)] }));
    expect(t).toMatchObject({ id: 'U04', patternId: 'E4', primary: true });
  });

  it('adds a secondary tip only at lostPoints of at least 5, and never more than two', () => {
    const one = selectTips(input({ patterns: [pr('E1', 10), pr('E4', 4)] }));
    expect(ids(one)).toEqual(['U01']);
    const two = selectTips(input({ patterns: [pr('E1', 10), pr('E4', 8), pr('E9', 7)] }));
    expect(ids(two)).toEqual(['U01', 'U04']);
    expect(two.map((t) => t.primary)).toEqual([true, false]);
    expect(two.length).toBeLessThanOrEqual(catalog.selection.maxTips);
  });

  it('breaks lostPoints ties by config order, so the result is deterministic', () => {
    // E1 precedes E2 in config/tips.json.
    expect(ids(selectTips(input({ patterns: [pr('E2', 10), pr('E1', 10)] })))).toEqual(['U01', 'U02']);
  });

  it('shows one tip for E28 and E29 together, since both map to U20', () => {
    const tips = selectTips(input({ patterns: [pr('E28', 8, [4]), pr('E29', 7, [1])] }));
    expect(ids(tips)).toEqual(['U20']);
  });
});

describe('selectTips: recency and family rules', () => {
  it('skips a tip shown in the last three tips and takes the next pattern', () => {
    const tips = selectTips(input({ patterns: [pr('E1', 10), pr('E4', 8)], recentTipIds: ['U01'] }));
    expect(ids(tips)).toEqual(['U04']);
    expect(tips[0]!.primary).toBe(true);
  });

  it('ignores recent tips beyond the skip window', () => {
    const tips = selectTips(input({ patterns: [pr('E1', 10)], recentTipIds: ['a', 'b', 'c', 'U01'] }));
    expect(ids(tips)).toEqual(['U01']);
  });

  it('returns nothing when the only tip was shown recently', () => {
    expect(selectTips(input({ patterns: [pr('E1', 10)], recentTipIds: ['U01'] }))).toEqual([]);
  });

  it('prefers a family tip over the universal tip for the same pattern', () => {
    const tips = selectTips(input({ instrumentId: 'piano-rh', patterns: [pr('E12', 6)] }));
    expect(ids(tips)).toEqual(['KB04']);
    expect(tips[0]!.text).toContain('D major');
  });

  it('takes the universal variant when the family tip was shown recently', () => {
    const tips = selectTips(input({ instrumentId: 'piano-rh', patterns: [pr('E12', 6)], recentTipIds: ['KB04'] }));
    expect(ids(tips)).toEqual(['U12']);
  });

  it('shows an assertsCause family tip only when its pattern was primary in 2 of the last 5 attempts', () => {
    const base = { instrumentId: 'flute', patterns: [pr('E12', 6)] };
    expect(ids(selectTips(input({ ...base, recentPrimaries: ['E12', 'E1', 'E12', 'E4', 'E9'] })))).toEqual(['FL05']);
    expect(ids(selectTips(input({ ...base, recentPrimaries: ['E12', 'E1', 'E4', 'E9', 'E7', 'E12'] })))).toEqual(['U12']);
    expect(ids(selectTips(input({ ...base, recentPrimaries: [] })))).toEqual(['U12']);
  });

  it('applies the assertsCause history to the last five attempts only', () => {
    const tips = selectTips(input({ instrumentId: 'flute', patterns: [pr('E12', 6)], recentPrimaries: ['E1', 'E1', 'E1', 'E1', 'E1', 'E12', 'E12'] }));
    expect(ids(tips)).toEqual(['U12']);
  });
});

describe('selectTips: instruments, beta and conditions', () => {
  it('uses instrument-specific text for trumpet and excludes E16 elsewhere', () => {
    expect(ids(selectTips(input({ instrumentId: 'trumpet-bb', patterns: [pr('E16', 5)] })))).toEqual(['HB01']);
    expect(selectTips(input({ instrumentId: 'flute', patterns: [pr('E16', 5)] }))).toEqual([]);
  });

  it('gives beta instruments universal tips only', () => {
    // piano-lh is beta and in the keyboard family, so KB04 must not apply.
    expect(ids(selectTips(input({ instrumentId: 'piano-lh', patterns: [pr('E12', 6)] })))).toEqual(['U12']);
  });

  it('drops E22 and E23 on beta instruments (selection.betaDisabledPatterns)', () => {
    expect(selectTips(input({ instrumentId: 'viola', patterns: [pr('E22', 6, [1, 2], { offset: 30, direction: -1 })] }))).toEqual([]);
  });

  it('applies SX04 only when the detector reports a B-flat is involved', () => {
    const withBflat = input({ instrumentId: 'sax-alto', patterns: [pr('E12', 6, [1, 2], { 'bflat-involved': 1 })], recentPrimaries: ['E12', 'E12'] });
    expect(ids(selectTips(withBflat))).toEqual(['SX04']);
    const without = input({ instrumentId: 'sax-alto', patterns: [pr('E12', 6)], recentPrimaries: ['E12', 'E12'] });
    expect(ids(selectTips(without))).toEqual(['U12']);
  });

  it('respects the tip level range', () => {
    const cat: TipCatalog = { ...catalog, tips: catalog.tips.map((t) => (t.id === 'U01' ? { ...t, minLevel: 5 } : t)) };
    expect(selectTips(input({ patterns: [pr('E1', 10)], catalog: cat, level: 3 }))).toEqual([]);
    expect(ids(selectTips(input({ patterns: [pr('E1', 10)], catalog: cat, level: 5 })))).toEqual(['U01']);
  });

  it('ignores disabled patterns', () => {
    const cat: TipCatalog = { ...catalog, patterns: catalog.patterns.map((d) => (d.id === 'E1' ? { ...d, enabled: false } : d)) };
    expect(selectTips(input({ patterns: [pr('E1', 10)], catalog: cat }))).toEqual([]);
  });
});

describe('selectTips: evidence and text', () => {
  it('fills the U22 offset and direction', () => {
    const [t] = selectTips(input({ instrumentId: 'flute', patterns: [pr('E22', 6, [2, 4], { offset: 34.6, direction: -1 })] }));
    expect(t!.id).toBe('U22');
    expect(t!.text).toBe('You were about 35 cents flat throughout. Use the tuning note before the next exercise.');
    const [sharp] = selectTips(input({ instrumentId: 'flute', patterns: [pr('E22', 6, [2, 4], { offset: 20, direction: 1 })] }));
    expect(sharp!.text).toContain('about 20 cents sharp');
  });

  it('shows no tip when a placeholder has no param value', () => {
    expect(selectTips(input({ instrumentId: 'flute', patterns: [pr('E22', 6)] }))).toEqual([]);
  });

  it('formats the evidence line with bar numbers', () => {
    const [t] = selectTips(input({ patterns: [pr('E1', 10, [7, 3, 5])] }));
    expect(t!.evidence).toBe('Seen in bars 3, 5 and 7.');
    expect(t!.bars).toEqual([3, 5, 7]);
    expect(formatBars([4, 4])).toBe('4');
    expect(formatBars([3, 9])).toBe('3 and 9');
  });

  it('uses a pattern-specific evidence template when the catalog gives one', () => {
    const cat: TipCatalog = { ...catalog, patterns: catalog.patterns.map((d) => (d.id === 'E1' ? { ...d, evidenceTemplate: 'Bars {bars}.' } : d)) };
    expect(selectTips(input({ patterns: [pr('E1', 10, [2, 3])], catalog: cat }))[0]!.evidence).toBe('Bars 2 and 3.');
    expect(evidenceLine(pr('E1', 10, [2]), undefined, catalog)).toBe('Seen in bars 2.');
  });

  it('requires two bars of evidence except for the exempt patterns', () => {
    expect(selectTips(input({ patterns: [pr('E1', 10, [4])] }))).toEqual([]);
    expect(ids(selectTips(input({ patterns: [pr('E28', 8, [4])] })))).toEqual(['U20']);
  });
});

describe('selectTips: clean-read fallback', () => {
  it('shows U18 when only E30 fires', () => {
    const tips = selectTips(input({ patterns: [pr('E30', 0, [])] }));
    expect(tips).toEqual([{ id: 'U18', patternId: 'E30', text: expect.any(String), evidence: '', bars: [], primary: true }]);
    expect(tips[0]!.id).toBe(catalog.selection.cleanReadTipId);
  });

  it('shows nothing for E30 when its tip was shown recently', () => {
    expect(selectTips(input({ patterns: [pr('E30', 0, [])], recentTipIds: ['U18'] }))).toEqual([]);
  });

  it('does not show U18 when a real tip is available', () => {
    expect(ids(selectTips(input({ patterns: [pr('E30', 0, []), pr('E4', 4)] })))).toEqual(['U04']);
  });
});

describe('selectTips: purity', () => {
  it('is deterministic and does not mutate its input', () => {
    const i = input({ patterns: [pr('E1', 10, [5, 3]), pr('E4', 8), pr('E9', 7)], recentTipIds: ['U09'], recentPrimaries: ['E4'] });
    const snapshot = JSON.parse(JSON.stringify(i)) as unknown;
    const first = selectTips(i);
    expect(selectTips(i)).toEqual(first);
    expect(JSON.parse(JSON.stringify(i))).toEqual(snapshot);
  });
});

describe('config/tips.json consistency with the tip rules', () => {
  const enabledPatterns = catalog.patterns.filter((d) => d.enabled).map((d) => d.id);

  it('gives every enabled pattern at least one enabled tip', () => {
    const covered = new Set(catalog.tips.filter((t) => t.enabled).flatMap((t) => t.patterns));
    expect(enabledPatterns.filter((id) => !covered.has(id))).toEqual([]);
  });

  it('keeps enabled family tips on launch instruments and their families', () => {
    for (const t of catalog.tips.filter((x) => x.enabled && x.scope === 'family')) {
      for (const iid of t.instruments ?? []) {
        expect(cfg.instrumentById[iid], `${t.id} instrument ${iid}`).toBeDefined();
        expect(cfg.instrumentById[iid]!.status, `${t.id} ${iid}`).toBe('launch');
        expect(cfg.instrumentById[iid]!.family, `${t.id} family`).toBe(t.family);
      }
    }
  });

  it('uses only the placeholders that detectors fill', () => {
    for (const t of catalog.tips.filter((x) => x.enabled)) {
      for (const m of t.text.matchAll(/\{(\w+)\}/g)) expect(['offset', 'direction']).toContain(m[1]);
    }
  });
});
