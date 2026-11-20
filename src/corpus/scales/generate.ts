/**
 * Scales (PLAN ruling 68): drill material generated from `config/scales.json`, never part of the excerpt pool and never
 * credited to a composer. A scale is written as a `PreparedExcerpt`, the type the practice pipeline takes (take plan,
 * follower, grader, notation, Listen), so nothing downstream needs to know it is a scale beyond the `scale` field.
 *
 * The notes are spelled by the theory module: each degree is the tonic moved by a diatonic step and its semitones in
 * the mode, so B-flat major reads B♭ C D E♭ F G A B♭ and the key signature is the tonic's own.
 */
import type {
  Configs,
  ExcerptSource,
  Instrument,
  Interval,
  KeySig,
  ManifestEntry,
  PreparedEvent,
  PreparedExcerpt,
  PreparedMeasure,
  ScaleDef,
  ScaleMode,
  ScaleRef,
  ScaleSet,
  ScalesConfig,
  SpelledPitch,
  Step,
} from '../../core/types.ts';
import { isValidKey, keyFromTonic, toMidi, transposeKey, transposePitch } from '../../theory/index.ts';
import { chooseClef, parseMeter } from '../select/levels.ts';

/** Semitones above the tonic of each scale step, per mode (natural minor for `minor`). */
const MODE_STEPS: Readonly<Record<ScaleMode, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

