import { describe, expect, it } from 'vitest';
import budgetJson from '../../../config/measurement-budget.json';
import { appConfigs } from '../../app/compose/configs.ts';
import { bootNative, NATIVE_LOOPBACK_MIN_RTL_MS, nativeConfigs } from './boot.ts';
import { nativeCapabilities, outputLatencyReportedFor, platformKindOf } from './capabilities.ts';
import { FakeNativeIpc } from './audio/testing/fake-native-ipc.ts';

const base = { osFamily: 'macos', displayMode: 'browser', wakeLock: false, persistentStorage: 'best-effort' } as const;

describe('nativeConfigs (PLAN R86)', () => {
  it('lowers the loopback floor to 3 ms in a copy and leaves every other value, and the originals, alone', () => {
    const web = appConfigs();
    const n = nativeConfigs(web);
    expect(NATIVE_LOOPBACK_MIN_RTL_MS).toBe(3);
    expect(n.budget.calibration.loopback.minRtlMs).toBe(3);
    expect(web.budget.calibration.loopback.minRtlMs).toBe(15);
    expect(budgetJson.calibration.loopback.minRtlMs).toBe(15);
    expect({ ...n.budget.calibration.loopback, minRtlMs: 15 }).toEqual(web.budget.calibration.loopback);
    expect({ ...n.budget.calibration, loopback: web.budget.calibration.loopback }).toEqual(web.budget.calibration);
    expect({ ...n.budget, calibration: web.budget.calibration }).toEqual(web.budget);
    expect(n.grading).toBe(web.grading);
    expect(n.instrumentById).toBe(web.instrumentById);
    expect(n.configVersion).toBe(web.configVersion);
  });
});

describe('capabilities', () => {
  it('maps the OS to the platform kind: iPhone and iPad are ios, Android is android, the rest desktop', () => {
    expect(platformKindOf('ios')).toBe('ios');
    expect(platformKindOf('ipados')).toBe('ios');
    expect(platformKindOf('android')).toBe('android');
    for (const os of ['macos', 'windows', 'linux', 'other'] as const) expect(platformKindOf(os)).toBe('desktop');
  });

  it('has no service worker, and reports latency unless the engine trust is C or unknown', () => {
    expect(outputLatencyReportedFor(null)).toBe(false);
    expect(outputLatencyReportedFor('A')).toBe(true);
    expect(outputLatencyReportedFor('B')).toBe(true);
    expect(outputLatencyReportedFor('C')).toBe(false);
    expect(nativeCapabilities(base, 'B')).toEqual({ platform: 'desktop', outputLatencyReported: true, wakeLock: false, serviceWorker: false, persistentStorage: 'best-effort', osFamily: 'macos', displayMode: 'browser' });
    expect(nativeCapabilities({ ...base, osFamily: 'ipados' }).platform).toBe('ios');
  });
});

describe('bootNative', () => {
  it('builds a backend whose capabilities are the shared object and follow the engine trust after unlock', async () => {
    const ipc = new FakeNativeIpc({ latency: { trust: 'C' } });
    const boot = bootNative({ base, configs: appConfigs(), outputMode: 'wired', ipc });
    expect(boot.capabilities).toBe(boot.audio.capabilities);
    expect(boot.capabilities.outputLatencyReported).toBe(false);
    const route = await boot.audio.unlock();
    expect(route.outputMode).toBe('wired');
    expect(ipc.openCalls[0]?.outputMode).toBe('wired');
    expect(boot.capabilities.platform).toBe('desktop');
    expect(boot.configs.budget.calibration.loopback.minRtlMs).toBe(3);
    expect(await boot.inputDevices()).toEqual([]);
  });

  it('trust A turns reported latency on in the same object', async () => {
    const boot = bootNative({ base, configs: appConfigs(), outputMode: 'speakers', ipc: new FakeNativeIpc({ latency: { trust: 'A' } }) });
    await boot.audio.unlock();
    expect(boot.capabilities.outputLatencyReported).toBe(true);
  });

  it('debug hooks: off by default and when the command fails; on with the seed when the engine says so', async () => {
    const off = new FakeNativeIpc();
    expect(await bootNative({ base, configs: appConfigs(), outputMode: 'speakers', ipc: off }).debugHooks()).toEqual({ enabled: false, seed: null });
    const on = new FakeNativeIpc();
    on.debug = { enabled: true, seed: 9 };
    expect(await bootNative({ base, configs: appConfigs(), outputMode: 'speakers', ipc: on }).debugHooks()).toEqual({ enabled: true, seed: 9 });
    const broken = new FakeNativeIpc();
    broken.failNext('debugHooks', 'unknown command');
    expect(await bootNative({ base, configs: appConfigs(), outputMode: 'speakers', ipc: broken }).debugHooks()).toEqual({ enabled: false, seed: null });
  });

  it('hands the session a capture channel whose port1 reaches port2', async () => {
    const boot = bootNative({ base, configs: appConfigs(), outputMode: 'speakers', ipc: new FakeNativeIpc() });
    const ch = boot.createCaptureChannel();
    const port2 = ch.port2 as MessagePort;
    const got = new Promise<unknown>((r) => {
      port2.onmessage = (ev) => r(ev.data);
    });
    ch.port1.postMessage({ hello: 1 });
    expect(await got).toEqual({ hello: 1 });
    ch.port1.close();
    port2.close();
  });
});
