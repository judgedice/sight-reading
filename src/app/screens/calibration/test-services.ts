// Test-only fakes for the calibration services (not shipped).
import type { PlatformCapabilities } from '../../../core/platform.ts';
import type { AudioRouteInfo, Calibration } from '../../../core/types.ts';
import type { AudioPrefs, CalibrationServices, CalPlan, LoopbackOutcome, PlayAlongOutcome, SelfTestOutcome } from './services.ts';

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

/** The plans `calibrationPlan` gives for the shipped budget (10 + 6 clicks, tone, 4-beat count-in; 8 play-along clicks). */
export const speakerPlan = (): CalPlan => ({
  stages: [
    { id: 'timing', sounds: 10, accented: 0 },
    { id: 'template', sounds: 6, accented: 0 },
    { id: 'pitch', sounds: 1, accented: 0 },
    { id: 'count-in', sounds: 4, accented: 1 },
  ],
  skipped: [],
  seconds: 15,
});
export const headphonePlan = (): CalPlan => ({ stages: [{ id: 'play-along', sounds: 8, accented: 0 }], skipped: ['timing', 'template', 'pitch', 'count-in'], seconds: 10 });

export const checksSpeakers = (over: Partial<Record<SelfTestOutcome['items'][number]['id'], 'pass' | 'fail' | 'skipped'>> = {}): SelfTestOutcome => {
  const items: SelfTestOutcome['items'] = [
    { id: 'sanity-tone', status: 'pass', reason: null },
    { id: 'clicks', status: 'pass', reason: null },
    { id: 'recheck', status: 'pass', reason: null },
    { id: 'clock-rate', status: 'pass', reason: null },
    { id: 'processing', status: 'pass', reason: null },
    { id: 'frame-rate', status: 'skipped', reason: 'no-probe' },
  ].map((i) => (over[i.id as keyof typeof over] ? { ...i, status: over[i.id as keyof typeof over] as 'pass' | 'fail' | 'skipped' } : i)) as SelfTestOutcome['items'];
  return { passed: items.every((i) => i.status !== 'fail'), items, diagnosticsJson: '{"kind":"audio-self-test"}' };
};
export const checksHeadphones = (): SelfTestOutcome => ({
  passed: true,
  items: [
    { id: 'sanity-tone', status: 'skipped', reason: 'headphones' },
    { id: 'clicks', status: 'skipped', reason: 'headphones' },
    { id: 'recheck', status: 'skipped', reason: 'headphones' },
    { id: 'clock-rate', status: 'pass', reason: null },
    { id: 'processing', status: 'pass', reason: null },
    { id: 'frame-rate', status: 'skipped', reason: 'no-probe' },
  ],
  diagnosticsJson: '{"kind":"audio-self-test"}',
});

export const loopbackOk = (over: Partial<LoopbackOutcome> = {}): LoopbackOutcome => ({ accepted: true, failure: null, rtlMs: 42, madMs: 2, clicksFound: 10, clicksScheduled: 10, aecSuspected: false, calibration: cal(), checks: checksSpeakers(), ...over });
export const loopbackBad = (): LoopbackOutcome => ({ accepted: false, failure: 'too-few-clicks', rtlMs: null, madMs: null, clicksFound: 2, clicksScheduled: 10, aecSuspected: false, calibration: null, checks: checksSpeakers({ clicks: 'fail', 'sanity-tone': 'fail', recheck: 'fail' }) });
export const playAlongOk = (over: Partial<PlayAlongOutcome> = {}): PlayAlongOutcome => ({
  accepted: true, failure: null, rtlMs: 60, madMs: 8, notesFound: 8, clicks: 8, offsetsMs: [60, 70, 50, 60, 65, 55, 60, 60], calibration: cal({ method: 'play-along', outputMode: 'wired' }), checks: checksHeadphones(), ...over,
});
export const playAlongBad = (): PlayAlongOutcome => ({ accepted: false, failure: 'too-few-notes', rtlMs: null, madMs: null, notesFound: 1, clicks: 8, offsetsMs: [null, null, null, null, null, null, null, 60], calibration: null, checks: checksHeadphones() });

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
    plan: (mode) => (mode === 'speakers' ? speakerPlan() : headphonePlan()),
    clickSound: () => 'classic',
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
      // The first stage and its first click, as the real run reports them.
      x.onStage('timing');
      x.onSound('timing', 0);
      x.onClick(0, true);
      return loopback.shift() ?? loopbackBad();
    },
    runPlayAlong: async (x) => {
      s.calls.push('playalong');
      x.onStage('play-along');
      return playAlong.shift() ?? playAlongBad();
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