/** "Bb2" → B♭2, "F#3" → F♯3, "C3" → C3. Throws on anything else. */
export function parsePitchName(name: string): SpelledPitch {
  const m = /^([A-G])(bb|b|##|#)?(-?\d)$/.exec(name);
  if (!m) throw new RangeError(`not a pitch name: "${name}" (write it like C3, Bb2 or F#3)`);
  const acc = m[2] ?? '';
  const alter = acc === 'b' ? -1 : acc === 'bb' ? -2 : acc === '#' ? 1 : acc === '##' ? 2 : 0;
  return { step: m[1] as Step, alter: alter as SpelledPitch['alter'], octave: Number(m[3]) };
}

/** The interval from the tonic to a scale degree (1-based; 8 is the octave, 9 the ninth). */
export function degreeInterval(degree: number, mode: ScaleMode): Interval {
  if (!Number.isInteger(degree) || degree < 1) throw new RangeError(`scale degree must be a whole number from 1, got ${degree}`);
  const i = degree - 1;
  const octave = Math.floor(i / 7);
  return { diatonic: i, chromatic: (MODE_STEPS[mode][i % 7] as number) + 12 * octave };
}

/** The scale's key signature: the tonic's own major or minor key. */
export function scaleKey(ref: Pick<ScaleRef, 'tonic' | 'mode'>): KeySig {
  const k = keyFromTonic(ref.tonic, ref.mode);
  if (!isValidKey(k)) throw new RangeError(`no key signature for ${ref.tonic.step}${ref.tonic.alter} ${ref.mode}`);
  return k;
}

/** The written pitches of the scale, in order. */
export function scalePitches(ref: Pick<ScaleRef, 'tonic' | 'mode' | 'degrees'>): SpelledPitch[] {
  return ref.degrees.map((d) => transposePitch(ref.tonic, degreeInterval(d, ref.mode)));
}

/** The lowest and highest written MIDI note of the scale. */
export function scaleRange(ref: Pick<ScaleRef, 'tonic' | 'mode' | 'degrees'>): [number, number] {
  const midis = scalePitches(ref).map(toMidi);
  return [Math.min(...midis), Math.max(...midis)];
}

/** The stored reference for a scale of a set (everything the music is written from). */
export function scaleRefOf(config: ScalesConfig, def: ScaleDef): ScaleRef {
  const pattern = config.patterns.find((p) => p.id === def.pattern);
  if (!pattern) throw new RangeError(`scale ${def.id}: no pattern "${def.pattern}"`);
  return {
    id: def.id,
    pattern: pattern.id,
    degrees: [...pattern.degrees],
    tonic: parsePitchName(def.tonic),
    mode: def.mode,
    meter: config.rhythm.meter,
    noteBeats: config.rhythm.noteBeats,
    minLastBeats: config.rhythm.minLastBeats,
  };
}

/** The scale set of an instrument, or null when it has none (the Practice entry is hidden then). */
export function scaleSetFor(config: ScalesConfig | null | undefined, instrumentId: string): ScaleSet | null {
  return config?.sets.find((s) => s.instrumentId === instrumentId && s.scales.length > 0) ?? null;
}

/** The attempt's `excerptId` for a scale: never an id of the corpus (those have no colon). */
export const scaleExcerptId = (instrumentId: string, scaleId: string): string => `scale:${instrumentId}:${scaleId}`;

/** True for an `excerptId` that names a scale. */
export const isScaleExcerptId = (id: string): boolean => id.startsWith('scale:');

/** The scale after `scaleId` in its set, wrapping round to the first ("Next scale"). */
export function nextScaleId(set: ScaleSet, scaleId: string): string {
  const i = set.scales.findIndex((s) => s.id === scaleId);
  const next = set.scales[(i + 1) % set.scales.length] ?? set.scales[0];
  if (!next) throw new RangeError(`scale set ${set.instrumentId} is empty`);
  return next.id;
}

/** A note event's onset and length, ticks, and whether it ties into the next piece. */
interface Piece {
  note: number;
  tick: number;
  dur: number;
  tieStart: boolean;
  tieStop: boolean;
}

/**
 * The rhythm: every note `noteBeats` long, the last held to the end of its bar and for at least `minLastBeats`. A last
 * note that crosses a barline is written as tied notes, one per bar. Ticks are the meter's own.
 */
export function scaleRhythm(n: number, ref: Pick<ScaleRef, 'meter' | 'noteBeats' | 'minLastBeats'>): { pieces: Piece[]; barTicks: number; bars: number } {
  if (n < 1) throw new RangeError('a scale needs at least one note');
  const meter = parseMeter(ref.meter);
  const unit = meter.countUnitTicks;
  const barTicks = unit * meter.countsPerBar;
  const noteTicks = Math.round(ref.noteBeats * unit);
  if (!(noteTicks > 0) || barTicks % noteTicks !== 0) throw new RangeError(`notes of ${ref.noteBeats} beats do not fill a bar of ${ref.meter}`);
  const pieces: Piece[] = [];
  let t = 0;
  for (let k = 0; k < n - 1; k++) {
    pieces.push({ note: k, tick: t, dur: noteTicks, tieStart: false, tieStop: false });
    t += noteTicks;
  }
  // The last note: to the end of its bar, plus whole bars until it lasts at least `minLastBeats`.
  const minLast = Math.round(ref.minLastBeats * unit);
  let end = (Math.floor(t / barTicks) + 1) * barTicks;
  while (end - t < minLast) end += barTicks;
  let start = t;
  while (start < end) {
    const barEnd = (Math.floor(start / barTicks) + 1) * barTicks;
    const stop = Math.min(end, barEnd);
    pieces.push({ note: n - 1, tick: start, dur: stop - start, tieStart: stop < end, tieStop: start > t });
    start = stop;
  }
  return { pieces, barTicks, bars: end / barTicks };
}

const negate = (iv: Interval): Interval => ({ diatonic: -iv.diatonic || 0, chromatic: -iv.chromatic || 0 });

export interface ScaleMusicOptions {
  /** The difficulty the try is graded at (`ScalesConfig.level`). */
  level: number;
  bpm: number;
  /** The tempo range the player may choose (`ScalesConfig.tempo`). */
  tempo: { minBpm: number; maxBpm: number };
}

/**
 * The scale as the practice pipeline's `PreparedExcerpt`: written pitches as listed, concert pitches through the
 * instrument's transposition, measures of the meter, a selection with the tempo chosen. Its source is `generated`,
 * with no composer, so nothing credits it to anyone.
 */
export function scaleExcerpt(ref: ScaleRef, inst: Instrument, cfg: Configs, o: ScaleMusicOptions): PreparedExcerpt {
  if (!cfg.levelByNumber[o.level]) throw new RangeError(`no difficulty ${o.level}`);
  const written = scalePitches(ref);
  const writtenKey = scaleKey(ref);
  const toConcert = negate(inst.writtenMinusSounding);
  const concertKey = transposeKey(writtenKey, toConcert);
  const concert = written.map((p) => transposePitch(p, toConcert));
  const meter = parseMeter(ref.meter);
  const { pieces, barTicks, bars } = scaleRhythm(written.length, ref);

  const idOf = (p: Piece): string => (p.tieStop ? `n${p.note + 1}t${p.tick}` : `n${p.note + 1}`);
  const measures: PreparedMeasure[] = [];
  for (let b = 0; b < bars; b++) measures.push({ index: b, isPickup: false, startTick: b * barTicks, displayBar: b + 1, events: [] });
  for (const p of pieces) {
    const ev: PreparedEvent = {
      kind: 'note',
      id: idOf(p),
      tick: p.tick,
      dur: p.dur,
      concertPitch: concert[p.note] as SpelledPitch,
      writtenPitch: written[p.note] as SpelledPitch,
      ...(p.tieStart ? { tieStart: true as const } : {}),
      ...(p.tieStop ? { tieStop: true as const } : {}),
    };
    (measures[Math.floor(p.tick / barTicks)] as PreparedMeasure).events.push(ev);
  }

  const writtenMidi = written.map(toMidi);
  const concertMidi = concert.map(toMidi);
  const lo = Math.min(...writtenMidi);
  const hi = Math.max(...writtenMidi);
  const highId = `n${writtenMidi.indexOf(hi) + 1}`;
  const lowId = `n${writtenMidi.indexOf(lo) + 1}`;
  const clef = chooseClef(inst, o.level, [lo, hi]);
  const id = scaleExcerptId(inst.id, ref.id);
  const dedupeGroup = `scale:${ref.id}`;
  const bpmRange = { minBpm: o.tempo.minBpm, maxBpm: o.tempo.maxBpm };
  const source: ExcerptSource = {
    composer: '',
    composerDeath: null,
    work: ref.id,
    sourceMeasures: [1, bars],
    corpus: 'generated',
    upstreamRef: `config/scales.json#${inst.id}/${ref.id}`,
    sourceUrl: '',
    license: 'PD',
    licenseUrl: '',
  };
  const spelling: Record<string, number> = {};
  for (const p of pieces) {
    const c = concert[p.note] as SpelledPitch;
    const k = `${c.step}${c.alter}`;
    spelling[k] = (spelling[k] ?? 0) + 1;
  }
  const levels = { meter: o.level, rhythm: o.level, interval: o.level, leaps: o.level, span: o.level, mode: o.level, chromatic: o.level, double: o.level, density: o.level };
  const entry: ManifestEntry = {
    id,
    shard: 'generated',
    level: o.level,
    meter: ref.meter,
    fifths: concertKey.fifths,
    mode: ref.mode,
    modal: null,
    bars,
    pickup: false,
    rangeConcert: [Math.min(...concertMidi), Math.max(...concertMidi)],
    minBpm: bpmRange.minBpm,
    maxBpm: bpmRange.maxBpm,
    minIoiTicks: Math.min(...pieces.map((p) => p.dur)),
    minRepeatIoiTicks: null,
    composer: '',
    title: '',
    work: ref.id,
    tags: ['scale', ref.pattern],
    cadenceEnd: 'PAC',
    familiarity: 0,
    featureLevels: levels,
    flags: [],
    dedupeGroup,
    corpus: 'generated',
    license: 'PD',
    peakNotesPerBeat: 1,
    spelling,
  };
  const transposition: Interval = { diatonic: 0, chromatic: 0 };
  return {
    excerptId: id,
    instrumentId: inst.id,
    source,
    meter,
    pickupTicks: 0,
    writtenKey,
    concertKey,
    modal: null,
    clef,
    transposition,
    measures,
    rangeWritten: { min: lo, max: hi },
    modifications: [],
    barRhythmLevel: measures.map(() => o.level),
    extremes: { highId, lowId },
    dedupeGroup,
    levelServed: o.level,
    stretch: false,
    bpmRange,
    selection: {
      entry,
      settings: { instrumentId: inst.id, level: o.level, writtenKey, meter: ref.meter, bpm: o.bpm, bars: 8, randomized: [], seed: 0 },
      levelServed: o.level,
      stretch: false,
      fromLevelBelow: false,
      transposition,
      writtenKey,
      concertKey,
      clef,
      bpmRange,
      octaveDisplaced: false,
      enharmonicRetry: false,
    },
    scale: ref,
  };
}

/** The tempo to use: the one asked for, else the scale's default, clamped to the config's range and rounded. */
export function scaleBpm(config: ScalesConfig, def: ScaleDef, asked?: number): number {
  const want = asked !== undefined && Number.isFinite(asked) ? asked : def.bpm;
  return Math.round(Math.min(config.tempo.maxBpm, Math.max(config.tempo.minBpm, want)));
}

/** A scale of an instrument as a `PreparedExcerpt`, by id, at a tempo (the scale's default when absent). */
export function prepareScale(config: ScalesConfig, cfg: Configs, instrumentId: string, scaleId: string, bpm?: number): PreparedExcerpt {
  const set = scaleSetFor(config, instrumentId);
  const def = set?.scales.find((s) => s.id === scaleId);
  if (!set || !def) throw new RangeError(`no scale "${scaleId}" for ${instrumentId}`);
  const inst = cfg.instrumentById[instrumentId];
  if (!inst) throw new RangeError(`unknown instrument ${instrumentId}`);
  return scaleExcerpt(scaleRefOf(config, def), inst, cfg, { level: config.level, bpm: scaleBpm(config, def, bpm), tempo: config.tempo });
}
