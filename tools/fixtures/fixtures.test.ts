// Contract tests for the P0e fixture corpus and golden expected notes (01 §6.1–6.4, §14 items 7 and 8; P0e row).
//
// - Every corpus file validates against its generated schema; index hashes and sizes match the bytes on disk.
// - Bar sums are exact and events are contiguous in every measure.
// - The coverage list of 01 §14 item 7 is asserted from the note data itself, not from tags.
// - Provenance: every excerpt names a real OpenScore file, part and bar range, CC0, composer died before 1931.
// - The column manifest decodes to `manifest-entries.json` and agrees with the excerpt documents.
// - Every golden in fixtures/expected/ is recomputed here by an implementation independent of
//   tools/fixtures/expected.py, and the two must agree exactly (the "two independent runs, empty diff" criterion).
import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  CorpusIndex,
  ExcerptChunk,
  ExcerptDoc,
  ExpectedGolden,
  ExpectedNote,
  GradingConfig,
  Instrument,
  InstrumentsConfig,
  Interval,
  KeySig,
  LevelsConfig,
  ManifestEntry,
  ManifestFile,
  NoteEvt,
  ScoreEvent,
  SpelledPitch,
  Step,
} from '../../src/core/types.ts';

const root = new URL('../../', import.meta.url);
const readText = (rel: string): string => readFileSync(new URL(rel, root), 'utf8');
const readJson = <T>(rel: string): T => JSON.parse(readText(rel)) as T;
const readBytes = (rel: string): Buffer => readFileSync(new URL(rel, root));
const sha256 = (b: Buffer | string): string => 'sha256:' + createHash('sha256').update(b).digest('hex');

function validator(name: string) {
  const ajv = new Ajv({ strict: true, allowUnionTypes: true, allErrors: true });
  return ajv.compile(readJson<object>(`schemas/${name}.schema.json`));
}

const CORPUS = 'fixtures/corpus/';
const index = readJson<CorpusIndex>(`${CORPUS}index.json`);
const chunks = index.chunks.map((c) => readJson<ExcerptChunk>(`${CORPUS}${c.file}`));
const docs: ExcerptDoc[] = chunks.flatMap((c) => c.excerpts);
const manifest = readJson<ManifestFile>(`${CORPUS}${index.manifest.file}`);
const levels = readJson<LevelsConfig>('config/levels.json');
const instruments = readJson<InstrumentsConfig>('config/instruments.json').instruments;
const grading = readJson<GradingConfig>('config/grading-config.json');

const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMIS: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midi = (p: SpelledPitch): number => (p.octave + 1) * 12 + STEP_SEMIS[p.step] + p.alter;
const barTicks = (d: ExcerptDoc): number => d.meter.countUnitTicks * d.meter.countsPerBar;
const allEvents = (d: ExcerptDoc): ScoreEvent[] => d.measures.flatMap((m) => m.events);
const notesOf = (d: ExcerptDoc): NoteEvt[] => allEvents(d).filter((e): e is NoteEvt => e.kind === 'note');

/** Alteration a key signature gives a letter. */
function keyAlter(fifths: number, step: Step): number {
  const sharps: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  if (fifths > 0) return sharps.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return [...sharps].reverse().slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}

/** Spelled tonic of a key (independent of the Python helper: walks the circle of fifths from C or A). */
function tonic(k: KeySig): { step: Step; alter: number } {
  let idx = k.mode === 'major' ? 0 : 5; // C or A
  const n = Math.abs(k.fifths);
  for (let i = 0; i < n; i++) idx = (idx + (k.fifths > 0 ? 4 : 3)) % 7;
  const step = STEPS[idx] as Step;
  return { step, alter: keyAlter(k.fifths, step) };
}
const tonicPc = (k: KeySig): number => {
  const t = tonic(k);
  return (((STEP_SEMIS[t.step] + t.alter) % 12) + 12) % 12;
};
const mod = (a: number, n: number): number => ((a % n) + n) % n;

// =====================================================================================================
// Files and schemas
// =====================================================================================================

