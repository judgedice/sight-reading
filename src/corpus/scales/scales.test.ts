// Scales (PLAN ruling 68): the generator writes every scale in config/scales.json with the right pitches, spelling,
// key signature, range and rhythm, and as a prepared excerpt the practice pipeline takes unchanged.
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PreparedExcerpt, ScalesConfig, SpelledPitch } from '../../core/types.ts';
import { configs } from '../../../fixtures/follow/gen/io.ts';
import { toMidi } from '../../theory/index.ts';
import { buildExpectedNotes } from '../expected/index.ts';
import { planTake } from '../../session/take-plan.ts';
import scalesJson from '../../../config/scales.json';
import scalesSchema from '../../../schemas/scales.schema.json';
import {
  isScaleExcerptId,
  loadScales,
  nextScaleId,
  parsePitchName,
  prepareScale,
  scaleBpm,
  scaleExcerpt,
  scaleExcerptId,
  scaleProblems,
  scaleRefOf,
  scaleSetFor,
  ScalesConfigError,
} from './index.ts';

const cfg = configs();
const scales = loadScales(scalesJson, cfg);
const SIGN: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: '', 1: '#', 2: '##' };
const nameOf = (p: SpelledPitch): string => `${p.step}${SIGN[p.alter]}${p.octave}`;
const notesOf = (p: PreparedExcerpt) => p.measures.flatMap((m) => m.events).filter((e) => e.kind === 'note');
/** Written note names in order, a tied continuation not repeated. */
const written = (p: PreparedExcerpt): string[] => notesOf(p).filter((e) => e.kind === 'note' && !e.tieStop).map((e) => (e.kind === 'note' ? nameOf(e.writtenPitch) : ''));
const clone = (): ScalesConfig => JSON.parse(JSON.stringify(scalesJson)) as ScalesConfig;

/** The baritone's scales as a singer reads them, easy to harder. */
const BARITONE: Record<string, { notes: string; fifths: number; mode: 'major' | 'minor'; bars: number; range: [string, string] }> = {
  'five-note-c': { notes: 'C3 D3 E3 F3 G3 F3 E3 D3 C3', fifths: 0, mode: 'major', bars: 3, range: ['C3', 'G3'] },
  'five-note-d': { notes: 'D3 E3 F#3 G3 A3 G3 F#3 E3 D3', fifths: 2, mode: 'major', bars: 3, range: ['D3', 'A3'] },
  'five-note-bb': { notes: 'Bb2 C3 D3 Eb3 F3 Eb3 D3 C3 Bb2', fifths: -2, mode: 'major', bars: 3, range: ['Bb2', 'F3'] },
  'octave-c': { notes: 'C3 D3 E3 F3 G3 A3 B3 C4 B3 A3 G3 F3 E3 D3 C3', fifths: 0, mode: 'major', bars: 4, range: ['C3', 'C4'] },
  'octave-bb': { notes: 'Bb2 C3 D3 Eb3 F3 G3 A3 Bb3 A3 G3 F3 Eb3 D3 C3 Bb2', fifths: -2, mode: 'major', bars: 4, range: ['Bb2', 'Bb3'] },
  'arpeggio-c': { notes: 'C3 E3 G3 C4 G3 E3 C3', fifths: 0, mode: 'major', bars: 2, range: ['C3', 'C4'] },
  'octave-a-minor': { notes: 'A2 B2 C3 D3 E3 F3 G3 A3 G3 F3 E3 D3 C3 B2 A2', fifths: 0, mode: 'minor', bars: 4, range: ['A2', 'A3'] },
};

describe('config/scales.json', () => {
  it('validates against schemas/scales.schema.json (Ajv strict) and loads', () => {
    const ajv = new Ajv({ strict: true, allowUnionTypes: true, allErrors: true });
    const validate = ajv.compile(scalesSchema);
    expect(validate(JSON.parse(readFileSync(new URL('../../../config/scales.json', import.meta.url), 'utf8'))), JSON.stringify(validate.errors)).toBe(true);
    expect(Object.isFrozen(scales)).toBe(true);
    expect(scaleProblems(scales, cfg)).toEqual([]);
  });

  it('offers scales for the baritone only, in the order easy to harder', () => {
    expect(scales.sets.map((s) => s.instrumentId)).toEqual(['voice-baritone']);
    expect(scaleSetFor(scales, 'voice-baritone')?.scales.map((s) => s.id)).toEqual(Object.keys(BARITONE));
    expect(scaleSetFor(scales, 'flute')).toBeNull();
    expect(scaleSetFor(scales, 'voice-tenor')).toBeNull();
    expect(scaleSetFor(null, 'voice-baritone')).toBeNull();
  });

  it('is graded at difficulty 1, in 4/4, with default tempos from 60 to 72', () => {
    expect(scales.level).toBe(1);
    expect(scales.rhythm.meter).toBe('4/4');
    for (const s of scaleSetFor(scales, 'voice-baritone')!.scales) {
      expect(s.bpm).toBeGreaterThanOrEqual(60);
      expect(s.bpm).toBeLessThanOrEqual(72);
    }
  });
});

