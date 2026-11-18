// Selection (01 §6.3, 02 §2.6, 03 §7.2–7.5) on synthetic manifests (BUILD-NOTES: levels 9-10 and empty pools need
// them) and on the fixture corpus. P9b acceptance: pool mix and stretch rate within ±5% of config over 5,000
// draws; ranked never returns a seen group; modal only with a random key; an empty pool returns suggestions.
import { describe, expect, it } from 'vitest';
import type { CorpusApi, SelectExcerptResult } from '../../core/api.ts';
import * as corpusIndex from '../index.ts';
import type { CorpusManifest, ExcerptDoc, KeySig, ManifestEntry, PracticeSettings, SelectionHistory, SelectionResult } from '../../core/types.ts';
import { configs, corpusDocs, readJson } from '../../../fixtures/follow/gen/io.ts';
import { createRng } from '../../core/rng.ts';
import { toMidi } from '../../theory/index.ts';
import { prepareExcerpt } from '../transpose/prepare.ts';
import { bandFor, levelDef } from './levels.ts';
import { countEligible, poolOf, selectExcerpt, selectExcerptWith } from './select.ts';
import { selectAndPrepare } from './select-and-prepare.ts';
import { manifestOf, synthDoc, type SynthSpec } from './testing/synthetic.ts';

const cfg = configs();
const sel = cfg.levels.selection;

function settings(p: Partial<PracticeSettings> = {}): PracticeSettings {
  return {
    instrumentId: 'flute',
    level: 5,
    writtenKey: 'random',
    meter: 'random',
    bpm: 'random',
    bars: 'random',
    mode: 'practice',
    listening: true,
    metronome: 'audible',
    clickTimbre: 'tick',
    outputMode: 'speakers',
    a4Hz: 440,
    ...p,
  };
}
function history(p: Partial<SelectionHistory> = {}): SelectionHistory {
  return { seenGroups: {}, recentExcerptIds: [], recentWorks: [], recentWrittenKeys: [], playerLevel: 5, ...p };
}
function ok(r: SelectExcerptResult): SelectionResult {
  if ('error' in r) throw new Error(`empty pool: ${JSON.stringify(r.suggestions)}`);
  return r;
}

interface Corpus {
  m: CorpusManifest;
  docs: Map<string, ExcerptDoc>;
  entries: ManifestEntry[];
}
function corpus(specs: SynthSpec[], seed = 1, withdrawn: string[] = []): Corpus {
  const rng = createRng(seed);
  const docs = new Map<string, ExcerptDoc>();
  const entries: ManifestEntry[] = [];
  for (const s of specs) {
    const { doc, entry } = synthDoc(s, rng);
    docs.set(doc.id, doc);
    entries.push(entry);
  }
  return { m: manifestOf(entries, withdrawn), docs, entries };
}
const KEYS: KeySig[] = [-2, -1, 0, 1, 2].map((f) => ({ fifths: f, mode: 'major' }));
function specs(prefix: string, n: number, p: Omit<SynthSpec, 'id' | 'key' | 'low' | 'span'> & Partial<SynthSpec>): SynthSpec[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, key: KEYS[i % KEYS.length]!, low: 62, span: 12, ...p }));
}

describe('CorpusApi conformance', () => {
  it('the barrel exports P9b members with the frozen signatures', () => {
    const api: Pick<CorpusApi, 'selectExcerpt' | 'prepareExcerpt' | 'countEligible'> = corpusIndex;
    expect(typeof api.selectExcerpt).toBe('function');
    expect(typeof api.prepareExcerpt).toBe('function');
    expect(typeof api.countEligible).toBe('function');
  });
});

describe('pool membership (02 §2.6 rules 1-3)', () => {
  const c = corpus([
    ...specs('l5-', 1, { level: 5 }),
    ...specs('l4-', 1, { level: 4 }),
    ...specs('l3-', 1, { level: 3 }),
    ...specs('st-', 1, { level: 5, stretchFeature: 'rhythm' }),
    ...specs('l6-', 1, { level: 6 }),
  ]);
  it('L, L-1 and stretch are pools; L-2 and a two-feature L+1 are not', () => {
    const byId = new Map(c.entries.map((e) => [e.id, e]));
    expect(poolOf(byId.get('l5-0')!, 5)).toBe('level');
    expect(poolOf(byId.get('l4-0')!, 5)).toBe('below');
    expect(poolOf(byId.get('l3-0')!, 5)).toBeNull();
    expect(poolOf(byId.get('st-0')!, 5)).toBe('stretch');
    // A synthetic L6 excerpt has rhythm 6 and nothing else above 1: that is a stretch excerpt for L5 too.
    expect(poolOf({ ...byId.get('l6-0')!, featureLevels: { ...byId.get('l6-0')!.featureLevels, meter: 6 } }, 5)).toBeNull();
  });
});

