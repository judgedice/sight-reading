// The calibrate route's services (round 2, R2-03): what a failed run leaves behind (cause 1), a clock-rate result that
// cannot stop a good run being stored (cause 7), a store that survives React StrictMode's double effects (cause 6),
// and old route keys adopted under the plain label (cause 5).
import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng.ts';
import type { PlatformCapabilities } from '../../core/platform.ts';
import type { Calibration } from '../../core/types.ts';
import { defaultAppSettings } from '../../store/defaults.ts';
import { MemoryKv, makeCalibration, memoryRepos } from '../../store/test-data.ts';
import { FakeAudioBackend } from '../../testkit/fake-backend.ts';
import { routeKeyAliasesOf, routeKeyOf } from '../../platform/shared/audio/route.ts';
import { appConfigs } from './configs.ts';
import { calibrationStatus, KV_CAL_LAST_FAILURE, type CalFailure } from './calibration-status.ts';
import { adoptLegacyCalibrations, adoptingLegacyCalibrations, createCalibrationServices, type CalibrationBackendExtras } from './calibration-services.ts';
import { createValue } from './values.ts';

const caps: PlatformCapabilities = { platform: 'web', outputLatencyReported: true, wakeLock: false, serviceWorker: false, persistentStorage: 'best-effort', osFamily: 'linux', displayMode: 'browser' };

class Backend extends FakeAudioBackend implements CalibrationBackendExtras {
  clock: () => Promise<{ ok: boolean; error: number | null; recreated: boolean }> = async () => ({ ok: true, error: 0, recreated: false });
  checkClockRate(): Promise<{ ok: boolean; error: number | null; recreated: boolean }> {
    return this.clock();
  }
}

function harness(opts: { loopback: boolean; kv?: MemoryKv | null }) {
  const kv = opts.kv === null ? undefined : (opts.kv ?? new MemoryKv());
  const fb = new Backend({ sampleRate: 48000, ...(opts.loopback ? { loopback: { rtlSec: 0.037, gainDb: -12 } } : {}) });
  const repos = memoryRepos(kv instanceof MemoryKv ? kv : new MemoryKv());
  const settings = createValue(defaultAppSettings());
  const services = createCalibrationServices({
    audio: fb,
    capabilities: caps,
    configs: appConfigs(),
    rng: createRng(1),
    settings,
    saveSettings: (s) => settings.set(s),
    saveCalibration: (c) => repos.calibrations.put(c),
    clockWall: () => '2026-11-18T12:00:00.000Z',
    timers: { setTimeout: (fn) => { fb.advanceTo(((fb.now() as number) + 0.1) as never); fn(); return 0; } },
    inputDevices: async () => [],
    download: () => undefined,
    appBuild: 'test',
    ...(kv ? { kv } : {}),
  });
  const noop = { onStage: () => undefined, onSound: () => undefined, onClick: () => undefined };
  return { fb, kv, repos, services, noop };
}

const failureOf = async (kv: MemoryKv | undefined): Promise<CalFailure | undefined> => (await kv?.get(KV_CAL_LAST_FAILURE)) as unknown as CalFailure | undefined;