describe('every baritone scale', () => {
  const set = scaleSetFor(scales, 'voice-baritone')!;
  const inst = cfg.instrumentById['voice-baritone']!;
  const span = set.span.map((n) => toMidi(parsePitchName(n))) as [number, number];

  it.each(Object.entries(BARITONE))('%s: pitches, spelling, key signature, range, rhythm', (id, want) => {
    const p = prepareScale(scales, cfg, 'voice-baritone', id);
    // Pitches and spelling, through the key's own letters (B-flat major has E-flat, never D-sharp).
    expect(written(p).join(' ')).toBe(want.notes);
    expect(p.writtenKey).toEqual({ fifths: want.fifths, mode: want.mode });
    expect(p.concertKey).toEqual(p.writtenKey);
    for (const e of notesOf(p)) if (e.kind === 'note') expect(e.concertPitch).toEqual(e.writtenPitch);
    // No note needs an accidental against its key signature.
    for (const e of notesOf(p)) {
      if (e.kind !== 'note') continue;
      const sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
      const inKey = want.fifths > 0 ? (sharps.indexOf(e.writtenPitch.step) < want.fifths ? 1 : 0) : want.fifths < 0 ? ([...sharps].reverse().indexOf(e.writtenPitch.step) < -want.fifths ? -1 : 0) : 0;
      expect(e.writtenPitch.alter, `${id} ${nameOf(e.writtenPitch)}`).toBe(inKey);
    }
    // Range: inside the set's span (A2 to D4), the full range (G2 to G4), and reported as written.
    expect([p.rangeWritten.min, p.rangeWritten.max]).toEqual(want.range.map((n) => toMidi(parsePitchName(n))));
    expect(p.rangeWritten.min).toBeGreaterThanOrEqual(span[0]);
    expect(p.rangeWritten.max).toBeLessThanOrEqual(span[1]);
    expect(p.rangeWritten.min).toBeGreaterThanOrEqual(inst.fullWrittenRange[0]);
    expect(p.rangeWritten.max).toBeLessThanOrEqual(inst.fullWrittenRange[1]);
    // Bass clef, difficulty 1, 4/4, bars filled exactly.
    expect(p.clef).toBe('bass');
    expect(p.levelServed).toBe(1);
    expect(p.meter).toMatchObject({ beats: 4, beatType: 4, countsPerBar: 4 });
    expect(p.measures).toHaveLength(want.bars);
    const bar = p.meter.countUnitTicks * p.meter.countsPerBar;
    for (const m of p.measures) {
      expect(m.events.reduce((t, e) => t + e.dur, 0)).toBe(bar);
      expect(m.startTick).toBe(m.index * bar);
    }
    // Quarter notes, the last note held to the end of the last bar for at least two beats.
    const expected = buildExpectedNotes(p, p.selection.settings.bpm, cfg);
    expect(expected).toHaveLength(want.notes.split(' ').length);
    for (const e of expected.slice(0, -1)) expect(e.durBeats).toBe(1);
    const last = expected.at(-1)!;
    expect(last.durBeats).toBeGreaterThanOrEqual(2);
    expect(last.onsetBeat + last.durBeats).toBe(want.bars * 4);
    // The source is generated: no composer, nothing credited to anyone.
    expect(p.source).toMatchObject({ composer: '', corpus: 'generated', license: 'PD' });
    expect(p.scale).toMatchObject({ id, mode: want.mode });
    expect(p.excerptId).toBe(scaleExcerptId('voice-baritone', id));
    expect(isScaleExcerptId(p.excerptId)).toBe(true);
  });

  it('every scale goes through the take plan: count-in of one bar at difficulty 1 (PLAN R70), tolerances for every note', () => {
    for (const id of Object.keys(BARITONE)) {
      const p = prepareScale(scales, cfg, 'voice-baritone', id);
      const plan = planTake(p, cfg);
      expect(plan.inst.id).toBe('voice-baritone');
      expect(plan.countInBeats).toBe(4);
      expect(plan.tolerances).toHaveLength(plan.expected.length);
      expect(plan.bpm).toBe(p.selection.settings.bpm);
    }
  });
});

describe('tempo', () => {
  const set = scaleSetFor(scales, 'voice-baritone')!;
  const def = set.scales[0]!;
  it('uses the scale default, or the tempo asked for inside the range', () => {
    expect(prepareScale(scales, cfg, 'voice-baritone', def.id).selection.settings.bpm).toBe(def.bpm);
    expect(prepareScale(scales, cfg, 'voice-baritone', def.id, 80).selection.settings.bpm).toBe(80);
    expect(scaleBpm(scales, def, 10)).toBe(scales.tempo.minBpm);
    expect(scaleBpm(scales, def, 400)).toBe(scales.tempo.maxBpm);
    expect(scaleBpm(scales, def, 63.6)).toBe(64);
  });
});