describe('fixtures/corpus files', () => {
  it('index.json validates and every referenced file matches its hash and size', () => {
    const v = validator('corpus-index');
    expect(v(index), JSON.stringify(v.errors)).toBe(true);
    for (const ref of [index.manifest, index.attributions, ...index.chunks]) {
      const bytes = readBytes(`${CORPUS}${ref.file}`);
      expect(sha256(bytes), ref.file).toBe(ref.hash);
      expect(bytes.length, ref.file).toBe(ref.bytes);
      expect(ref.file, 'hashed file name').toContain(ref.hash.slice(7, 17));
    }
  });

  it('the directory holds exactly the indexed files plus index, withdrawn, decoded entries and the source lock', () => {
    const files = readdirSync(new URL(CORPUS, root)).filter((f) => f.endsWith('.json')).sort();
    const expected = [
      'index.json',
      'withdrawn.json',
      'manifest-entries.json',
      'sources.lock.json',
      index.manifest.file,
      index.attributions.file,
      ...index.chunks.map((c) => c.file),
    ].sort();
    expect(files).toEqual(expected);
  });

  it('every chunk, excerpt, manifest, attributions and withdrawn file validates against its schema', () => {
    const vChunk = validator('excerpt-chunk');
    const vDoc = validator('excerpt');
    for (const c of chunks) expect(vChunk(c), `${c.shard} ${JSON.stringify(vChunk.errors)}`).toBe(true);
    for (const d of docs) expect(vDoc(d), `${d.id} ${JSON.stringify(vDoc.errors)}`).toBe(true);
    const vMan = validator('manifest');
    expect(vMan(manifest), JSON.stringify(vMan.errors)).toBe(true);
    const vAttr = validator('attributions');
    const attr = readJson<object>(`${CORPUS}${index.attributions.file}`);
    expect(vAttr(attr), JSON.stringify(vAttr.errors)).toBe(true);
    const vW = validator('withdrawn');
    expect(vW(readJson<object>(`${CORPUS}withdrawn.json`)), JSON.stringify(vW.errors)).toBe(true);
  });

  it('holds 24 excerpts with unique ids; chunks hold at most 64, ordered by id, one level per chunk', () => {
    expect(docs).toHaveLength(24);
    expect(new Set(docs.map((d) => d.id)).size).toBe(24);
    for (const [i, c] of chunks.entries()) {
      expect(c.shard).toBe(index.chunks[i]?.shard);
      expect(c.excerpts.length).toBeLessThanOrEqual(64);
      const ids = c.excerpts.map((d) => d.id);
      expect(ids).toEqual([...ids].sort());
      for (const d of c.excerpts) expect(c.shard.startsWith(`shard-L${String(d.level).padStart(2, '0')}-`), d.id).toBe(true);
    }
  });

  it('contentHash is sha256 of the canonical document without contentHash and review', () => {
    const canon = (v: unknown): string => {
      if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
      if (v !== null && typeof v === 'object')
        return `{${Object.keys(v as object)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
          .join(',')}}`;
      return JSON.stringify(v);
    };
    for (const d of docs) {
      const body: Record<string, unknown> = { ...d };
      delete body['contentHash'];
      delete body['review'];
      expect(sha256(canon(body)), d.id).toBe(d.contentHash);
    }
  });
});

// =====================================================================================================
// Structure: bar sums, contiguity, ties, slurs, tuplets
// =====================================================================================================

