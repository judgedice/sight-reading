// S1 composition helpers: the slice take, the configs it builds, and the attempt record (schema-valid, and identical
// after a round trip through the IndexedDB repositories on fake-indexeddb).
import 'fake-indexeddb/auto';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import type { AudioEnv, ClockSeconds } from '../../core/types.ts';
import attemptSchema from '../../../schemas/attempt-record.schema.json';
import { alignFinal } from '../../follow/index.ts';
import { openStore } from '../../platform/web/store/index.ts';
import { SLICE, analysisRateFor, sliceAttemptRecord, sliceConfigs, sliceDspConfig, sliceFollowConfig, sliceGrade, sliceGradeInput, sliceTake } from './slice-take.ts';

const cfg = sliceConfigs();
const take = sliceTake(cfg);

describe('sliceTake', () => {
  it('is the S1 excerpt: flute, concert pitch, treble clef, 512 window, 8 bars 4/4, one sharp, 80 bpm, 1-bar count-in', () => {
    expect(take.doc.id).toBe(SLICE.excerptId);
    expect(take.inst.id).toBe('flute');
    expect(take.inst.detection.windowSamples).toBe(512);
    expect(take.prepared.clef).toBe('treble');
    expect(take.prepared.transposition).toEqual({ diatonic: 0, chromatic: 0 });
    expect(take.writtenKey.fifths).toBe(1);
    expect(take.prepared.measures.filter((m) => !m.isPickup)).toHaveLength(8);
    expect(take.prepared.meter).toMatchObject({ beats: 4, beatType: 4 });
    expect(take.bpm).toBe(80);
    expect(take.countInBeats).toBe(4);
    expect(take.expected).toHaveLength(take.tolerances.length);
    // R14: one beat after the last note's written end.
    const last = take.expected[take.expected.length - 1]!;
    expect(take.totalBeats).toBe(last.onsetBeat + last.durBeats + 1);
    expect(take.endSec).toBeCloseTo((take.totalBeats * 60) / take.bpm, 9);
  });

  it('exact analysis rates of the worklet', () => {
    expect(analysisRateFor(48000)).toBe(16000);
    expect(analysisRateFor(44100)).toBe(14700);
    expect(analysisRateFor(16000)).toBe(16000);
    expect(analysisRateFor(96000)).toBe(16000);
  });

  it('click arrivals are t + RTL on speakers and absent in headphone modes', () => {
    const clicks = [{ beatIndex: 0, accent: true, t: 2 as ClockSeconds, countIn: true }];
    expect(sliceDspConfig(take, cfg, { analysisRate: 16000, outputMode: 'speakers', clicks, rtlSec: 0.05 }).clicks).toEqual([{ arrival: 2.05, accent: true }]);
    expect(sliceDspConfig(take, cfg, { analysisRate: 16000, outputMode: 'wired', clicks, rtlSec: 0.05 }).clicks).toEqual([]);
    const f = sliceFollowConfig(take, cfg, { t0: 5 as ClockSeconds, rtlSec: 0.05, analysisRate: 14700 });
    expect(f).toMatchObject({ t0: 5, latencyCompensationSec: 0.05, analysisRate: 14700, bpm: 80, beatsPerBar: 4 });
  });

  it('grades as practice without a measured calibration', () => {
    const alignment = alignFinal(sliceFollowConfig(take, cfg, { t0: 0 as ClockSeconds, rtlSec: 0, analysisRate: 16000 }), [], null);
    const input = sliceGradeInput(take, cfg, { alignment, detected: [], signal: { medianClarity: null, clippingFrac: 0 }, calibrationMeasured: false });
    expect(input.ranking.mode).toBe('practice');
    expect(input.ranking.gateFailures).toEqual(['calibration-unmeasured']);
    expect(input.tuning).toEqual({ used: false, offsetCents: 0 });
    const score = sliceGrade(take, cfg, { alignment, detected: [], signal: { medianClarity: null, clippingFrac: 0 }, calibrationMeasured: false });
    expect(score.ranked).toBe(false);
    expect(score.grade).toBe('F');
  });
});

describe('sliceAttemptRecord', () => {
  it('is schema-valid and survives the IndexedDB round trip unchanged', async () => {
    const alignment = alignFinal(sliceFollowConfig(take, cfg, { t0: 0 as ClockSeconds, rtlSec: 0, analysisRate: 16000 }), [], null);
    const score = sliceGrade(take, cfg, { alignment, detected: [], signal: { medianClarity: null, clippingFrac: 0 }, calibrationMeasured: false });
    const audioEnv: AudioEnv = {
      platform: 'web', osFamily: 'linux', displayMode: 'browser', appBuild: 'dev-slice', coreVersion: 'dev', inputPath: 'mic', metronomeMode: 'audible',
      clickTimbre: 'tick', outputMode: 'wired', route: { inputKind: 'unknown', sampleRate: 44100, appliedProcessing: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
      contextSampleRate: 44100, contextRecreated: false, clockRateError: null, audioSessionType: null, latencyCompensationMs: 0, calibrationMethod: 'none',
      captureRelay: false, droppedBlocks: 0, maxQueueMs: 0, dspHopP95Ms: 0.3, gateFailures: ['calibration-unmeasured'],
    };
    const record = sliceAttemptRecord(take, cfg, {
      id: 'slice-test-1', createdAt: '2026-11-18T12:00:00.000Z', score, alignment, detected: [], signal: { medianClarity: null, clippingFrac: 0 },
      calibrationMeasured: false, live: [], rtlSec: 0, outputMode: 'wired', audioEnv,
    });
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(attemptSchema);
    expect(validate(record), JSON.stringify(validate.errors)).toBe(true);

    const store = await openStore('slice-test-db');
    try {
      await store.repos.attempts.add(record);
      const back = await store.repos.attempts.byId(record.id);
      expect(back).toEqual(record);
    } finally {
      store.close();
    }
  });
});