describe('cause 1: only a passing run is stored, and nothing said so', () => {
  it('old behaviour: a run that fails leaves no trace, so the status reads "not calibrated" as if never tried', async () => {
    // No loopback in the fake: nothing is heard, the run is not accepted, and (as before) nothing is stored.
    const h = harness({ loopback: false, kv: null });
    const out = await h.services.runLoopback(h.noop);
    expect(out.accepted).toBe(false);
    expect(out.calibration).toBeNull();
    expect(await h.repos.calibrations.all()).toEqual([]);
    const s = calibrationStatus({ calibrations: [], routeKey: 'r', outputMode: 'speakers', lastFailure: null, now: Date.parse('2026-11-18T13:00:00Z'), localDay: (ms) => new Date(ms).toISOString().slice(0, 10) });
    expect(s.state).toBe('none');
  });

  it('fix: the failed run writes cal:lastFailure with a copy key, the status reads "failed", a stored run clears it', async () => {
    const h = harness({ loopback: false });
    const out = await h.services.runLoopback(h.noop);
    expect(out.accepted).toBe(false);
    const f = await failureOf(h.kv);
    expect(f).toMatchObject({ method: 'loopback', reason: 'calibrate.fail.loopback.few', at: '2026-11-18T12:00:00.000Z' });
    expect(f?.vars?.['total']).toBeGreaterThan(0);
    const facts = { calibrations: [] as Calibration[], routeKey: 'r', outputMode: 'speakers' as const, lastFailure: f ?? null, now: Date.parse('2026-11-18T13:00:00Z'), localDay: (ms: number) => new Date(ms).toISOString().slice(0, 10) };
    expect(calibrationStatus(facts)).toMatchObject({ state: 'failed', reason: 'calibrate.fail.loopback.few' });
    // The card stores an accepted calibration through `save`; that clears the failure.
    await h.services.save(makeCalibration('r'));
    expect(await failureOf(h.kv)).toBeUndefined();
  });

  it('an accepted run writes nothing, and a run that throws records an error reason and still throws', async () => {
    const good = harness({ loopback: true });
    const out = await good.services.runLoopback(good.noop);
    expect(out.accepted).toBe(true);
    expect(await failureOf(good.kv)).toBeUndefined();

    const bad = harness({ loopback: true });
    bad.fb.unlock = async () => {
      throw new Error('denied');
    };
    await expect(bad.services.runLoopback(bad.noop)).rejects.toThrow('denied');
    expect(await failureOf(bad.kv)).toMatchObject({ reason: 'calibrate.fail.error' });
  });

  it('a kv that throws never turns a finished run into an error', async () => {
    const h = harness({ loopback: false });
    h.kv!.set = async () => {
      throw new Error('quota');
    };
    await expect(h.services.runLoopback(h.noop)).resolves.toMatchObject({ accepted: false });
  });
});

describe('cause 7: the clock-rate gate must not stop a good run being stored', () => {
  for (const [name, clock] of [
    ['unmeasured (error null)', async () => ({ ok: true, error: null, recreated: false })],
    ['the check throws', async (): Promise<never> => { throw new Error('no worklet'); }],
    ['measured out of range even after a recreate', async () => ({ ok: false, error: 0.088, recreated: true })],
  ] as const) {
    it(`a run that measures well is accepted and carries a calibration when the clock check is ${name}`, async () => {
      const h = harness({ loopback: true });
      h.fb.clock = clock;
      const out = await h.services.runLoopback(h.noop);
      expect(out.accepted).toBe(true);
      expect(out.calibration).not.toBeNull();
      expect(out.calibration?.method).toBe('loopback');
      expect(await failureOf(h.kv)).toBeUndefined();
    });
  }

  it('the clock error is recorded on the calibration, never used to reject it', async () => {
    const h = harness({ loopback: true });
    h.fb.clock = async () => ({ ok: true, error: 0.004, recreated: false });
    const out = await h.services.runLoopback(h.noop);
    expect(out.calibration?.clockRateError).toBe(0.004);
  });
});

describe('cause 6: StrictMode double effects and one origin per port', () => {
  it('saving the same calibration twice (a double effect) leaves one record and no failure', async () => {
    const h = harness({ loopback: true });
    const c = makeCalibration('r-1');
    await Promise.all([h.services.save(c), h.services.save(c)]);
    expect(await h.repos.calibrations.all()).toHaveLength(1);
    expect(await failureOf(h.kv)).toBeUndefined();
  });

  it('a run started twice at once (two effects) still stores one calibration for the route', async () => {
    const h = harness({ loopback: true });
    const [a, b] = [await h.services.runLoopback(h.noop), await h.services.runLoopback(h.noop)];
    for (const o of [a, b]) if (o.calibration) await h.services.save(o.calibration);
    expect((await h.repos.calibrations.all()).length).toBe(1);
  });
});

