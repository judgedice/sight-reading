// The native calibration service (M4-3, AUDIO-DESIGN section 5, PLAN R86): the latency record, the stale guard, a
// calibration that is not offered again, the short profile and the cross-check. Fakes only: FakeNativeIpc under the
// real NativeAudioBackend for the guard and the route key, FakeAudioBackend (with a speaker-to-mic path) for the runs.
import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng.ts';
import type { ClockSeconds, PlatformCapabilities } from '../../core/platform.ts';
import type { Calibration } from '../../core/types.ts';
import { defaultAppSettings } from '../../store/defaults.ts';
import { MemoryKv, makeCalibration, memoryRepos } from '../../store/test-data.ts';
import { FakeAudioBackend } from '../../testkit/fake-backend.ts';
import { rankedAvailability } from '../../session/gates/index.ts';
import { NativeCalibration, nativeLatencyKey, type NativeLatencyRecord } from '../../platform/native/calibration.ts';
import { NativeAudioBackend } from '../../platform/native/audio/native-audio-backend.ts';
import type { LatencyReport, LoopbackEstimate } from '../../platform/native/audio/ipc.ts';
import { FakeNativeIpc, type FakeNativeIpcOptions } from '../../platform/native/audio/testing/fake-native-ipc.ts';
import { nativeConfigs } from '../../platform/native/boot.ts';
import { calibrationStatus } from './calibration-status.ts';
import { createCalibrationServices } from './calibration-services.ts';
import { appConfigs } from './configs.ts';
import { createValue } from './values.ts';

const caps: PlatformCapabilities = { platform: 'desktop', outputLatencyReported: true, wakeLock: false, serviceWorker: false, persistentStorage: 'best-effort', osFamily: 'linux', displayMode: 'browser' };
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

// ---- the stale guard and the route key, on the real backend over FakeNativeIpc --------------------------------------

/** `shared`: the stores of an earlier launch (a restart keeps its kv and calibrations). */
function nativeSide(o: FakeNativeIpcOptions = {}, shared?: { kv: MemoryKv; repos: ReturnType<typeof memoryRepos> }) {
  const ipc = new FakeNativeIpc(o);
  const audio = new NativeAudioBackend({ ipc, capabilities: { ...caps }, perfNow: ipc.perfNow });
  const kv = shared?.kv ?? new MemoryKv();
  const repos = shared?.repos ?? memoryRepos(kv);
  const native = new NativeCalibration({ audio, kv, repos });
  let marked = 0;
  const guarded = native.guarded(audio, () => marked++);
  return { ipc, audio, kv, repos, native, guarded, marked: () => marked };
}

const record = (over: Partial<NativeLatencyRecord> = {}): NativeLatencyRecord => ({ predictedMs: 35, measuredMs: 37, trust: 'A', at: '2026-11-18T12:00:00.000Z', profile: 'native-short', ...over });
const measuredFor = (routeKey: string, over: Partial<Calibration> = {}): Calibration => ({ ...makeCalibration(routeKey), platform: 'desktop', roundTripMs: 37, ...over });

async function stored(side: ReturnType<typeof nativeSide>, rec: NativeLatencyRecord | null, cal: Partial<Calibration> | null = {}): Promise<string> {
  const route = await side.audio.unlock();
  if (rec) await side.kv.set(nativeLatencyKey(route.routeKey), rec as never);
  if (cal) await side.repos.calibrations.put(measuredFor(route.routeKey, cal));
  return route.routeKey;
}
const staleNow = async (side: ReturnType<typeof nativeSide>, key: string): Promise<boolean | undefined> => (await side.repos.calibrations.get(key))?.stale;

