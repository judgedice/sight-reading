// Test-only fakes for the calibration services (not shipped).
import type { PlatformCapabilities } from '../../../core/platform.ts';
import type { AudioRouteInfo, Calibration } from '../../../core/types.ts';
import type { AudioPrefs, CalibrationServices, LoopbackOutcome, PlayAlongOutcome } from './services.ts';

export const route: AudioRouteInfo = {
  routeKey: 'r1',
  inputKind: 'built-in',
  outputMode: 'speakers',
  sampleRate: 48000,
  appliedProcessing: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
};

export const caps: PlatformCapabilities = { platform: 'web', outputLatencyReported: true, wakeLock: true, serviceWorker: true, persistentStorage: 'best-effort', osFamily: 'windows', displayMode: 'browser' };

export const cal = (over: Partial<Calibration> = {}): Calibration => ({
  routeKey: 'r1', platform: 'web', outputMode: 'speakers', method: 'loopback', roundTripMs: 42, spreadMs: 2, clicksDetected: 10, clickLeakDb: -30, noiseFloorDb: -70,
  templates: {}, sanityToneCents: 1, aecSuspected: false, clockRateError: null, measuredAt: '2026-01-01T00:00:00Z', stale: false, ...over,
});

export const loopbackOk = (over: Partial<LoopbackOutcome> = {}): LoopbackOutcome => ({ accepted: true, failure: null, rtlMs: 42, madMs: 2, clicksFound: 10, clicksScheduled: 10, aecSuspected: false, calibration: cal(), ...over });
export const loopbackBad = (): LoopbackOutcome => ({ accepted: false, failure: 'too-few-clicks', rtlMs: null, madMs: null, clicksFound: 2, clicksScheduled: 10, aecSuspected: false, calibration: null });
export const playAlongOk = (over: Partial<PlayAlongOutcome> = {}): PlayAlongOutcome => ({
  accepted: true, failure: null, rtlMs: 60, madMs: 8, notesFound: 8, clicks: 8, offsetsMs: [60, 70, 50, 60, 65, 55, 60, 60], calibration: cal({ method: 'play-along', outputMode: 'wired' }), ...over,
});
export const playAlongBad = (): PlayAlongOutcome => ({ accepted: false, failure: 'too-few-notes', rtlMs: null, madMs: null, notesFound: 1, clicks: 8, offsetsMs: [null, null, null, null, null, null, null, 60], calibration: null });

export interface FakeCal extends CalibrationServices {
  calls: string[];
  saved: Calibration[];
  exported: string[];
  stops: number;
}

export function fakeServices(o: { caps?: Partial<PlatformCapabilities>; loopback?: LoopbackOutcome[]; playAlong?: PlayAlongOutcome[]; output?: AudioPrefs['outputMode'] } = {}): FakeCal {
  const loopback = [...(o.loopback ?? [loopbackOk()])];
  const playAlong = [...(o.playAlong ?? [playAlongOk()])];
  let prefs: AudioPrefs = { outputMode: o.output ?? 'speakers', inputDeviceId: null };
  const s: FakeCal = {
    calls: [],
    saved: [],
    exported: [],
    stops: 0,
    capabilities: { ...caps, ...o.caps },
    maxRtlMs: 120,
    loopbackSeconds: 8,
    loopbackClicks: 10,
    playAlongClicks: 8,
    prefs: () => prefs,
    setPrefs: async (p) => {
      prefs = { ...prefs, ...p };
      s.calls.push(`prefs:${JSON.stringify(p)}`);
    },
    inputDevices: async () => [{ id: 'mic1', label: 'Built-in mic' }],
    unlock: () => {
      s.calls.push('unlock');
      return Promise.resolve(route);
    },
    runLoopback: async (x) => {
      s.calls.push('loopback');
      x.onClick(0, true);
      return loopback.shift() ?? loopbackBad();
    },
    runPlayAlong: async () => {
      s.calls.push('playalong');
      return playAlong.shift() ?? playAlongBad();
    },
    runSelfTest: async () => {
      s.calls.push('selftest');
      return {
        passed: false,
        items: [
          { id: 'sanity-tone', status: 'pass' },
          { id: 'clicks', status: 'pass' },
          { id: 'recheck', status: 'fail' },
          { id: 'clock-rate', status: 'pass' },
          { id: 'processing', status: 'pass' },
          { id: 'frame-rate', status: 'skipped' },
        ],
        calibration: null,
        diagnosticsJson: '{"kind":"audio-self-test"}',
      };
    },
    save: async (c) => {
      s.saved.push(c);
    },
    hearClick: async () => {
      s.calls.push('hear');
    },
    stopSounds: () => {
      s.stops += 1;
    },
    exportDiagnostics: (j) => {
      s.exported.push(j);
    },
  };
  return s;
}
