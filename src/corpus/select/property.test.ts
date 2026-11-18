// 03 §11 item 6: transposition property test over 10,000 random (excerpt, instrument, written key, level) requests.
// Whenever the selector returns an excerpt: every written note is inside the band; the key signature equals the
// request, or its enharmonic only when the key was random; every interval between consecutive notes keeps its
// diatonic and chromatic size; no double accidental appears below L8.
//
// Corpus: the 24 fixture-corpus excerpts plus a synthetic set covering levels 1-10, every key in both modes, modal
// excerpts, chromatic lines and ranges from bass to treble (BUILD-NOTES: the fixture corpus has no L9-L10).
import { describe, expect, it } from 'vitest';
import type { ExcerptDoc, KeySig, ManifestEntry, Mode, NoteEvt, PracticeSettings, SelectionHistory, SpelledPitch } from '../../core/types.ts';
import { configs, corpusDocs, readJson } from '../../../fixtures/follow/gen/io.ts';
import { createRng } from '../../core/rng.ts';
import { enharmonicKey, isValidKey, toMidi, transposeKey } from '../../theory/index.ts';
import { prepareExcerpt } from '../transpose/prepare.ts';
import { MAX_DOUBLE_ACCIDENTALS } from '../transpose/spell.ts';
import { bandFor, keyAllowed, levelDef } from './levels.ts';
import { selectExcerptWith } from './select.ts';
import { selectAndPrepare } from './select-and-prepare.ts';
import { manifestOf, synthDoc, type SynthSpec } from './testing/synthetic.ts';

const cfg = configs();
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const pos = (p: SpelledPitch): number => p.octave * 7 + STEPS.indexOf(p.step);
const MODAL: Mode[] = ['dorian', 'mixolydian', 'phrygian', 'lydian', 'aeolian', 'locrian'];

function buildCorpus(): { entries: ManifestEntry[]; docs: Map<string, ExcerptDoc> } {
  const entries = [...readJson<ManifestEntry[]>('fixtures/corpus/manifest-entries.json')];
  const docs = new Map(corpusDocs().map((d) => [d.id, d]));
  const rng = createRng(2026);
  for (let i = 0; i < 300; i++) {
    const level = 1 + (i % 10);
    const def = levelDef(cfg, level);
    const mode: 'major' | 'minor' = level > 1 && rng.next() < 0.4 ? 'minor' : 'major';
    const meter = def.meters[rng.int(0, def.meters.length)]!;
    const spec: SynthSpec = {
      id: `syn-${i}`,
      level,
      key: { fifths: rng.int(-7, 8), mode },
      modal: level >= 5 && rng.next() < 0.15 ? MODAL[rng.int(0, level >= 6 ? 6 : 2)]! : null,
      meter,
      bars: def.bars[rng.int(0, def.bars.length)]!,
      low: rng.int(36, 80),
      span: rng.int(5, level <= 2 ? 13 : 25),
      chromaticRate: level <= 2 ? 0 : rng.next() * 0.3,
      eighths: level >= 2,
      familiarity: rng.next() < 0.05 ? 2 : 0,
      tempo: [rng.int(40, 100), rng.int(100, 200)],
    };
    if (i % 7 === 0) spec.stretchFeature = 'leaps';
    const { doc, entry } = synthDoc(spec, rng);
    docs.set(doc.id, doc);
    entries.push(entry);
  }
  return { entries, docs };
}

const { entries, docs } = buildCorpus();
const m = manifestOf(entries);
const instruments = cfg.instruments.instruments;

function randomRequest(rng: ReturnType<typeof createRng>, i: number): { s: PracticeSettings; h: SelectionHistory } {
  const inst = instruments[rng.int(0, instruments.length)]!;
  const level = rng.int(1, 11);
  const def = levelDef(cfg, level);
  let writtenKey: KeySig | 'random' = 'random';
  if (rng.next() < 0.5) {
    const max = def.writtenKeys.maxAccidentals;
    const modes = def.writtenKeys.modes;
    writtenKey = { fifths: rng.int(-max, max + 1), mode: modes[rng.int(0, modes.length)]! };
  }
  const meter = rng.next() < 0.8 ? 'random' : def.meters[rng.int(0, def.meters.length)]!;
  const seenGroups: Record<string, string> = {};
  for (let k = 0; k < 20; k++) seenGroups[entries[rng.int(0, entries.length)]!.dedupeGroup] = '2026-01-01T00:00:00Z';
  return {
    s: {
      instrumentId: inst.id,
      level,
      writtenKey,
      meter,
      bpm: 'random',
      bars: 'random',
      mode: rng.next() < 0.5 ? 'ranked' : 'practice',
      listening: true,
      metronome: 'audible',
      clickTimbre: 'tick',
      outputMode: 'speakers',
      a4Hz: 440,
      seed: i,
    },
    h: { seenGroups, recentExcerptIds: [], recentWorks: [], recentWrittenKeys: [], playerLevel: level },
  };
}