describe('pool mix and stretch rate over 5,000 draws (P9b acceptance)', () => {
  const big = corpus([
    ...specs('l5-', 40, { level: 5 }),
    ...specs('l4-', 40, { level: 4 }),
    ...specs('st-', 40, { level: 5, stretchFeature: 'leaps' }),
    ...specs('l3-', 20, { level: 3 }),
    // L6 with two features at 6: never served at L5.
    ...specs('x6-', 20, { level: 5, stretchFeature: 'leaps' }).map((s) => ({ ...s, level: 6, stretchFeature: 'rhythm' as const })),
  ]);
  const draw = (c: Corpus, n: number, h: SelectionHistory): Record<string, number> => {
    const counts: Record<string, number> = { level: 0, below: 0, stretch: 0, other: 0 };
    const rng = createRng(99);
    for (let i = 0; i < n; i++) {
      const r = ok(selectExcerpt(c.m, settings(), h, cfg, rng));
      const k = r.stretch ? 'stretch' : r.fromLevelBelow ? 'below' : r.entry.level === 5 ? 'level' : 'other';
      counts[k]!++;
    }
    return counts;
  };

  it('serves L-1 at maxFracFromLevelBelow and stretch at stretchRate, within ±0.05', () => {
    const n = 5000;
    const c = draw(big, n, history());
    expect(c.other).toBe(0);
    expect(Math.abs(c.below! / n - sel.maxFracFromLevelBelow)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(c.stretch! / n - sel.stretchRate)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(c.level! / n - (1 - sel.maxFracFromLevelBelow - sel.stretchRate))).toBeLessThanOrEqual(0.05);
  });

  it('raises the stretch rate to stretchRateLowPool when fewer than lowPoolUnseen unseen L excerpts remain', () => {
    const n = 5000;
    const seenGroups: Record<string, string> = {};
    // Leave lowPoolUnseen - 1 of the level-5 excerpts unseen (practice mode still serves the seen ones).
    big.entries.filter((e) => e.level === 5 && !e.id.startsWith('st-')).slice(sel.lowPoolUnseen - 1).forEach((e) => (seenGroups[e.dedupeGroup] = '2026-01-01T00:00:00Z'));
    const c = draw(big, n, history({ seenGroups }));
    expect(Math.abs(c.stretch! / n - sel.stretchRateLowPool)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(c.below! / n - sel.maxFracFromLevelBelow)).toBeLessThanOrEqual(0.05);
  });

  it('never serves L-1 alone: an L with only L-1 music is an empty pool', () => {
    const c = corpus(specs('l4-', 10, { level: 4 }));
    const r = selectExcerpt(c.m, settings(), history(), cfg, createRng(1));
    expect('error' in r).toBe(true);
    expect(countEligible(c.m, 'flute', 5, null, cfg)).toBe(0);
    expect(countEligible(c.m, 'flute', 4, null, cfg)).toBe(10);
  });
});

describe('ranked rules (02 §2.6 rule 4, §5.2, §5.3)', () => {
  const c = corpus([
    ...specs('a', 30, { level: 5 }),
    ...specs('fam', 5, { level: 5, familiarity: 2 }),
    // Two strophes of one melody share a group.
    ...specs('s', 2, { level: 5, dedupeGroup: 'shared' }),
  ]);
  it('never returns a seen dedupeGroup or a familiarity-2 excerpt in ranked mode', () => {
    const seenGroups: Record<string, string> = { shared: '2026-01-01T00:00:00Z' };
    c.entries.slice(0, 15).forEach((e) => (seenGroups[e.dedupeGroup] = '2026-01-01T00:00:00Z'));
    const rng = createRng(3);
    for (let i = 0; i < 2000; i++) {
      const r = ok(selectExcerpt(c.m, settings({ mode: 'ranked' }), history({ seenGroups }), cfg, rng));
      expect(r.entry.dedupeGroup in seenGroups).toBe(false);
      expect(r.entry.familiarity).toBeLessThan(2);
    }
  });
  it('practice mode may serve seen and familiar excerpts', () => {
    const rng = createRng(4);
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) ids.add(ok(selectExcerpt(c.m, settings(), history(), cfg, rng)).entry.id);
    expect([...ids].some((id) => id.startsWith('fam'))).toBe(true);
    expect(ids.has('s0') || ids.has('s1')).toBe(true);
  });
  it('an exhausted ranked pool is empty and suggests practice', () => {
    const seenGroups = Object.fromEntries(c.entries.map((e) => [e.dedupeGroup, '2026-01-01T00:00:00Z']));
    const r = selectExcerpt(c.m, settings({ mode: 'ranked', meter: '4/4' }), history({ seenGroups }), cfg, createRng(1));
    expect('error' in r && r.error).toBe('empty-pool');
    if (!('error' in r)) return;
    expect(r.suggestions).toContainEqual({ mode: 'practice' });
    expect(r.suggestions).not.toContainEqual({ meter: 'random' });
  });
});