describe('rule 2: the stale guard', () => {
  it('marks the stored measured calibration stale when the reported latency moves 2.1 ms on a route event', async () => {
    const s = nativeSide(); // output 25 ms + input 10 ms = 35 ms
    const key = await stored(s, record());
    s.ipc.changeRoute({}, { outputSec: 0.0271 });
    await settle();
    expect(await staleNow(s, key)).toBe(true);
    expect(s.marked()).toBe(1);
  });

  it('does not on 1.9 ms, nor on 2.0 ms, in either direction', async () => {
    for (const out of [0.0269, 0.027, 0.0231, 0.023]) {
      const s = nativeSide();
      const key = await stored(s, record());
      s.ipc.changeRoute({}, { outputSec: out });
      await settle();
      expect(await staleNow(s, key), `output ${out}`).toBe(false);
      expect(s.marked()).toBe(0);
    }
  });

  it('does nothing when the reported latency is null now (trust C), or was null when stored', async () => {
    const c = nativeSide({ latency: { trust: 'C', outputSec: null, inputSec: null } });
    const keyC = await stored(c, record({ predictedMs: 35 }));
    c.ipc.changeRoute({}, { outputSec: null });
    await settle();
    expect(await staleNow(c, keyC)).toBe(false);

    const s = nativeSide();
    const key = await stored(s, record({ predictedMs: null, trust: 'C' }));
    s.ipc.changeRoute({}, { outputSec: 0.05 });
    await settle();
    expect(await staleNow(s, key)).toBe(false);
  });

  it('does nothing without a stored latency record, or without a measured, non-stale calibration to mark', async () => {
    const none = nativeSide();
    const k1 = await stored(none, null);
    none.ipc.changeRoute({}, { outputSec: 0.05 });
    await settle();
    expect(await staleNow(none, k1)).toBe(false);

    const reported = nativeSide();
    const k2 = await stored(reported, record(), { method: 'reported' });
    reported.ipc.changeRoute({}, { outputSec: 0.05 });
    await settle();
    expect(await staleNow(reported, k2)).toBe(false);

    const noCal = nativeSide();
    const k3 = await stored(noCal, record(), null);
    noCal.ipc.changeRoute({}, { outputSec: 0.05 });
    await settle();
    expect(await staleNow(noCal, k3)).toBeUndefined();
  });

  it('runs on every unlock too: a restart that reports another latency finds the calibration stale', async () => {
    const first = nativeSide();
    const key = await stored(first, record());
    // A second launch on the same device and buffers (same route key) whose OS now reports 4 ms more output latency.
    const second = nativeSide({ latency: { outputSec: 0.029 } }, first);
    const route = await second.guarded.unlock();
    expect(route.routeKey).toBe(key);
    expect(await staleNow(second, key)).toBe(true);
    expect(second.marked()).toBe(1);
  });

  it('a stale calibration is no longer measured for the route: the app reads it as not calibrated, and Ranked is blocked', async () => {
    const s = nativeSide();
    const key = await stored(s, record());
    s.ipc.changeRoute({}, { outputSec: 0.0271 });
    await settle();
    const calibrations = await s.repos.calibrations.all();
    const facts = { routeKey: key, outputMode: 'speakers' as const, calibrations, listening: true, permission: 'granted' as const };
    expect(rankedAvailability(facts)).toEqual({ available: false, block: 'calibration' });
    expect(calibrationStatus({ ...facts, lastFailure: null, now: Date.parse('2026-11-19T00:00:00Z'), localDay: (ms) => new Date(ms).toISOString().slice(0, 10) }).state).toBe('changed');
  });
});