/** Asserts 03 §11 item 6 on one returned selection; returns the number of notes checked. */
function checkInvariants(s: PracticeSettings, result: Exclude<ReturnType<typeof selectExcerptWith>, { error: 'empty-pool' }>, doc: ExcerptDoc): number {
  const inst = cfg.instrumentById[s.instrumentId]!;
  const p = prepareExcerpt(doc, result, inst, cfg);
  const def = levelDef(cfg, result.levelServed);
  const band = bandFor(inst, def);
  // Key: exactly the request, or (random key only) an allowed key, the enharmonic of the drawn one on a retry.
  if (s.writtenKey !== 'random') {
    expect(p.writtenKey).toEqual(s.writtenKey);
    expect(result.enharmonicRetry).toBe(false);
  } else {
    expect(keyAllowed(def, p.writtenKey)).toBe(true);
    if (result.enharmonicRetry) expect(isValidKey(enharmonicKey(p.writtenKey))).toBe(true);
  }
  if (result.entry.modal !== null) expect(s.writtenKey).toBe('random');
  expect(p.writtenKey.mode).toBe(doc.keyConcert.mode);
  const src: NoteEvt[] = [];
  for (const ms of doc.measures) for (const e of ms.events) if (e.kind === 'note') src.push(e);
  const written = new Map<string, SpelledPitch>();
  const concert = new Map<string, SpelledPitch>();
  for (const ms of p.measures)
    for (const e of ms.events)
      if (e.kind === 'note') {
        written.set(e.id, e.writtenPitch);
        concert.set(e.id, e.concertPitch);
      }
  // The written spelling is the source moved by one interval whose key image is the written key.
  const first = src[0]!;
  const w0 = written.get(first.id)!;
  expect(transposeKey(doc.keyConcert, { diatonic: pos(w0) - pos(first.pitch), chromatic: toMidi(w0) - toMidi(first.pitch) })).toEqual(p.writtenKey);
  let doubles = 0;
  for (let i = 0; i < src.length; i++) {
    const w = written.get(src[i]!.id)!;
    const midi = toMidi(w);
    expect(midi).toBeGreaterThanOrEqual(band[0]);
    expect(midi).toBeLessThanOrEqual(band[1]);
    expect(toMidi(concert.get(src[i]!.id)!)).toBe(midi - inst.writtenMinusSounding.chromatic);
    if (Math.abs(w.alter) === 2) doubles++;
    if (i > 0) {
      const a = src[i - 1]!;
      const wa = written.get(a.id)!;
      expect(pos(w) - pos(wa)).toBe(pos(src[i]!.pitch) - pos(a.pitch));
      expect(midi - toMidi(wa)).toBe(toMidi(src[i]!.pitch) - toMidi(a.pitch));
    }
  }
  if (result.levelServed < 8) expect(doubles).toBe(0);
  expect(doubles).toBeLessThanOrEqual(MAX_DOUBLE_ACCIDENTALS);
  return src.length;
}

describe('03 §11 item 6 transposition property test', () => {
  it('10,000 random requests: band, key, intervals, accidentals', () => {
    const rng = createRng(11);
    let served = 0;
    let notes = 0;
    let randomKeyServed = 0;
    let explicitServed = 0;
    let retries = 0;
    const levels = new Set<number>();
    for (let i = 0; i < 10000; i++) {
      const { s, h } = randomRequest(rng, i);
      const r = selectExcerptWith(m, s, h, cfg, rng, { doc: (id) => docs.get(id) });
      if ('error' in r) continue;
      served++;
      levels.add(r.levelServed);
      if (s.writtenKey === 'random') randomKeyServed++;
      else explicitServed++;
      if (r.enharmonicRetry) retries++;
      notes += checkInvariants(s, r, docs.get(r.entry.id)!);
    }
    // The property is only meaningful if a large share of the requests is served.
    expect(served).toBeGreaterThan(3000);
    expect(randomKeyServed).toBeGreaterThan(1000);
    expect(explicitServed).toBeGreaterThan(1000);
    expect([...levels].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(notes).toBeGreaterThan(100000);
    expect(retries).toBeGreaterThan(0);
  }, 120_000);

  it('the production path (selectAndPrepare, docs loaded on demand) satisfies the same property', async () => {
    const rng = createRng(12);
    let served = 0;
    for (let i = 0; i < 1000; i++) {
      const { s, h } = randomRequest(rng, 20000 + i);
      const r = await selectAndPrepare(m, s, h, cfg, rng, (id) => Promise.resolve(docs.get(id)!));
      if ('error' in r) continue;
      served++;
      checkInvariants(s, r.selection, r.doc);
    }
    expect(served).toBeGreaterThan(300);
  }, 120_000);
});