describe('excerpt structure', () => {
  it.each(docs.map((d) => [d.id, d] as const))('%s: bar sums exact, events contiguous, ids unique', (_id, d) => {
    const bt = barTicks(d);
    expect(d.meter.countUnitTicks * d.meter.countsPerBar).toBe((d.meter.beats * 1920) / d.meter.beatType);
    let tick = 0;
    const ids = new Set<string>();
    for (const [i, m] of d.measures.entries()) {
      expect(m.index).toBe(i);
      expect(m.isPickup).toBe(i === 0 && d.pickupTicks > 0);
      expect(m.startTick).toBe(tick);
      const len = m.isPickup ? d.pickupTicks : bt;
      expect(m.events.reduce((s, e) => s + e.dur, 0), `bar ${i} sum`).toBe(len);
      let t = m.startTick;
      for (const e of m.events) {
        expect(e.tick, `${e.id} contiguous`).toBe(t);
        expect(Number.isInteger(e.dur) && e.dur > 0, e.id).toBe(true);
        expect(ids.has(e.id), `${e.id} unique`).toBe(false);
        ids.add(e.id);
        t += e.dur;
      }
      tick += len;
    }
    const full = d.measures.filter((m) => !m.isPickup).length;
    expect(full).toBeGreaterThanOrEqual(8);
    expect(full).toBeLessThanOrEqual(12);
    expect(d.pickupTicks).toBeLessThan(bt);
  });

  it.each(docs.map((d) => [d.id, d] as const))('%s: ties join equal pitches, slurs balance, triplets fill whole beats', (_id, d) => {
    const evs = allEvents(d);
    for (const [i, e] of evs.entries()) {
      if (e.kind !== 'note') continue;
      if (e.tieStart) {
        const n = evs[i + 1];
        expect(n?.kind === 'note' && n.tieStop === true && midi(n.pitch) === midi(e.pitch), `${e.id} tie`).toBe(true);
      }
      if (e.tieStop) {
        const p = evs[i - 1];
        expect(p?.kind === 'note' && p.tieStart === true, `${e.id} tie stop`).toBe(true);
      }
    }
    let depth = 0;
    for (const n of notesOf(d)) {
      if (n.slur === 'stop' || n.slur === 'continue') depth -= 1;
      expect(depth, `${n.id} slur`).toBeGreaterThanOrEqual(0);
      if (n.slur === 'start' || n.slur === 'continue') depth += 1;
    }
    expect(depth).toBe(0);
    const groups = new Map<string, ScoreEvent[]>();
    for (const e of evs) if (e.tuplet) groups.set(e.tuplet.groupId, [...(groups.get(e.tuplet.groupId) ?? []), e]);
    for (const [g, es] of groups) {
      const span = es.reduce((s, e) => s + e.dur, 0);
      expect(span % 480, `tuplet ${g} spans whole quarters`).toBe(0);
      for (const e of es) expect(e.tuplet?.actual === 3 && e.tuplet.normal === 2, `${e.id} triplet`).toBe(true);
    }
    // the final bar ends on a note followed only by rests (window ends at a cadence, H2/H11)
    const last = d.measures.at(-1)?.events ?? [];
    const li = last.map((e) => e.kind).lastIndexOf('note');
    expect(li, 'last bar has a note').toBeGreaterThanOrEqual(0);
    expect(last.slice(li + 1).every((e) => e.kind === 'rest')).toBe(true);
    expect((last[li] as NoteEvt).tieStart).toBeUndefined();
  });

  it.each(docs.map((d) => [d.id, d] as const))('%s: derived fields agree with the notes', (_id, d) => {
    const notes = notesOf(d);
    const mids = notes.map((n) => midi(n.pitch));
    expect(d.rangeConcert).toEqual({ min: Math.min(...mids), max: Math.max(...mids) });
    const hi = notes.find((n) => midi(n.pitch) === d.rangeConcert.max);
    const lo = notes.find((n) => midi(n.pitch) === d.rangeConcert.min);
    expect(d.extremes).toEqual({ highId: hi?.id, lowId: lo?.id });
    expect(d.level).toBe(Math.max(...Object.values(d.featureLevels)));
    expect(d.levelConfidence).toBe(Object.values(d.featureLevels).filter((v) => v === d.level).length);
    expect(d.barRhythmLevel).toHaveLength(d.measures.length);
    expect(d.features.noteCount).toBe(notes.filter((n) => !n.tieStop).length);
    expect(d.features.spanSemis).toBe(d.rangeConcert.max - d.rangeConcert.min);
    expect(d.features.shortestDur).toBe(Math.min(...allEvents(d).map((e) => e.dur)));
    expect(d.modal).toBeNull();
    const keys = (v: unknown): string[] =>
      Array.isArray(v) ? v.flatMap(keys) : v !== null && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : [];
    expect(keys(d).filter((k) => /lyric/i.test(k)), 'no lyric field (R8)').toEqual([]);
    expect(d.modifications[0]).toBe('excerpted');
    if (d.source.corpus === 'openscore-lieder') expect(d.modifications).toContain('lyrics-removed');
    expect(d.tempo.minBpm).toBeLessThanOrEqual(d.tempo.maxBpm);
  });
});

// =====================================================================================================
// Coverage list (01 §14 item 7), asserted from the data
// =====================================================================================================