describe('keys, modes and modal excerpts (R1, R8, 03 §7.5 rule 4, 02 §2.6 rule 6)', () => {
  const c = corpus([
    ...specs('maj', 20, { level: 5 }),
    ...specs('min', 20, { level: 5 }).map((s, i) => ({ ...s, key: { fifths: (i % 5) - 2, mode: 'minor' as const } })),
    ...specs('dor', 10, { level: 5, modal: 'dorian' }).map((s) => ({ ...s, key: { fifths: 0, mode: 'minor' as const } })),
  ]);
  it('modal excerpts come only with a random key', () => {
    const rng = createRng(5);
    let modal = 0;
    for (let i = 0; i < 1000; i++) {
      const r = ok(selectExcerpt(c.m, settings(), history(), cfg, rng));
      if (r.entry.modal) modal++;
      const k: KeySig = { fifths: rng.int(-4, 5), mode: rng.next() < 0.5 ? 'major' : 'minor' };
      const fixed = ok(selectExcerpt(c.m, settings({ writtenKey: k }), history(), cfg, rng));
      expect(fixed.entry.modal).toBeNull();
      expect(fixed.writtenKey).toEqual(k);
      expect(fixed.entry.mode).toBe(k.mode);
      expect(fixed.enharmonicRetry).toBe(false);
    }
    expect(modal).toBeGreaterThan(0);
  });
  it('a key not allowed at the level is an empty pool that suggests a random key', () => {
    const r = selectExcerpt(c.m, settings({ writtenKey: { fifths: 6, mode: 'major' } }), history(), cfg, createRng(1));
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.suggestions).toContainEqual({ writtenKey: 'random' });
  });
  it('never draws the same random written key more than maxSameKeyInRow times in a row', () => {
    const g: KeySig = { fifths: 1, mode: 'major' };
    const rng = createRng(6);
    for (let i = 0; i < 1000; i++) {
      const r = ok(selectExcerpt(c.m, settings(), history({ recentWrittenKeys: [g, g, { fifths: 0, mode: 'major' }] }), cfg, rng));
      expect(r.writtenKey).not.toEqual(g);
    }
  });
  it('weights sharp written keys for strings (×stringsSharpWeight)', () => {
    const rng = createRng(7);
    let sharp = 0;
    let flat = 0;
    for (let i = 0; i < 4000; i++) {
      const r = ok(selectExcerpt(c.m, settings({ instrumentId: 'violin' }), history(), cfg, rng));
      if (r.writtenKey.fifths > 0) sharp++;
      if (r.writtenKey.fifths < 0) flat++;
    }
    expect(sharp / flat).toBeGreaterThan(1.2);
    expect(sharp / flat).toBeLessThan(1.8);
  });
});

describe('03 §7.2 flag filters', () => {
  const c = corpus([
    ...specs('nb', 5, { level: 5, flags: ['noBreath'] }),
    ...specs('lp', 5, { level: 5, flags: ['leapy'] }).map((s) => ({ ...s, low: 66 })),
    ...specs('bl', 5, { level: 3, flags: ['bass-line'] }).map((s) => ({ ...s, low: 45 })),
  ]);
  const ids = (s: Partial<PracticeSettings>, h: Partial<SelectionHistory> = {}): Set<string> => {
    const rng = createRng(8);
    const out = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const r = selectExcerpt(c.m, settings(s), history(h), cfg, rng);
      if (!('error' in r)) out.add(r.entry.id.slice(0, 2));
    }
    return out;
  };
  it('noBreath: not for winds, brass or voice; fine for strings', () => {
    expect(ids({}).has('nb')).toBe(false);
    expect(ids({ instrumentId: 'trumpet-bb' }).has('nb')).toBe(false);
    expect(ids({ instrumentId: 'voice-soprano' }).has('nb')).toBe(false);
    expect(ids({ instrumentId: 'violin' }).has('nb')).toBe(true);
  });
  it('leapy: not for winds and brass at L1-L6', () => {
    expect(ids({}).has('lp')).toBe(false);
    expect(ids({ instrumentId: 'violin' }).has('lp')).toBe(true);
  });
  it('bass-line: only bass-clef instruments at L1-L5', () => {
    expect(ids({ instrumentId: 'cello', level: 3 }).has('bl')).toBe(true);
    expect(ids({ instrumentId: 'violin', level: 3 }).has('bl')).toBe(false);
  });
});

