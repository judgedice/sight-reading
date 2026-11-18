/**
 * Test-only synthetic corpus (BUILD-NOTES wave 1: levels 9-10 and empty-pool tests need synthetic manifests).
 * Lines are random walks written in C major / A minor with optional chromatic notes, then transposed with
 * `theory` to the requested source key, so their spelling is as a real score's would be. Each doc comes with the
 * manifest entry the corpus build would emit for it. These are not musical excerpts and never ship.
 */
import type {
  CorpusManifest,
  ExcerptDoc,
  ExcerptFlag,
  FeatureLevels,
  Familiarity,
  KeySig,
  ManifestEntry,
  Measure,
  Mode,
  NoteEvt,
  Rng,
  ScoreEvent,
  SpelledPitch,
  Step,
} from '../../../core/types.ts';
import { TPQ } from '../../../core/types.ts';
import { intervalBetweenKeys, toMidi, tonicOf, transposePitch } from '../../../theory/index.ts';
import { parseMeter } from '../levels.ts';

const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export interface SynthSpec {
  id: string;
  level: number;
  /** Feature that sits at level + 1 for a stretch excerpt. */
  stretchFeature?: keyof FeatureLevels;
  key: KeySig;
  modal?: Mode | null;
  meter?: string;
  bars?: number;
  /** Concert MIDI of the lowest scale step the walk may use; the walk spans at most `span` semitones above. */
  low: number;
  span: number;
  /** Probability that a note is chromatic (±1 from the scale). */
  chromaticRate?: number;
  /** Which way chromatic notes go (default both). */
  chromaticDirection?: 'up' | 'down' | 'both';
  /** Use eighth notes on some beats. */
  eighths?: boolean;
  flags?: ExcerptFlag[];
  familiarity?: Familiarity;
  dedupeGroup?: string;
  work?: string;
  tempo?: [number, number];
}

function featureLevels(level: number, stretch?: keyof FeatureLevels): FeatureLevels {
  const base = Math.max(1, level);
  const f: FeatureLevels = { meter: 1, rhythm: base, interval: 1, leaps: 1, span: 1, mode: 1, chromatic: 1, double: 1, density: 1 };
  if (stretch) f[stretch] = level + 1;
  return f;
}

/** Natural note at an absolute diatonic position in C major. */
function naturalAt(pos: number): SpelledPitch {
  return { step: STEPS[((pos % 7) + 7) % 7]!, alter: 0, octave: Math.floor(pos / 7) };
}