describe('coverage (01 §14 item 7)', () => {
  const count = (pred: (d: ExcerptDoc) => boolean): number => docs.filter(pred).length;
  const meterOf = (d: ExcerptDoc): string => `${d.meter.beats}/${d.meter.beatType}`;

  it('source clefs: treble, bass, alto and tenor', () => {
    for (const clef of ['treble', 'bass', 'alto', 'tenor']) expect(count((d) => d.tags.includes(`source-clef:${clef}`)), clef).toBeGreaterThanOrEqual(1);
    // the clef tag agrees with the source instrument for the C clefs
    for (const d of docs.filter((x) => x.tags.includes('source-clef:alto'))) expect(d.source.originalInstrument).toBe('viola');
    for (const d of docs.filter((x) => x.tags.includes('source-clef:tenor'))) expect(d.source.originalInstrument).toBe('cello');
  });

  it('meters 2/4, 3/4, 4/4, 6/8 and 2/2, with the 02 count units', () => {
    for (const m of ['2/4', '3/4', '4/4', '6/8', '2/2']) expect(count((d) => meterOf(d) === m), m).toBeGreaterThanOrEqual(2);
    for (const d of docs) {
      const unit = meterOf(d) === '6/8' ? 720 : meterOf(d) === '2/2' ? 960 : 480;
      expect(d.meter.countUnitTicks, d.id).toBe(unit);
    }
  });

  it('major and minor', () => {
    expect(count((d) => d.keyConcert.mode === 'major')).toBeGreaterThanOrEqual(6);
    expect(count((d) => d.keyConcert.mode === 'minor')).toBeGreaterThanOrEqual(4);
  });

  it('pickups', () => {
    expect(count((d) => d.pickupTicks > 0)).toBeGreaterThanOrEqual(4);
    expect(count((d) => d.pickupTicks === d.meter.countUnitTicks)).toBeGreaterThanOrEqual(1);
    expect(count((d) => d.pickupTicks > 0 && d.pickupTicks !== d.meter.countUnitTicks)).toBeGreaterThanOrEqual(1);
  });

  it('ties across the barline', () => {
    const crosses = (d: ExcerptDoc): boolean =>
      d.measures.some((m, i) => {
        const last = m.events.at(-1);
        const next = d.measures[i + 1]?.events[0];
        return last?.kind === 'note' && last.tieStart === true && next?.kind === 'note' && next.tieStop === true;
      });
    expect(count(crosses)).toBeGreaterThanOrEqual(3);
  });

  it('triplets', () => {
    expect(count((d) => allEvents(d).some((e) => e.tuplet?.actual === 3))).toBeGreaterThanOrEqual(2);
  });

  it('accidentals outside the key signature', () => {
    const chromatic = (d: ExcerptDoc): boolean => notesOf(d).some((n) => n.pitch.alter !== keyAlter(d.keyConcert.fifths, n.pitch.step));
    expect(count(chromatic)).toBeGreaterThanOrEqual(8);
    expect(count((d) => notesOf(d).some((n) => Math.abs(n.pitch.alter) === 2)), 'a double accidental').toBeGreaterThanOrEqual(1);
  });

  it('a repeated-note passage (3 or more re-struck equal pitches in a row)', () => {
    const repeated = (d: ExcerptDoc): boolean => {
      const evs = allEvents(d);
      let run = 1;
      for (let i = 1; i < evs.length; i++) {
        const a = evs[i - 1];
        const b = evs[i];
        run = a?.kind === 'note' && b?.kind === 'note' && !b.tieStop && midi(a.pitch) === midi(b.pitch) ? run + 1 : 1;
        if (run >= 3) return true;
      }
      return false;
    };
    expect(count(repeated)).toBeGreaterThanOrEqual(2);
  });

  it('a slurred run (4 or more stepwise notes of at most a beat under one slur)', () => {
    const run = (d: ExcerptDoc): boolean => {
      let cur: NoteEvt[] | null = null;
      for (const n of notesOf(d)) {
        if (n.slur === 'start') cur = [n];
        else if (cur) {
          cur.push(n);
          if (n.slur === 'stop' || n.slur === 'continue') {
            const ok =
              cur.length >= 4 &&
              cur.every((x) => x.dur <= d.meter.countUnitTicks) &&
              cur.every((x, i) => i === 0 || Math.abs(midi(x.pitch) - midi((cur as NoteEvt[])[i - 1]!.pitch)) <= 2);
            if (ok) return true;
            cur = n.slur === 'continue' ? [n] : null;
          }
        }
      }
      return false;
    };
    expect(count(run)).toBeGreaterThanOrEqual(2);
  });

  it('rests inside the excerpt', () => {
    const inner = (d: ExcerptDoc): boolean => {
      const evs = allEvents(d);
      const lastNote = evs.map((e) => e.kind).lastIndexOf('note');
      return evs.slice(0, lastNote).some((e) => e.kind === 'rest');
    };
    expect(count(inner)).toBeGreaterThanOrEqual(10);
  });

  it('a spread of levels: 1, 2, 3 and at least 7 distinct levels including one at 7 or above', () => {
    const lv = new Set(docs.map((d) => d.level));
    for (const l of [1, 2, 3, 4, 5, 6]) expect(lv.has(l), `level ${l}`).toBe(true);
    expect(docs.some((d) => d.level >= 7)).toBe(true);
    expect(lv.size).toBeGreaterThanOrEqual(7);
  });

  it('both OpenScore corpora, all four quartet roles and Lieder voices; 8, 10 and 12 bars', () => {
    expect(count((d) => d.source.corpus === 'openscore-lieder')).toBeGreaterThanOrEqual(8);
    expect(count((d) => d.source.corpus === 'openscore-quartets')).toBeGreaterThanOrEqual(8);
    for (const inst of ['voice', 'violin', 'viola', 'cello']) expect(count((d) => d.source.originalInstrument === inst), inst).toBeGreaterThanOrEqual(1);
    const bars = (d: ExcerptDoc): number => d.measures.filter((m) => !m.isPickup).length;
    for (const n of [8, 10, 12]) expect(count((d) => bars(d) === n), `${n} bars`).toBeGreaterThanOrEqual(1);
  });

  it('one familiarity-2 (practice only) excerpt, the rest 0', () => {
    expect(count((d) => d.familiarity === 2)).toBe(1);
    expect(count((d) => d.familiarity === 0)).toBe(23);
  });
});