describe('tempo, bars, withdrawn, level and determinism', () => {
  const c = corpus([
    ...specs('a', 10, { level: 5, bars: 8 }),
    ...specs('b', 10, { level: 5, bars: 10 }),
    ...specs('slow', 5, { level: 5, tempo: [40, 60] }),
    ...specs('l9-', 10, { level: 9, low: 64 }),
    ...specs('l10-', 10, { level: 10, low: 64 }),
  ], 2, ['a0', 'b0']);

  it('withdrawn ids are never served', () => {
    const rng = createRng(9);
    for (let i = 0; i < 1000; i++) expect(['a0', 'b0']).not.toContain(ok(selectExcerpt(c.m, settings(), history(), cfg, rng)).entry.id);
  });
  it('an excerpt whose tempo range misses the level range is ineligible (03 §7.5 rule 5)', () => {
    const rng = createRng(10);
    for (let i = 0; i < 500; i++) {
      const r = ok(selectExcerpt(c.m, settings(), history(), cfg, rng));
      expect(r.entry.id.startsWith('slow')).toBe(false);
      expect(r.settings.bpm).toBeGreaterThanOrEqual(r.bpmRange.minBpm);
      expect(r.settings.bpm).toBeLessThanOrEqual(r.bpmRange.maxBpm);
      expect(r.bpmRange.minBpm).toBeGreaterThanOrEqual(levelDef(cfg, 5).tempo.minBpm);
    }
  });
  it('a fixed tempo above the detector or NPS limit is an empty pool', () => {
    const r = selectExcerpt(c.m, settings({ bpm: 400 }), history(), cfg, createRng(1));
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.suggestions).toContainEqual({ bpm: 'random' });
    expect(ok(selectExcerpt(c.m, settings({ bpm: 80 }), history(), cfg, createRng(1))).settings.bpm).toBe(80);
  });
  it('bar count is a preference, not a filter', () => {
    const rng = createRng(11);
    let ten = 0;
    for (let i = 0; i < 1000; i++) if (ok(selectExcerpt(c.m, settings({ bars: 10 }), history(), cfg, rng)).entry.bars === 10) ten++;
    expect(ten).toBeGreaterThan(600);
    expect(ten).toBeLessThan(1000);
  });
  it('serves levels 9 and 10, and a random level stays at or below the player level (R22)', () => {
    expect(ok(selectExcerpt(c.m, settings({ level: 9 }), history(), cfg, createRng(1))).levelServed).toBe(9);
    expect(ok(selectExcerpt(c.m, settings({ level: 10 }), history(), cfg, createRng(1))).levelServed).toBe(10);
    const rng = createRng(12);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const r = selectExcerpt(c.m, settings({ level: 'random' }), history({ playerLevel: 10 }), cfg, rng);
      if (!('error' in r)) {
        seen.add(r.levelServed);
        expect(r.settings.randomized).toContain('level');
      }
    }
    expect([...seen].every((l) => l >= 8 && l <= 10)).toBe(true);
    expect(seen.has(10)).toBe(true);
  });
  it('is deterministic: an explicit seed fixes the result, independent of the injected rng', () => {
    const a = selectExcerpt(c.m, settings({ seed: 1234 }), history(), cfg, createRng(1));
    const b = selectExcerpt(c.m, settings({ seed: 1234 }), history(), cfg, createRng(2));
    expect(a).toEqual(b);
    expect(ok(a).settings.seed).toBe(1234);
  });
  it('resolves the random fields and lists them', () => {
    const r = ok(selectExcerpt(c.m, settings(), history(), cfg, createRng(3)));
    expect(r.settings.randomized).toEqual(['key', 'meter', 'tempo', 'bars']);
    expect(r.settings.meter).toBe(r.entry.meter);
    expect([8, 10, 12]).toContain(r.settings.bars);
  });
  it('a meter with no music suggests a random meter; countEligible counts per meter', () => {
    const r = selectExcerpt(c.m, settings({ meter: '3/4' }), history(), cfg, createRng(1));
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.suggestions[0]).toEqual({ meter: 'random' });
    expect(countEligible(c.m, 'flute', 5, '3/4', cfg)).toBe(0);
    expect(countEligible(c.m, 'flute', 5, '4/4', cfg)).toBe(18); // 20 minus 2 withdrawn; the slow ones fail tempo
    expect(countEligible(c.m, 'flute', 5, null, cfg)).toBe(18);
  });
});