describe('rule 2: a stored measured calibration is not offered again', () => {
  it('the native route key is the same on every launch of the same device, rate and buffers; the record found there is ok and ranks', async () => {
    const first = nativeSide();
    const key = await stored(first, record());
    const second = nativeSide({}, first);
    const route = await second.audio.unlock();
    expect(route.routeKey).toBe(key);
    const facts = { routeKey: route.routeKey, outputMode: 'speakers' as const, calibrations: await second.repos.calibrations.all(), listening: true, permission: 'granted' as const, maxRtlMs: 120 };
    expect(rankedAvailability(facts)).toEqual({ available: true, block: null });
    const status = calibrationStatus({ ...facts, maxRtlMs: 120, lastFailure: null, now: Date.parse('2026-11-19T00:00:00Z'), localDay: (ms) => new Date(ms).toISOString().slice(0, 10) });
    expect(status.state).toBe('ok');
    expect(status.ms).toBe(37);
  });

  it('the key does not depend on the latency report, only on device ids, buffers, rate, mode and OS', async () => {
    const a = await nativeSide({ latency: { trust: 'A' } }).audio.unlock();
    const b = await nativeSide({ latency: { trust: 'C', outputSec: null, inputSec: null } }).audio.unlock();
    expect(b.routeKey).toBe(a.routeKey);
    expect((await nativeSide({ outFrames: 256 }).audio.unlock()).routeKey).not.toBe(a.routeKey);
    expect((await nativeSide({ route: { inputUid: 'other' } }).audio.unlock()).routeKey).not.toBe(a.routeKey);
  });
});

// ---- the runs, through createCalibrationServices -----------------------------------------------------------------------

class NativeFake extends FakeAudioBackend {
  report: LatencyReport | null = { outputSec: 0.025, inputSec: 0.01, trust: 'A', parts: { outBuffer: null, outDevice: null, outSafety: null, outStream: null, inBuffer: null, inDevice: null, inSafety: null, inStream: null } };
  /** The answers of successive `measureLoopback` calls; the last repeats. An Error is thrown. */
  answers: (Partial<LoopbackEstimate> | Error)[] = [];
  loopbackCalls = 0;
  latencyReport(): LatencyReport | null {
    return this.report;
  }
  async measureLoopback(): Promise<LoopbackEstimate> {
    const a = this.answers[Math.min(this.loopbackCalls++, this.answers.length - 1)];
    if (a instanceof Error) throw a;
    return { found: 8, scheduled: 8, roundTripMs: 37, madMs: 0.2, snrDb: 40, predictedMs: null, ...a };
  }
  async checkClockRate() {
    return { ok: true, error: 0, recreated: false };
  }
}

function harness(o: { native: boolean; answers?: (Partial<LoopbackEstimate> | Error)[]; report?: LatencyReport | null; rtlSec?: number; headphones?: boolean }) {
  const fb = new NativeFake({ sampleRate: 48000, loopback: { rtlSec: o.rtlSec ?? 0.037, gainDb: -12 } });
  if (o.answers) fb.answers = o.answers;
  if (o.report !== undefined) fb.report = o.report;
  const kv = new MemoryKv();
  const repos = memoryRepos(kv);
  const settings = createValue(defaultAppSettings());
  const native = o.native ? new NativeCalibration({ audio: fb, kv, repos }) : null;
  const services = createCalibrationServices({
    audio: fb,
    capabilities: caps,
    configs: nativeConfigs(appConfigs()),
    rng: createRng(3),
    settings,
    saveSettings: (s) => settings.set(s),
    saveCalibration: (c) => repos.calibrations.put(c),
    clockWall: () => '2026-11-18T12:00:00.000Z',
    timers: { setTimeout: (fn) => { fb.advanceTo(((fb.now() as number) + 0.1) as ClockSeconds); fn(); return 0; } },
    inputDevices: async () => [],
    download: () => undefined,
    appBuild: 'test',
    kv,
    ...(native ? { native } : {}),
  });
  const noop = { onStage: () => undefined, onSound: () => undefined, onClick: () => undefined };
  const gaps = (): number[] => {
    const t = fb.log.calibrationClicks.flatMap((c) => c.times).map(Number);
    return t.slice(1).map((x, i) => x - (t[i] as number));
  };
  const latencyOf = async (key: string) => (await kv.get(nativeLatencyKey(key))) as unknown as NativeLatencyRecord | undefined;
  return { fb, kv, repos, services, noop, gaps, latencyOf };
}