// =====================================================================================================
// Provenance and licence (03 §6.2, §6.11, §9; PLAN R25, R28)
// =====================================================================================================

describe('provenance', () => {
  const lock = readJson<{ sources: { corpus: string; repo: string; commit: string }[] }>(`${CORPUS}sources.lock.json`);

  it('every excerpt cites a pinned OpenScore file, part and bar range under CC0, composer died before 1931', () => {
    for (const d of docs) {
      const s = d.source;
      const src = lock.sources.find((x) => x.corpus === s.corpus);
      expect(src, d.id).toBeDefined();
      expect(s.upstreamRef, d.id).toMatch(new RegExp(`^${src!.repo}@${src!.commit.slice(0, 8)}:scores/.+\\.mxl$`));
      expect(s.license).toBe('CC0-1.0');
      expect(s.licenseUrl).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
      expect(s.sourceUrl).toBe(`https://github.com/${src!.repo}`);
      expect(s.composerDeath).not.toBeNull();
      expect(s.composerDeath!).toBeLessThan(1931);
      expect(s.partName, d.id).toBeTruthy();
      const [a, b] = s.sourceMeasures;
      expect(b - a + 1, `${d.id} bar range covers every measure`).toBe(d.measures.length);
      expect(d.id).toContain(`-m${d.pickupTicks ? 'p' : ''}${a}-${b}`);
    }
  });

  it('attributions credit both collections and hold no CC BY items', () => {
    const attr = readJson<{ collections: { corpus: string; name: string }[]; items: unknown[] }>(`${CORPUS}${index.attributions.file}`);
    expect(attr.collections.map((c) => c.name).sort()).toEqual(['OpenScore Lieder', 'OpenScore String Quartets']);
    expect(attr.items).toEqual([]);
  });
});

// =====================================================================================================
// Manifest decoding (P9a's golden)
// =====================================================================================================

describe('manifest', () => {
  const entries = readJson<ManifestEntry[]>(`${CORPUS}manifest-entries.json`);
  const dictCols = new Set(['composer', 'title', 'work']);
  const decoded: ManifestEntry[] = manifest.rows.map((row) => {
    const e: Record<string, unknown> = {};
    manifest.columns.forEach((col, j) => {
      const v = row[j];
      if (dictCols.has(col)) e[col] = manifest.dict[col as 'composer' | 'title' | 'work'][v as number];
      else if (col === 'tags') e[col] = (v as number[]).map((i) => manifest.dict.tags[i]);
      else e[col] = v;
    });
    return e as unknown as ManifestEntry;
  });

  it('the column manifest decodes to manifest-entries.json', () => {
    expect(decoded).toEqual(entries);
    expect(entries.map((e) => e.id)).toEqual([...entries.map((e) => e.id)].sort());
  });

  it('every entry agrees with its excerpt document and names the chunk holding it', () => {
    for (const e of entries) {
      const d = docs.find((x) => x.id === e.id)!;
      expect(d, e.id).toBeDefined();
      const chunk = chunks.find((c) => c.excerpts.some((x) => x.id === e.id))!;
      expect(e.shard).toBe(chunk.shard);
      expect(e.level).toBe(d.level);
      expect(e.meter).toBe(`${d.meter.beats}/${d.meter.beatType}`);
      expect([e.fifths, e.mode]).toEqual([d.keyConcert.fifths, d.keyConcert.mode]);
      expect(e.rangeConcert).toEqual([d.rangeConcert.min, d.rangeConcert.max]);
      expect([e.minBpm, e.maxBpm]).toEqual([d.tempo.minBpm, d.tempo.maxBpm]);
      expect([e.minIoiTicks, e.minRepeatIoiTicks]).toEqual([d.features.minIoiTicks, d.features.minRepeatIoiTicks]);
      expect(e.bars).toBe(d.measures.filter((m) => !m.isPickup).length);
      expect(e.pickup).toBe(d.pickupTicks > 0);
      expect(e.featureLevels).toEqual(d.featureLevels);
      expect([e.dedupeGroup, e.work, e.familiarity, e.cadenceEnd]).toEqual([d.dedupeGroup, d.work, d.familiarity, d.cadenceEnd]);
      expect([e.corpus, e.license, e.composer]).toEqual([d.source.corpus, d.source.license, d.source.composer]);
      expect(e.tags).toEqual(d.tags);
      expect(e.flags).toEqual(d.flags);
    }
  });

  it('stats.fit counts follow the 03 §7.3 closed form', () => {
    for (const inst of instruments) {
      const per: Record<string, Record<string, number>> = {};
      for (const e of entries) {
        if (fitsSomeKey(e, inst)) {
          const lv = (per[String(e.level)] ??= {});
          lv[e.meter] = (lv[e.meter] ?? 0) + 1;
        }
      }
      expect(manifest.stats.fit[inst.id] ?? {}, inst.id).toEqual(per);
    }
    expect(manifest.stats.servedLevels).toEqual([]); // no level reaches 30 excerpts in a 24-excerpt fixture
  });
});