describe('spelling from the manifest: enharmonic retry for a random key only (03 §7.5 rule 3, PLAN ruling 44)', () => {
  // A minor lines with raised chromatic notes (C#, D#, F#, G#) at L7: sharp minor keys from 2 sharps up need double
  // sharps somewhere; D# minor may retry as E♭ minor, G# minor's enharmonic (A♭ minor, 7 flats) is not allowed at L7.
  const c = corpus(specs('am', 6, { level: 7, chromaticRate: 0.35, chromaticDirection: 'up' }).map((s) => ({ ...s, key: { fifths: 0, mode: 'minor' as const }, low: 64 })), 5);
  it('never returns a double accidental below L8; retries keep the enharmonic key', () => {
    const rng = createRng(13);
    let retries = 0;
    for (let i = 0; i < 600; i++) {
      const r = selectExcerptWith(c.m, settings({ level: 7 }), history({ playerLevel: 7 }), cfg, rng);
      if ('error' in r) continue;
      const p = prepareExcerpt(c.docs.get(r.entry.id)!, r, cfg.instrumentById.flute!, cfg);
      for (const m of p.measures) for (const e of m.events) if (e.kind === 'note') expect(Math.abs(e.writtenPitch.alter)).toBeLessThan(2);
      if (r.enharmonicRetry) {
        retries++;
        expect(r.writtenKey.fifths).toBeLessThan(0);
      }
    }
    expect(retries).toBeGreaterThan(0);
  });
  it('a chosen key that would need a double sharp is rejected, never re-spelled', () => {
    const k: KeySig = { fifths: 6, mode: 'minor' };
    for (let s = 0; s < 50; s++) {
      const r = selectExcerptWith(c.m, settings({ level: 7, writtenKey: k, seed: s }), history({ playerLevel: 7 }), cfg, createRng(1));
      if (!('error' in r)) {
        expect(r.writtenKey).toEqual(k);
        expect(() => prepareExcerpt(c.docs.get(r.entry.id)!, r, cfg.instrumentById.flute!, cfg)).not.toThrow();
      }
    }
  });
});

describe('fixture corpus and selectAndPrepare', () => {
  const entries = readJson<ManifestEntry[]>('fixtures/corpus/manifest-entries.json');
  const docs = new Map(corpusDocs().map((d) => [d.id, d]));
  const m = manifestOf(entries);

  it('selectAndPrepare loads exactly the chosen doc and returns a prepared excerpt that satisfies 03 §11 item 6', async () => {
    for (const [instrumentId, level] of [['violin', 6], ['cello', 3], ['flute', 4], ['clarinet-bb', 5], ['piano-rh', 7]] as const) {
      const loads: string[] = [];
      const r = await selectAndPrepare(m, settings({ instrumentId, level }), history({ playerLevel: level }), cfg, createRng(level), async (id) => {
        loads.push(id);
        return docs.get(id)!;
      });
      if ('error' in r) throw new Error(`${instrumentId} L${level}: empty pool`);
      // The manifest decides spelling and tempo exactly (PLAN ruling 44), so the first pick never has to be undone.
      expect(loads).toEqual([r.doc.id]);
      const band = bandFor(cfg.instrumentById[instrumentId]!, levelDef(cfg, level));
      for (const ms of r.prepared.measures)
        for (const e of ms.events)
          if (e.kind === 'note') {
            const w = toMidi(e.writtenPitch);
            expect(w).toBeGreaterThanOrEqual(band[0]);
            expect(w).toBeLessThanOrEqual(band[1]);
          }
      expect(r.prepared.selection).toBe(r.selection);
    }
  });

  it('withdrawn removes a fixture id at runtime', () => {
    const target = 'stanford-sq10517302-viola-mv3-mp142-150';
    const before = new Set<string>();
    const after = new Set<string>();
    const mw = manifestOf(entries, [target]);
    for (let s = 0; s < 400; s++) {
      const a = selectExcerpt(m, settings({ instrumentId: 'violin', level: 7, seed: s }), history(), cfg, createRng(1));
      const b = selectExcerpt(mw, settings({ instrumentId: 'violin', level: 7, seed: s }), history(), cfg, createRng(1));
      if (!('error' in a)) before.add(a.entry.id);
      if (!('error' in b)) after.add(b.entry.id);
    }
    expect(before.has(target)).toBe(true);
    expect(after.has(target)).toBe(false);
  });
});