export function synthDoc(spec: SynthSpec, rng: Rng): { doc: ExcerptDoc; entry: ManifestEntry } {
  const meterStr = spec.meter ?? '4/4';
  const meter = parseMeter(meterStr);
  const bars = spec.bars ?? 8;
  const barTicks = (meter.beats * TPQ * 4) / meter.beatType;
  const homeKey: KeySig = { fifths: 0, mode: spec.key.mode };
  // Walk positions in C major / A minor, then move to the source key.
  const homeTonicPos = spec.key.mode === 'major' ? 4 * 7 : 3 * 7 + 5; // C4 or A3
  const pcShift = (((toMidi(tonicOf(spec.key)) - toMidi(tonicOf(homeKey))) % 12) + 12) % 12;
  const toKey = intervalBetweenKeys(homeKey, spec.key, pcShift);
  // Shift so the walk's lowest step lands near `low`.
  const lowHome = toMidi(naturalAt(homeTonicPos));
  const shiftOct = Math.round((spec.low - (lowHome + toKey.chromatic)) / 12);
  const iv = { diatonic: toKey.diatonic + 7 * shiftOct, chromatic: toKey.chromatic + 12 * shiftOct };
  const maxSteps = Math.max(1, Math.floor((spec.span * 7) / 12) - 1);

  const measures: Measure[] = [];
  let pos = Math.floor(maxSteps / 2);
  let id = 1;
  let prev: { tick: number; midi: number } | null = null;
  let minIoi = Infinity;
  let minRep: number | null = null;
  const onsets: number[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let b = 0; b < bars; b++) {
    const events: ScoreEvent[] = [];
    const start = b * barTicks;
    let tick = start;
    while (tick < start + barTicks) {
      const left = start + barTicks - tick;
      const dur = spec.eighths && left >= 2 * (TPQ / 2) && rng.next() < 0.3 ? TPQ / 2 : Math.min(TPQ, left);
      pos = Math.min(maxSteps, Math.max(0, pos + rng.int(-2, 3)));
      let p = naturalAt(homeTonicPos + pos);
      if (spec.chromaticRate && rng.next() < spec.chromaticRate) {
        // Raise or lower a natural note; avoid E#/Fb/B#/Cb in the home key so the source spelling stays ordinary.
        const dir = spec.chromaticDirection ?? 'both';
        const up = dir === 'both' ? rng.next() < 0.5 : dir === 'up';
        if (up && p.step !== 'E' && p.step !== 'B') p = { ...p, alter: 1 };
        else if (!up && p.step !== 'F' && p.step !== 'C') p = { ...p, alter: -1 };
      }
      const pitch = transposePitch(p, iv);
      const midi = toMidi(pitch);
      const ev: NoteEvt = { id: `e${id++}`, kind: 'note', tick, dur, pitch };
      events.push(ev);
      if (prev) {
        const ioi = tick - prev.tick;
        if (prev.midi === midi) minRep = minRep === null ? ioi : Math.min(minRep, ioi);
        else minIoi = Math.min(minIoi, ioi);
      }
      prev = { tick, midi };
      onsets.push(tick);
      lo = Math.min(lo, midi);
      hi = Math.max(hi, midi);
      tick += dur;
    }
    measures.push({ index: b, isPickup: false, startTick: start, events });
  }
  let peak = 0;
  for (let t = 0; t < bars * barTicks; t += meter.countUnitTicks / 2) {
    peak = Math.max(peak, onsets.filter((o) => o >= t && o < t + meter.countUnitTicks).length);
  }
  const fl = featureLevels(spec.level, spec.stretchFeature);
  const level = Math.max(...Object.values(fl));
  const [minBpm, maxBpm] = spec.tempo ?? [40, 200];
  const dedupeGroup = spec.dedupeGroup ?? `grp-${spec.id}`;
  const work = spec.work ?? `synth|${spec.id}`;
  const doc: ExcerptDoc = {
    schemaVersion: 1,
    id: spec.id,
    source: {
      composer: 'Synthetic',
      composerDeath: null,
      work,
      sourceMeasures: [1, bars],
      corpus: 'openscore-lieder',
      upstreamRef: 'synthetic@0:none',
      sourceUrl: 'https://example.invalid/',
      license: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    },
    meter,
    keyConcert: spec.key,
    modal: spec.modal ?? null,
    tempo: { minBpm, maxBpm },
    pickupTicks: 0,
    measures,
    rangeConcert: { min: lo, max: hi },
    features: {
      noteCount: onsets.length,
      notesPerBeat: onsets.length / (bars * meter.countsPerBar),
      peakNotesPerBeat: peak,
      shortestDur: spec.eighths ? TPQ / 2 : TPQ,
      maxLeapSemis: 4,
      tonicTriadLeapsOnly: true,
      leapsPer4BarsMax: 0,
      chromaticPer4BarsMax: 0,
      doubleAccidentals: 0,
      spanSemis: hi - lo,
      minIoiTicks: Number.isFinite(minIoi) ? minIoi : barTicks,
      minRepeatIoiTicks: minRep,
      syncopationIndex: 0,
      restRatio: 0,
      accidentalsOutsideKey: 0,
      minorAlterations: 0,
    },
    rhythmCells: ['Q'],
    featureLevels: fl,
    barRhythmLevel: measures.map(() => 1),
    extremes: { highId: 'e1', lowId: 'e1' },
    level,
    levelConfidence: Object.values(fl).filter((v) => v === level).length,
    cadenceEnd: 'PAC',
    phraseQuality: 'complete-phrase',
    breathMaxGapBars: 4,
    familiarity: spec.familiarity ?? 0,
    flags: spec.flags ?? [],
    tags: [],
    dedupeGroup,
    work,
    modifications: ['excerpted'],
    review: { rules: 'synthetic', llm: 'not-required', llmVerdicts: [], promptVersion: 'none' },
    contentHash: `sha256:${spec.id}`,
  };
  const entry: ManifestEntry = {
    id: spec.id,
    shard: `shard-L${String(level).padStart(2, '0')}-01`,
    level,
    meter: meterStr,
    fifths: spec.key.fifths,
    mode: spec.key.mode,
    modal: doc.modal,
    bars,
    pickup: false,
    rangeConcert: [lo, hi],
    minBpm,
    maxBpm,
    minIoiTicks: doc.features.minIoiTicks,
    minRepeatIoiTicks: minRep,
    composer: 'Synthetic',
    title: spec.id,
    work,
    tags: [],
    cadenceEnd: 'PAC',
    familiarity: doc.familiarity,
    featureLevels: fl,
    flags: doc.flags,
    dedupeGroup,
    corpus: 'openscore-lieder',
    license: 'CC0-1.0',
  };
  return { doc, entry };
}

export function manifestOf(entries: ManifestEntry[], withdrawn: string[] = [], servedLevels: number[] = []): CorpusManifest {
  return {
    corpusVersion: 'synthetic',
    entries,
    stats: { servedLevels, fit: {} },
    chunks: {},
    attributions: { file: 'attributions.json', hash: 'sha256:0', bytes: 0 },
    withdrawn,
  };
}