/** Interval from its chromatic and diatonic size → number of perfect fifths (smallest magnitude). */
function intervalFifths(iv: Interval): number {
  for (let a = 0; a <= 12; a++)
    for (const f of a === 0 ? [0] : [-a, a]) if (mod(7 * f - iv.chromatic, 12) === 0 && mod(4 * f - iv.diatonic, 7) === 0) return f;
  throw new Error(`no fifths for ${JSON.stringify(iv)}`);
}

function fitsSomeKey(e: ManifestEntry, inst: Instrument): boolean {
  const lv = levels.levels[e.level - 1]!;
  const [bMin, bMax] = inst.tiers[lv.tier];
  const c = inst.writtenMinusSounding.chromatic;
  const tMin = bMin - c - e.rangeConcert[0];
  const tMax = bMax - c - e.rangeConcert[1];
  if (tMin > tMax || !lv.writtenKeys.modes.includes(e.mode)) return false;
  const fI = intervalFifths(inst.writtenMinusSounding);
  const k = lv.writtenKeys.maxAccidentals;
  for (let fw = -k; fw <= k; fw++) {
    const fc = fw - fI;
    if (Math.abs(fc) > 7) continue;
    const p = mod(tonicPc({ fifths: fc, mode: e.mode }) - tonicPc({ fifths: e.fifths, mode: e.mode }), 12);
    for (let t = p - 120; t <= tMax; t += 12) if (t >= tMin) return true;
  }
  return false;
}

// =====================================================================================================
// Golden expected notes: independent recomputation
// =====================================================================================================

const EXP = 'fixtures/expected/';
const expIndex = readJson<{ files: string[]; instruments: string[]; excerpts: string[] }>(`${EXP}index.json`);
const goldens = expIndex.files.map((f) => [f, readJson<ExpectedGolden>(`${EXP}${f}`)] as const);

function transpose(p: SpelledPitch, iv: Interval): SpelledPitch {
  const total = p.octave * 7 + STEPS.indexOf(p.step) + iv.diatonic;
  const step = STEPS[mod(total, 7)] as Step;
  const octave = Math.floor(total / 7);
  const alter = midi(p) + iv.chromatic - midi({ step, alter: 0, octave });
  if (Math.abs(alter) > 2) throw new Error('triple accidental');
  return { step, alter: alter as SpelledPitch['alter'], octave };
}

/** 03 §7.3 / §7.4 planning, as documented in tools/fixtures/expected.py. */
function plan(d: ExcerptDoc, inst: Instrument): { writtenKey: KeySig; transposition: Interval } | null {
  const lv = levels.levels[d.level - 1]!;
  const band = inst.tiers[lv.tier];
  const I = inst.writtenMinusSounding;
  const mode = d.keyConcert.mode;
  if (!lv.writtenKeys.modes.includes(mode)) return null;
  const fI = intervalFifths(I);
  const { min: lo, max: hi } = d.rangeConcert;
  let best: { key: number[]; fw: number; iv: Interval } | null = null;
  const less = (a: number[], b: number[]): boolean => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
    return false;
  };
  for (let fw = -lv.writtenKeys.maxAccidentals; fw <= lv.writtenKeys.maxAccidentals; fw++) {
    const fc = fw - fI;
    if (Math.abs(fc) > 7) continue;
    const p = mod(tonicPc({ fifths: fc, mode }) - tonicPc(d.keyConcert), 12);
    let shift: { key: number[]; t: number; margin: number } | null = null;
    for (let k = -10; k <= 10; k++) {
      const t = p + 12 * k;
      if (t < band[0] - I.chromatic - lo || t > band[1] - I.chromatic - hi) continue;
      const margin = Math.min(lo + I.chromatic + t - band[0], band[1] - (hi + I.chromatic + t));
      const key = [-margin, Math.abs(t), t];
      if (!shift || less(key, shift.key)) shift = { key, t, margin };
    }
    if (!shift) continue;
    const ls = STEPS.indexOf(tonic(d.keyConcert).step);
    const lc = STEPS.indexOf(tonic({ fifths: fc, mode }).step);
    const iv: Interval = { diatonic: mod(lc - ls, 7) + 7 * ((shift.t - mod(shift.t, 12)) / 12), chromatic: shift.t };
    let spellOk = true;
    for (const n of notesOf(d)) {
      try {
        const w = transpose(transpose(n.pitch, iv), I);
        if (Math.abs(w.alter) === 2 && d.level < 8) spellOk = false;
      } catch {
        spellOk = false;
      }
    }
    if (!spellOk) continue;
    const key = [-shift.margin, Math.abs(fw), fw];
    if (!best || less(key, best.key)) best = { key, fw, iv };
  }
  return best ? { writtenKey: { fifths: best.fw, mode }, transposition: best.iv } : null;
}