describe('the generator beyond the shipped scales', () => {
  it('ties a last note across the barline when its bar has less than the minimum left', () => {
    const c = clone();
    c.patterns.push({ id: 'four', degrees: [1, 2, 3, 1] });
    const ref = scaleRefOf(c, { id: 'x', pattern: 'four', tonic: 'C3', mode: 'major', bpm: 60 });
    const p = scaleExcerpt(ref, cfg.instrumentById['voice-baritone']!, cfg, { level: 1, bpm: 60, tempo: c.tempo });
    expect(p.measures).toHaveLength(2);
    const last = p.measures.flatMap((m) => m.events).slice(-2);
    expect(last.map((e) => [e.dur, e.kind === 'note' && e.tieStart === true, e.kind === 'note' && e.tieStop === true])).toEqual([
      [480, true, false],
      [1920, false, true],
    ]);
    const expected = buildExpectedNotes(p, 60, cfg);
    expect(expected).toHaveLength(4);
    expect(expected.at(-1)).toMatchObject({ durBeats: 5, eventIds: [last[0]!.id, last[1]!.id] });
  });

  it('writes a transposing voice at its written pitch and sounds it an octave down (tenor)', () => {
    const c = clone();
    c.sets.push({ _source: 'test', instrumentId: 'voice-tenor', span: ['C4', 'G5'], scales: [{ id: 'five-note-f', pattern: 'five-note', tonic: 'F4', mode: 'major', bpm: 66 }] });
    expect(scaleProblems(c, cfg)).toEqual([]);
    const p = prepareScale(c, cfg, 'voice-tenor', 'five-note-f');
    expect(written(p).join(' ')).toBe('F4 G4 A4 Bb4 C5 Bb4 A4 G4 F4');
    expect(p.clef).toBe('treble-8vb');
    const first = notesOf(p)[0]!;
    expect(first.kind === 'note' && toMidi(first.writtenPitch) - toMidi(first.concertPitch)).toBe(12);
  });

  it('spells a B-flat clarinet scale in its written key, concert a tone lower', () => {
    const c = clone();
    c.sets.push({ _source: 'test', instrumentId: 'clarinet-bb', span: ['G3', 'C6'], scales: [{ id: 'octave-g', pattern: 'octave', tonic: 'G4', mode: 'major', bpm: 66 }] });
    expect(cfg.instrumentById['clarinet-bb']).toBeDefined();
    const p = prepareScale(c, cfg, 'clarinet-bb', 'octave-g');
    expect(p.writtenKey).toEqual({ fifths: 1, mode: 'major' });
    expect(p.concertKey).toEqual({ fifths: -1, mode: 'major' });
    expect(written(p)).toContain('F#5');
  });

  it('refuses scales that leave the span, unknown patterns and instruments, and bad names', () => {
    const c = clone();
    c.sets[0]!.scales.push({ id: 'octave-g', pattern: 'octave', tonic: 'G3', mode: 'major', bpm: 66 });
    c.sets[0]!.scales.push({ id: 'nope', pattern: 'nope', tonic: 'C3', mode: 'major', bpm: 66 });
    c.sets[0]!.scales.push({ id: 'bad', pattern: 'five-note', tonic: 'H3', mode: 'major', bpm: 66 });
    c.sets[0]!.scales.push({ id: 'five-note-c', pattern: 'five-note', tonic: 'C3', mode: 'major', bpm: 30 });
    c.sets.push({ _source: 'test', instrumentId: 'kazoo', span: ['C3', 'C4'], scales: [] });
    const problems = scaleProblems(c, cfg).join('\n');
    expect(problems).toMatch(/octave-g: notes 55-67 leave the span/);
    expect(problems).toMatch(/nope: unknown pattern/);
    expect(problems).toMatch(/bad: .*not a pitch name/);
    expect(problems).toMatch(/five-note-c: duplicate id/);
    expect(problems).toMatch(/five-note-c: bpm 30/);
    expect(problems).toMatch(/kazoo: unknown instrument/);
    expect(() => loadScales(c, cfg)).toThrow(ScalesConfigError);
  });

  it('refuses a span outside the full range and a document that fails the schema', () => {
    const c = clone();
    c.sets[0]!.span = ['E2', 'D4'];
    expect(scaleProblems(c, cfg).join('\n')).toMatch(/span E2-D4 is outside the full range/);
    expect(() => loadScales({ ...clone(), extra: 1 }, cfg)).toThrow(/unknown property/);
  });

  it('next scale goes down the list and wraps round', () => {
    const set = scaleSetFor(scales, 'voice-baritone')!;
    const ids = set.scales.map((s) => s.id);
    expect(nextScaleId(set, ids[0]!)).toBe(ids[1]);
    expect(nextScaleId(set, ids.at(-1)!)).toBe(ids[0]);
  });

  it('parses pitch names with flats and sharps', () => {
    expect(parsePitchName('Bb2')).toEqual({ step: 'B', alter: -1, octave: 2 });
    expect(parsePitchName('F#3')).toEqual({ step: 'F', alter: 1, octave: 3 });
    expect(() => parsePitchName('b2')).toThrow(RangeError);
  });
});
