// IOS3 acceptance (05 §4, W5, W6, W8): every GateId at its config threshold, ranked-reason mapping, AudioEnv round trip.
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { configs } from '../../../fixtures/follow/gen/io.ts';
import audioEnvSchema from '../../../schemas/audio-env.schema.json';
import { makeMeter } from '../../core/time.ts';
import { rankedReasons } from '../../grade/ranked.ts';
import { exportAll, importAll } from '../../store/index.ts';
import { MemoryKv, makeAttempt, makeCalibration, memoryRepos } from '../../store/test-data.ts';
import type { AudioRouteInfo, Calibration, GateId, GradeInput } from '../../core/types.ts';
import { bluetoothBanner, buildAudioEnv, evaluateTakeGate, type GateFacts } from './index.ts';

const cfg = configs();
const ranked = cfg.grading.ranked;
const cb = cfg.budget.calibration;
const ROUTE = 'route-1';

const cal = (over: Partial<Calibration> = {}): Calibration => ({
  ...makeCalibration(ROUTE),
  method: 'loopback',
  spreadMs: 1,
  clicksDetected: cb.loopback.minFound,
  roundTripMs: 60,
  sanityToneCents: 0,
  ...over,
});
const facts = (over: Partial<GateFacts> = {}): GateFacts => ({
  route: { routeKey: ROUTE, appliedProcessing: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
  calibration: cal(),
  contextSampleRate: 48000,
  trackSampleRate: 48000,
  clockRateError: 0,
  recheck: null,
  dsp: { droppedBlocks: 0, missingBlocks: 0 },
  latencyCompensationMs: 60,
  ...over,
});
const failures = (over: Partial<GateFacts> = {}): GateId[] => evaluateTakeGate(facts(over), cfg).gateFailures;

describe('gate boundaries', () => {
  it('passes a clean take', () => expect(evaluateTakeGate(facts(), cfg)).toMatchObject({ gateFailures: [], gatePassed: true, rankedReasons: [] }));

  it('sample-rate: track mismatch and clock error at the limit', () => {
    expect(failures({ trackSampleRate: 44100 })).toEqual(['sample-rate']);
    expect(failures({ trackSampleRate: null })).toEqual([]);
    expect(failures({ clockRateError: cb.clockRateMaxError })).toEqual([]);
    expect(failures({ clockRateError: cb.clockRateMaxError * 1.01 })).toEqual(['sample-rate']);
    expect(failures({ clockRateError: -cb.clockRateMaxError * 1.01 })).toEqual(['sample-rate']);
  });

  it('calibration-unmeasured: none, stale, reported, other route', () => {
    expect(failures({ calibration: null })).toEqual(['calibration-unmeasured']);
    expect(failures({ calibration: cal({ stale: true }) })).toEqual(['calibration-unmeasured']);
    expect(failures({ calibration: cal({ method: 'reported' }) })).toEqual(['calibration-unmeasured']);
    expect(failures({ calibration: cal({ routeKey: 'other' }) })).toEqual(['calibration-unmeasured']);
  });

  it('calibration-quality: MAD, click count, RTL range, per method', () => {
    expect(failures({ calibration: cal({ spreadMs: ranked.loopbackMaxMadMs }) })).toEqual([]);
    expect(failures({ calibration: cal({ spreadMs: ranked.loopbackMaxMadMs + 0.1 }) })).toEqual(['calibration-quality']);
    expect(failures({ calibration: cal({ clicksDetected: cb.loopback.minFound - 1 }) })).toEqual(['calibration-quality']);
    expect(failures({ calibration: cal({ roundTripMs: cb.loopback.minRtlMs - 1 }), latencyCompensationMs: 60 })).toEqual(['calibration-quality']);
    const pa = (spreadMs: number) => cal({ method: 'play-along', spreadMs, clicksDetected: 1, roundTripMs: 60 });
    expect(failures({ calibration: pa(ranked.playAlongMaxMadMs) })).toEqual([]);
    expect(failures({ calibration: pa(ranked.playAlongMaxMadMs + 0.1) })).toEqual(['calibration-quality']);
  });

  it('aec-suspected: flag and sanity tone limit', () => {
    expect(failures({ calibration: cal({ aecSuspected: true }) })).toEqual(['aec-suspected']);
    expect(failures({ calibration: cal({ sanityToneCents: cb.sanityToneCents }) })).toEqual([]);
    expect(failures({ calibration: cal({ sanityToneCents: -cb.sanityToneCents - 0.1 }) })).toEqual(['aec-suspected']);
  });

  it('processing-on: any of the three true; null passes', () => {
    const ap = (p: Partial<AudioRouteInfo['appliedProcessing']>) => ({
      routeKey: ROUTE,
      appliedProcessing: { echoCancellation: null, noiseSuppression: null, autoGainControl: null, ...p },
    });
    expect(failures({ route: ap({}) })).toEqual([]);
    for (const k of ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const) expect(failures({ route: ap({ [k]: true }) })).toEqual(['processing-on']);
  });

  it('recheck: only unmeasured fails; a measured shift keeps the gate', () => {
    const rc = (status: 'measured' | 'unmeasured') => ({ status, measuredMs: status === 'measured' ? 70 : null, clicks: 4, madMs: 1, usedFresh: true, promptRecalibrate: true });
    expect(failures({ recheck: rc('measured') })).toEqual([]);
    expect(failures({ recheck: rc('unmeasured') })).toEqual(['recheck']);
  });

  it('capture-gap: any gap or drop', () => {
    expect(failures({ dsp: { droppedBlocks: 0, missingBlocks: 1 } })).toEqual(['capture-gap']);
    expect(failures({ dsp: { droppedBlocks: 1, missingBlocks: 0 } })).toEqual(['capture-gap']);
  });

  it('rtl-high: ceiling inclusive', () => {
    expect(failures({ latencyCompensationMs: ranked.maxRtlMs })).toEqual([]);
    expect(failures({ latencyCompensationMs: ranked.maxRtlMs + 1 })).toEqual(['rtl-high']);
  });
});

describe('ranked reason mapping', () => {
  it('calibration-unmeasured gives calibration; the rest give measurement', () => {
    expect(evaluateTakeGate(facts({ calibration: null }), cfg).rankedReasons).toEqual(['calibration']);
    expect(evaluateTakeGate(facts({ latencyCompensationMs: 500 }), cfg).rankedReasons).toEqual(['measurement']);
    expect(evaluateTakeGate(facts({ calibration: null, dsp: { droppedBlocks: 2, missingBlocks: 0 } }), cfg).rankedReasons).toEqual(['calibration', 'measurement']);
  });

  it('no measured calibration (outputLatencyReported false) is graded as practice: ranked false, reason calibration', () => {
    const reported = cal({ method: 'reported' });
    const gate = evaluateTakeGate(facts({ calibration: reported }), cfg);
    const level = 1;
    const input = {
      cfg,
      level,
      bpm: cfg.levelByNumber[level]!.tempo.minBpm,
      meter: makeMeter(4, 4),
      calibrationMeasured: false,
      ranking: { mode: 'ranked', seenBefore: false, scanStrict: true, familiarity: 0, skipLimitHit: false, metronome: 'audible', gateFailures: gate.gateFailures },
    } as unknown as GradeInput;
    expect(rankedReasons(input)).toEqual(['calibration']);
  });
});

describe('bluetooth banner (W8)', () => {
  const b = (inputLabel: string | null, roundTripMs: number | null, osFamily: 'ios' | 'linux' = 'linux') => bluetoothBanner({ inputLabel, roundTripMs, osFamily }, cfg);
  it('label fixtures raise the flag', () => {
    for (const l of ['AirPods Pro', 'Bluetooth Headset', 'Beats Studio', 'Hands-Free HF Audio', 'JABRA headset']) expect(b(l, 40).show).toBe(true);
    expect(b('MacBook Pro Microphone', 40).show).toBe(false);
    expect(b(null, null).show).toBe(false);
  });
  it('a 150 ms calibration raises it; the ceiling does not', () => {
    expect(b('Built-in', 150).show).toBe(true);
    expect(b('Built-in', ranked.maxRtlMs).show).toBe(false);
  });
  it('iOS adds the hint', () => {
    expect(b('AirPods', 40, 'ios')).toEqual({ show: true, iosHint: true });
    expect(b('AirPods', 40).iosHint).toBe(false);
    expect(b('Built-in', 30, 'ios').iosHint).toBe(false);
  });
});

describe('AudioEnv (W5)', () => {
  const route: AudioRouteInfo = {
    routeKey: ROUTE,
    inputKind: 'built-in',
    outputMode: 'speakers',
    sampleRate: 48000,
    appliedProcessing: { echoCancellation: false, noiseSuppression: false, autoGainControl: null },
  };
  const env = () =>
    buildAudioEnv({
      capabilities: { platform: 'web', osFamily: 'ios', displayMode: 'standalone' },
      appBuild: 'b1',
      coreVersion: 'c1',
      metronomeMode: 'audible',
      clickTimbre: 'tick',
      route,
      audio: { contextSampleRate: 48000, contextRecreated: true, audioSessionType: 'play-and-record', clockRateError: 0.001 },
      captureRelay: true,
      calibration: cal(),
      latencyCompensationMs: 60,
      dsp: { droppedBlocks: 0, maxQueueMs: 12, hopP95Ms: null },
      gateFailures: ['recheck'],
    });
  it('is schema valid, and none when no calibration', () => {
    const v = new Ajv({ strict: false }).compile(audioEnvSchema);
    expect(v(env())).toBe(true);
    const e = buildAudioEnv({
      capabilities: { platform: 'web', osFamily: 'linux', displayMode: 'browser' }, appBuild: 'b', coreVersion: 'c', metronomeMode: 'countInOnly', clickTimbre: 'wood',
      route, audio: { contextSampleRate: 48000, contextRecreated: false, audioSessionType: null, clockRateError: null }, captureRelay: false, calibration: null,
      latencyCompensationMs: 0, dsp: { droppedBlocks: 0, maxQueueMs: 0, hopP95Ms: 3 }, gateFailures: [],
    });
    expect(e.calibrationMethod).toBe('none');
    expect(v(e)).toBe(true);
  });
  it('survives export and import deep-equal', async () => {
    const kv = new MemoryKv();
    const r = memoryRepos(kv);
    await r.attempts.add(makeAttempt(0, { audioEnv: env() }));
    const file = JSON.parse(JSON.stringify(await exportAll(r, kv)));
    const kv2 = new MemoryKv();
    const r2 = memoryRepos(kv2);
    await importAll(r2, file, kv2);
    const a = await r2.attempts.byId(makeAttempt(0).id);
    expect(a!.audioEnv).toEqual(env());
  });
});