const STAFF_BOTTOM = { treble: 4 * 7 + 2, 'treble-8vb': 4 * 7 + 2, bass: 2 * 7 + 4, alto: 3 * 7 + 3, tenor: 3 * 7 + 1 } as const;
function ledgers(p: SpelledPitch, clef: keyof typeof STAFF_BOTTOM): number {
  const d = p.octave * 7 + STEPS.indexOf(p.step);
  const bottom = STAFF_BOTTOM[clef];
  if (d < bottom) return Math.floor((bottom - d) / 2);
  if (d > bottom + 8) return Math.floor((d - bottom - 8) / 2);
  return 0;
}

function bpmFor(d: ExcerptDoc): number {
  const lv = levels.levels[d.level - 1]!;
  let { minBpm: lo, maxBpm: hi } = lv.tempo;
  const compound = d.meter.beatType === 8 && d.meter.beats >= 6 && d.meter.beats % 3 === 0;
  if (compound && levels.compound.dottedBeatLevels.includes(d.level)) ({ minBpm: lo, maxBpm: hi } = levels.compound.dottedBpm);
  return d.tempo.minBpm >= lo && d.tempo.minBpm <= hi ? d.tempo.minBpm : lo;
}

function recompute(d: ExcerptDoc, inst: Instrument, iv: Interval, writtenKey: KeySig, bpm: number): ExpectedNote[] {
  const unit = d.meter.countUnitTicks;
  const bt = barTicks(d);
  const flat = d.measures.flatMap((m) => m.events.map((e) => ({ m, e })));
  type Chain = { ids: string[]; first: NoteEvt; m: (typeof flat)[number]['m']; dur: number; firstIdx: number; lastIdx: number; slurOpen: boolean };
  const chainsArr: Chain[] = [];
  let depth = 0;
  let cur: Chain | null = null;
  flat.forEach(({ m, e }, i) => {
    if (e.kind === 'rest') {
      cur = null;
      return;
    }
    const before = depth;
    if (e.slur === 'stop' || e.slur === 'continue') depth--;
    if (e.slur === 'start' || e.slur === 'continue') depth++;
    if (cur && e.tieStop) {
      cur.ids.push(e.id);
      cur.dur += e.dur;
      cur.lastIdx = i;
    } else {
      cur = { ids: [e.id], first: e, m, dur: e.dur, firstIdx: i, lastIdx: i, slurOpen: before > 0 };
      chainsArr.push(cur);
    }
    if (!e.tieStart) cur = null;
  });
  const out: ExpectedNote[] = chainsArr.map((c, n) => {
    const e = c.first;
    const barStart = c.m.isPickup ? c.m.startTick - (bt - d.pickupTicks) : c.m.startTick;
    const onsetBeat = (e.tick - d.pickupTicks) / unit;
    const durBeats = c.dur / unit;
    const concert = transpose(e.pitch, iv);
    const written = transpose(concert, inst.writtenMinusSounding);
    const prev = c.firstIdx > 0 ? flat[c.firstIdx - 1]!.e : null;
    const next = c.lastIdx + 1 < flat.length ? flat[c.lastIdx + 1]!.e : null;
    const precededByRest = prev?.kind === 'rest';
    const prevChain = chainsArr[n - 1];
    const cm = midi(concert);
    const onsetKind: ExpectedNote['onsetKind'] =
      prevChain && midi(transpose(prevChain.first.pitch, iv)) === cm && !precededByRest ? 'repeat' : c.slurOpen ? 'slurred' : 'articulated';
    const a = e.artic ?? [];
    const artic: ExpectedNote['artic'] = a.includes('staccato')
      ? 'staccato'
      : a.includes('accent') || a.includes('marcato')
        ? 'accent'
        : a.includes('tenuto')
          ? 'tenuto'
          : 'normal';
    const ks = keyAlter(writtenKey.fifths, written.step);
    return {
      idx: n,
      eventIds: c.ids,
      bar: d.pickupTicks ? c.m.index : c.m.index + 1,
      beatInBar: 1 + (e.tick - barStart) / unit,
      onsetBeat,
      durBeats,
      onsetSec: (onsetBeat * 60) / bpm,
      durSec: (durBeats * 60) / bpm,
      concertMidi: cm,
      writtenPitch: written,
      ioiPrevSec: null,
      ioiNextSec: null,
      precededByRest,
      followedByRest: next?.kind === 'rest',
      onsetKind,
      artic,
      durationGraded:
        durBeats >= grading.credit.duration.minBeats && artic !== 'staccato' && n !== chainsArr.length - 1 && inst.family !== 'keyboard' && inst.family !== 'guitar',
      keySigAltered: ks !== 0 && written.alter === ks,
      explicitAccidental: written.alter !== ks,
      ledgerLines: ledgers(written, 'treble'),
    };
  });
  for (let i = 1; i < out.length; i++) {
    const ioi = out[i]!.onsetSec - out[i - 1]!.onsetSec;
    out[i - 1]!.ioiNextSec = ioi;
    out[i]!.ioiPrevSec = ioi;
  }
  return out;
}