/** Runs a speaker calibration and saves it as the card does; the stored calibration and the kv record come back. */
async function runAndSave(h: ReturnType<typeof harness>) {
  const out = await h.services.runLoopback(h.noop);
  expect(out.accepted).toBe(true);
  const cal = out.calibration as Calibration;
  await h.services.save(cal);
  return { out, cal, rec: await h.latencyOf(cal.routeKey) };
}

describe('rule 3: the short profile', () => {
  it('a passing pre-check runs the click gaps at 0.2 to 0.35 s and records native-short', async () => {
    const h = harness({ native: true, answers: [{}] });
    const { cal, rec } = await runAndSave(h);
    expect(h.gaps().length).toBeGreaterThan(10);
    for (const g of h.gaps()) {
      expect(g).toBeGreaterThanOrEqual(0.2 - 1e-6);
      expect(g).toBeLessThanOrEqual(0.35 + 1e-6);
    }
    expect(rec).toMatchObject({ profile: 'native-short', trust: 'A', at: cal.measuredAt, measuredMs: cal.roundTripMs });
    expect(rec?.predictedMs).toBeCloseTo(35, 6);
    expect(Math.abs(cal.roundTripMs - 37)).toBeLessThanOrEqual(1);
    expect(cal.method).toBe('loopback');
  });

  for (const [why, answer] of [
    ['too few clicks (6 of 8)', { found: 6 }],
    ['MAD above 0.5 ms', { madMs: 0.6 }],
    ['a round trip of 100 ms', { roundTripMs: 100 }],
    ['nothing measured', { found: 0, roundTripMs: null, madMs: null }],
    ['the engine throwing', new Error('busy')],
  ] as const) {
    it(`a failing pre-check (${why}) plays the standard schedule, 0.4 to 0.7 s, and records standard`, async () => {
      const h = harness({ native: true, answers: [answer, {}] });
      const { rec } = await runAndSave(h);
      for (const g of h.gaps()) {
        expect(g).toBeGreaterThanOrEqual(0.4 - 1e-6);
        expect(g).toBeLessThanOrEqual(0.7 + 1e-6);
      }
      expect(rec?.profile).toBe('standard');
    });
  }

  it('trust does not gate it: a trust C route (no predicted latency) passes on the pre-check alone', async () => {
    const h = harness({ native: true, answers: [{}], report: { outputSec: null, inputSec: null, trust: 'C', parts: { outBuffer: 0.003, outDevice: null, outSafety: null, outStream: null, inBuffer: null, inDevice: null, inSafety: null, inStream: null } } });
    const { rec } = await runAndSave(h);
    expect(rec).toMatchObject({ profile: 'native-short', trust: 'C', predictedMs: null });
    expect(Math.max(...h.gaps())).toBeLessThanOrEqual(0.35 + 1e-6);
  });

  it('the pre-check can be switched off for the end-to-end test: the standard profile plays on a route that would pass', async () => {
    const kv = new MemoryKv();
    const f = new NativeFake({ sampleRate: 48000 });
    const n = new NativeCalibration({ audio: f, kv, repos: memoryRepos(kv) });
    expect((await n.chooseProfile()).profile).toBe('native-short');
    n.precheckDisabled = true;
    expect(await n.chooseProfile()).toEqual({ profile: 'standard' });
  });
});