describe('cause 5: old route keys stay readable', () => {
  const PLAIN = 'MacBook Pro Microphone (Built-in)';
  const aliases = routeKeyAliasesOf(PLAIN, 'speakers', 48000, 'macos');
  // The key the old code gave a calibration made while Chrome called the microphone "Default - ...".
  const oldKey = routeKeyAliasesOf(`Default - ${PLAIN}`, 'speakers', 48000, 'macos').find((k) => k !== routeKeyOf(PLAIN, 'speakers', 48000, 'macos'));

  it('old behaviour: a calibration under the old prefixed key did not match the plain-label key', async () => {
    const { repos } = harness({ loopback: false });
    expect(oldKey).toBeDefined();
    await repos.calibrations.put({ ...makeCalibration(oldKey as string) });
    expect(await repos.calibrations.get(aliases[0] as string)).toBeUndefined();
  });

  it('fix: adopting copies it to the current key, so it applies under the plain label; the old record stays', async () => {
    const { repos } = harness({ loopback: false });
    await repos.calibrations.put(makeCalibration(oldKey as string));
    const adopted = await adoptLegacyCalibrations(repos, aliases);
    expect(adopted?.routeKey).toBe(aliases[0]);
    expect((await repos.calibrations.get(aliases[0] as string))?.roundTripMs).toBe(80);
    expect(await repos.calibrations.get(oldKey as string)).toBeDefined();
    const s = calibrationStatus({ calibrations: await repos.calibrations.all(), routeKey: aliases[0] as string, outputMode: 'speakers', lastFailure: null, now: Date.parse('2026-01-02T00:00:00Z'), localDay: (ms) => new Date(ms).toISOString().slice(0, 10) });
    expect(s.state).toBe('ok');
  });

  it('does not overwrite a calibration already under the current key, and adopts the newest of several legacy ones', async () => {
    const { repos } = harness({ loopback: false });
    await repos.calibrations.put({ ...makeCalibration(aliases[0] as string), roundTripMs: 55 });
    expect(await adoptLegacyCalibrations(repos, aliases)).toBeNull();
    expect((await repos.calibrations.get(aliases[0] as string))?.roundTripMs).toBe(55);

    const fresh = harness({ loopback: false });
    await fresh.repos.calibrations.put({ ...makeCalibration(aliases[1] as string), roundTripMs: 70, measuredAt: '2026-01-01T00:00:00.000Z' });
    await fresh.repos.calibrations.put({ ...makeCalibration(aliases[2] as string), roundTripMs: 90, measuredAt: '2026-02-01T00:00:00.000Z' });
    expect((await adoptLegacyCalibrations(fresh.repos, aliases))?.roundTripMs).toBe(90);
    expect(await adoptLegacyCalibrations(fresh.repos, [])).toBeNull();
  });

  it('wired: the backend wrapper adopts before unlock resolves, and again on a route change; other members pass through', async () => {
    const { repos } = harness({ loopback: false });
    await repos.calibrations.put(makeCalibration(oldKey as string));
    const fb = new FakeAudioBackend({ sampleRate: 48000, route: { routeKey: aliases[0] as string, routeKeyAliases: aliases } });
    let adoptedCalls = 0;
    const audio = adoptingLegacyCalibrations(fb, repos, () => adoptedCalls++);
    const route = await audio.unlock();
    expect(route.routeKey).toBe(aliases[0]);
    expect((await repos.calibrations.get(aliases[0] as string))?.roundTripMs).toBe(80);
    expect(adoptedCalls).toBe(1);
    expect(fb.log.unlocks).toBe(1);
    expect(audio.now()).toBe(fb.now());

    // A route change to another microphone whose calibration sits under its prefixed key.
    const other = 'USB Audio Device';
    const otherAliases = routeKeyAliasesOf(`Communications - ${other}`, 'speakers', 48000, 'macos');
    const otherOld = routeKeyAliasesOf(`Communications - ${other}`, 'speakers', 48000, 'macos').at(-1) as string;
    await repos.calibrations.put(makeCalibration(otherOld));
    const seen: string[] = [];
    audio.onRouteChange((r) => seen.push(r.routeKey));
    fb.scriptRouteChange((fb.now() as number) + 0.01, { routeKey: otherAliases[0] as string, routeKeyAliases: otherAliases });
    fb.advanceTo(((fb.now() as number) + 0.1) as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([otherAliases[0]]);
    expect(await repos.calibrations.get(otherAliases[0] as string)).toBeDefined();
    expect(adoptedCalls).toBe(2);
  });
});