describe('fixtures/expected goldens (01 §14 item 8)', () => {
  it('cover 6 excerpts x flute, clarinet-bb, sax-alto, and every file is listed', () => {
    expect(expIndex.instruments).toEqual(['flute', 'clarinet-bb', 'sax-alto']);
    expect(expIndex.excerpts).toHaveLength(6);
    expect(goldens).toHaveLength(18);
    const onDisk = readdirSync(new URL(EXP, root)).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
    expect(onDisk).toEqual([...expIndex.files].sort());
    const chosen = docs.filter((d) => expIndex.excerpts.includes(d.id));
    expect(chosen.some((d) => d.pickupTicks > 0), 'a pickup').toBe(true);
    expect(chosen.some((d) => allEvents(d).some((e) => e.tuplet)), 'a triplet').toBe(true);
    expect(chosen.some((d) => d.keyConcert.mode === 'minor'), 'minor').toBe(true);
    expect(chosen.some((d) => d.meter.beatType === 8), 'compound').toBe(true);
    expect(chosen.some((d) => notesOf(d).some((n) => n.tieStart)), 'a tie').toBe(true);
  });

  it.each(goldens)('%s validates against expected-golden.schema.json', (_f, g) => {
    const v = validator('expected-golden');
    expect(v(g), JSON.stringify(v.errors)).toBe(true);
  });

  it.each(goldens)('%s equals an independent recomputation (empty diff)', (_f, g) => {
    const d = docs.find((x) => x.id === g.excerptId)!;
    const inst = instruments.find((i) => i.id === g.instrumentId)!;
    expect(g.level).toBe(d.level);
    const p = plan(d, inst);
    expect(p).not.toBeNull();
    expect(g.writtenKey).toEqual(p!.writtenKey);
    expect(g.transposition).toEqual(p!.transposition);
    expect(g.clef).toBe('treble');
    expect(g.bpm).toBe(bpmFor(d));
    expect(g.notes).toEqual(recompute(d, inst, g.transposition, g.writtenKey, g.bpm));
  });

  it.each(goldens)('%s: written notes sit in the tier band and the written key is allowed at the level', (_f, g) => {
    const d = docs.find((x) => x.id === g.excerptId)!;
    const inst = instruments.find((i) => i.id === g.instrumentId)!;
    const lv = levels.levels[d.level - 1]!;
    const [bMin, bMax] = inst.tiers[lv.tier];
    for (const n of g.notes) {
      const w = midi(n.writtenPitch);
      expect(w).toBeGreaterThanOrEqual(bMin);
      expect(w).toBeLessThanOrEqual(bMax);
      expect(w - n.concertMidi).toBe(inst.writtenMinusSounding.chromatic);
    }
    expect(Math.abs(g.writtenKey.fifths)).toBeLessThanOrEqual(lv.writtenKeys.maxAccidentals);
    // the concert key implied by the shift, carried by the instrument interval, is the written key
    expect(mod(tonicPc(d.keyConcert) + g.transposition.chromatic + inst.writtenMinusSounding.chromatic, 12)).toBe(tonicPc(g.writtenKey));
    // a tie chain is one note
    const chainCount = notesOf(d).filter((n) => !n.tieStop).length;
    expect(g.notes).toHaveLength(chainCount);
    expect(g.notes.flatMap((n) => n.eventIds)).toEqual(notesOf(d).map((n) => n.id));
  });
});