describe('rule 1 and rule 5: the record and the cross-check', () => {
  it('is written only when the calibration is saved, under native:latency:<routeKey>, with exactly its five fields', async () => {
    const h = harness({ native: true, answers: [{}] });
    const out = await h.services.runLoopback(h.noop);
    const key = (out.calibration as Calibration).routeKey;
    expect(await h.latencyOf(key)).toBeUndefined();
    await h.services.save(out.calibration as Calibration);
    expect(Object.keys((await h.latencyOf(key)) as object).sort()).toEqual(['at', 'measuredMs', 'predictedMs', 'profile', 'trust']);
    expect([...h.kv.map.keys()].filter((k) => k.startsWith('native:latency:'))).toEqual([nativeLatencyKey(key)]);
  });

  it('a different engine measurement by more than 1.5 ms is kept as crossCheckMs; the calibration is the app\'s own, untouched', async () => {
    const h = harness({ native: true, answers: [{}, { roundTripMs: 40.5 }] });
    const { out, cal, rec } = await runAndSave(h);
    expect(h.fb.loopbackCalls).toBe(2);
    expect(rec?.crossCheckMs).toBeCloseTo(40.5 - cal.roundTripMs, 9);
    expect(Math.abs(rec?.crossCheckMs ?? 0)).toBeGreaterThan(1.5);
    expect(cal.roundTripMs).toBe(out.rtlMs);
    expect((await h.repos.calibrations.get(cal.routeKey))?.roundTripMs).toBe(cal.roundTripMs);
    expect(out.accepted).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/crossCheck/);
  });

  it('no crossCheckMs when the two agree within 1.5 ms, or when the second measurement fails or finds nothing', async () => {
    for (const second of [{ roundTripMs: 37.9 }, { roundTripMs: null, found: 0 }, new Error('busy')] as const) {
      const h = harness({ native: true, answers: [{}, second] });
      const { rec } = await runAndSave(h);
      expect(rec && 'crossCheckMs' in rec, JSON.stringify(second)).toBe(false);
    }
  });

  it('play-along (headphones) has no pre-check and no cross-check, and a failed run records nothing', async () => {
    const h = harness({ native: true, answers: [{}] });
    const out = await h.services.runPlayAlong({ ...h.noop, onNote: () => undefined });
    // The fake hears no player, so the run fails; what matters here is that headphones never touch the engine's loopback.
    expect(out.accepted).toBe(false);
    expect(h.fb.loopbackCalls).toBe(0);
    expect([...h.kv.map.keys()].some((k) => k.startsWith('native:latency:'))).toBe(false);
  });

  it('an accepted play-along calibration is described as standard, measured once, with no engine loopback', async () => {
    const f = new NativeFake({ sampleRate: 48000 });
    const n = new NativeCalibration({ audio: f, kv: new MemoryKv(), repos: memoryRepos() });
    const p = await n.describe({ ...makeCalibration('r-pa'), method: 'play-along', roundTripMs: 52 }, 'standard');
    expect(p.record).toEqual({ predictedMs: 35, measuredMs: 52, trust: 'A', at: '2026-01-01T00:00:00.000Z', profile: 'standard' });
    expect(f.loopbackCalls).toBe(0);
  });

  it('a failed run leaves no record, and an estimate (method reported) never does', async () => {
    const h = harness({ native: true, answers: [{ found: 0, roundTripMs: null, madMs: null }], rtlSec: 0.5 });
    const out = await h.services.runLoopback(h.noop);
    expect(out.accepted).toBe(false);
    await h.services.save(makeCalibration('r-estimate'));
    expect([...h.kv.map.keys()].some((k) => k.startsWith('native:latency:'))).toBe(false);
  });
});

describe('the web path is unchanged', () => {
  it('without the native service: no pre-check, no cross-check, the 0.4 to 0.7 s gaps, no kv record', async () => {
    const h = harness({ native: false, answers: [{}] });
    const out = await h.services.runLoopback(h.noop);
    expect(out.accepted).toBe(true);
    await h.services.save(out.calibration as Calibration);
    expect(h.fb.loopbackCalls).toBe(0);
    for (const g of h.gaps()) {
      expect(g).toBeGreaterThanOrEqual(0.4 - 1e-6);
      expect(g).toBeLessThanOrEqual(0.7 + 1e-6);
    }
    expect([...h.kv.map.keys()].some((k) => k.startsWith('native:latency:'))).toBe(false);
  });
});
