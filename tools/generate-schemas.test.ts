// Contract tests for the generated JSON Schemas (01 §3, §14 item 6; P0b acceptance):
// generation is deterministic, the committed schemas match src/core/types.ts, and the schemas
// accept and reject the documents they should.
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AudioEnv, ExcerptDoc, RenderStreamLine } from '../src/core/types.ts';
import { checkSchemas, generateSchemas, SCHEMA_DIR, SCHEMA_TARGETS } from './generate-schemas.ts';

let first: Record<string, string>;

beforeAll(() => {
  first = generateSchemas();
}, 60_000);

const load = (name: string): object => JSON.parse(readFileSync(join(SCHEMA_DIR, `${name}.schema.json`), 'utf8')) as object;

function validator(name: string) {
  const ajv = new Ajv({ strict: true, allowUnionTypes: true, allErrors: true });
  return ajv.compile(load(name));
}

const excerpt = (): ExcerptDoc => ({
  schemaVersion: 1,
  id: 'schubert-d257-voice-m1-8-aug2',
  source: {
    composer: 'Franz Schubert',
    composerDates: '1797–1828',
    composerDeath: 1828,
    work: 'Heidenröslein',
    catalog: 'D 257',
    partName: 'Voice',
    sourceMeasures: [1, 4],
    corpus: 'openscore-lieder',
    upstreamRef: 'OpenScore/Lieder@38c5db51:scores/x.mxl',
    sourceUrl: 'https://github.com/OpenScore/Lieder',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  meter: { beats: 2, beatType: 4, countUnitTicks: 480, countsPerBar: 2 },
  keyConcert: { fifths: 1, mode: 'major' },
  modal: null,
  tempo: { minBpm: 60, maxBpm: 84, marking: 'Lieblich' },
  pickupTicks: 0,
  measures: [
    {
      index: 0,
      isPickup: false,
      startTick: 0,
      events: [
        { id: 'e1', kind: 'note', tick: 0, dur: 480, pitch: { step: 'D', alter: 0, octave: 5 }, slur: 'start' },
        { id: 'e2', kind: 'note', tick: 480, dur: 480, pitch: { step: 'D', alter: 0, octave: 5 }, slur: 'stop' },
      ],
    },
  ],
  rangeConcert: { min: 62, max: 74 },
  features: {
    noteCount: 22,
    notesPerBeat: 0.9,
    peakNotesPerBeat: 2,
    shortestDur: 480,
    maxLeapSemis: 5,
    tonicTriadLeapsOnly: true,
    leapsPer4BarsMax: 2,
    chromaticPer4BarsMax: 0,
    doubleAccidentals: 0,
    spanSemis: 12,
    minIoiTicks: 480,
    minRepeatIoiTicks: null,
    syncopationIndex: 0,
    restRatio: 0.05,
    accidentalsOutsideKey: 0,
    minorAlterations: 0,
  },
  rhythmCells: ['Q', 'H'],
  featureLevels: { meter: 1, rhythm: 1, interval: 1, leaps: 1, span: 1, mode: 1, chromatic: 1, double: 1, density: 1 },
  barRhythmLevel: [1, 1, 1, 1, 1, 1, 1, 1],
  extremes: { highId: 'e9', lowId: 'e14' },
  level: 1,
  levelConfidence: 9,
  cadenceEnd: 'PAC',
  phraseQuality: 'complete-phrase',
  breathMaxGapBars: 4,
  familiarity: 2,
  flags: [],
  tags: ['lied'],
  dedupeGroup: 'fp-7c1e9a40',
  work: 'schubert|d257',
  modifications: ['excerpted', 'lyrics-removed', 'rhythm-augmented-x2'],
  quality: { soft: 0.8, interest: 0.46 },
  review: {
    rules: 'rules-1.0.0',
    llm: 'accepted',
    promptVersion: 'rubric-v1',
    llmVerdicts: [
      { pass: 1, verdict: 'accept', reasons: [] },
      { pass: 2, verdict: 'accept', reasons: [] },
    ],
  },
  contentHash: 'sha256:00',
});

describe('schema generation', () => {
  it('covers every target', () => {
    expect(Object.keys(first).sort()).toEqual(Object.keys(SCHEMA_TARGETS).map((n) => `${n}.schema.json`).sort());
  });

  it('is deterministic: two runs are byte-identical', () => {
    const second = generateSchemas();
    expect(second).toEqual(first);
  }, 60_000);

  it('committed schemas match src/core/types.ts (drift check)', () => {
    expect(checkSchemas(first)).toEqual([]);
  });

  it('the drift check reports a changed, missing or stale schema', () => {
    const [file] = Object.keys(first);
    if (!file) throw new Error('no schemas');
    const changed = { ...first, [file]: `${first[file]} ` };
    expect(checkSchemas(changed)).toContain(`drift: schemas/${file} differs from src/core/types.ts`);
    const extra = { ...first, 'not-committed.schema.json': '{}\n' };
    expect(checkSchemas(extra)).toContain('missing: schemas/not-committed.schema.json');
    const fewer = { ...first };
    delete fewer[file];
    expect(checkSchemas(fewer)).toContain(`stale: schemas/${file} has no target in tools/generate-schemas.ts`);
  });

  it('every schema compiles under Ajv strict mode', () => {
    for (const name of Object.keys(SCHEMA_TARGETS)) {
      expect(() => validator(name), name).not.toThrow();
    }
  });
});

describe('excerpt schema (01 §6.1 with 03 §8.2)', () => {
  const validate = () => validator('excerpt');

  it('accepts 03 §8.1 example document', () => {
    const v = validate();
    expect(v(excerpt()), JSON.stringify(v.errors)).toBe(true);
  });

  it('rejects the removed fields (attribution, idiomLocked) and lyrics', () => {
    const v = validate();
    const withAttribution = excerpt() as unknown as { source: Record<string, unknown> };
    withAttribution.source.attribution = 'x';
    expect(v(withAttribution)).toBe(false);
    expect(v({ ...excerpt(), idiomLocked: false })).toBe(false);
    const withLyric = excerpt() as unknown as { measures: { events: Record<string, unknown>[] }[] };
    const ev = withLyric.measures[0]?.events[0];
    if (!ev) throw new Error('fixture');
    ev.lyric = 'Sah';
    expect(v(withLyric)).toBe(false);
  });

  it('rejects CC BY-SA and a missing density feature level (R8, 03 §6.8)', () => {
    const v = validate();
    const sa = excerpt() as unknown as { source: { license: string } };
    sa.source.license = 'CC-BY-SA-4.0';
    expect(v(sa)).toBe(false);
    const noDensity = excerpt() as unknown as { featureLevels: Record<string, number> };
    delete noDensity.featureLevels.density;
    expect(v(noDensity)).toBe(false);
  });
});

describe('audio-env and ranked reasons (05 §5.2, R30)', () => {
  const env = (): AudioEnv => ({
    platform: 'web',
    osFamily: 'ios',
    displayMode: 'browser',
    appBuild: '0.0.0',
    coreVersion: '0.0.0',
    inputPath: 'mic',
    metronomeMode: 'audible',
    clickTimbre: 'tick',
    outputMode: 'speakers',
    route: {
      inputKind: 'built-in',
      sampleRate: 48000,
      appliedProcessing: { echoCancellation: false, noiseSuppression: false, autoGainControl: null },
    },
    contextSampleRate: 48000,
    contextRecreated: false,
    clockRateError: null,
    audioSessionType: 'play-and-record',
    latencyCompensationMs: 62,
    calibrationMethod: 'loopback',
    captureRelay: false,
    droppedBlocks: 0,
    maxQueueMs: 11,
    dspHopP95Ms: null,
    gateFailures: ['rtl-high'],
  });

  it('accepts a complete AudioEnv and rejects an unknown gate id', () => {
    const v = validator('audio-env');
    expect(v(env()), JSON.stringify(v.errors)).toBe(true);
    expect(v({ ...env(), gateFailures: ['bluetooth-latency'] })).toBe(false);
  });

  it("ranked reasons are 02's enum", () => {
    const schema = load('attempt-record') as { definitions: Record<string, { enum?: string[] }> };
    expect(schema.definitions.RankedReason?.enum?.slice().sort()).toEqual(
      [
        'practice-mode',
        'seen-before',
        'scan-extended',
        'tempo-below-90pct',
        'visual-metronome',
        'calibration',
        'measurement',
        'familiar',
        'skip-limit',
      ].sort(),
    );
  });
});

describe('render stream line (01 §14 item 11)', () => {
  it('accepts a header and an event line', () => {
    const v = validator('render-stream-line');
    const header: RenderStreamLine = {
      kind: 'header',
      schemaVersion: 1,
      excerptId: 'fx-01',
      instrumentId: 'flute',
      writtenKey: { fifths: 1, mode: 'major' },
      bpm: 80,
      level: 2,
      description: 'on time',
    };
    const event: RenderStreamLine = { kind: 'event', atMs: 750, event: { type: 'missed', expectedIdx: 3 } };
    expect(v(header), JSON.stringify(v.errors)).toBe(true);
    expect(v(event), JSON.stringify(v.errors)).toBe(true);
    expect(v({ kind: 'event', atMs: 1, event: { type: 'missed' } })).toBe(false);
  });
});
