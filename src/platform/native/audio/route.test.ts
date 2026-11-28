import { describe, expect, it } from 'vitest';
import { routeKeyOf } from '../../shared/audio/route.ts';
import type { LatencyReport, OpenInfo } from './ipc.ts';
import { inputKindOfTransport, nativeAudioRoute, nativeRouteKey } from './route.ts';

const latency = (over: Partial<LatencyReport> = {}): LatencyReport => ({
  outputSec: 0.02, inputSec: 0.01, trust: 'A',
  parts: { outBuffer: null, outDevice: null, outSafety: null, outStream: null, inBuffer: null, inDevice: null, inSafety: null, inStream: null },
  ...over,
});

const info = (over: Partial<Pick<OpenInfo, 'engineRate' | 'outFrames' | 'inFrames' | 'inputRate'>> = {}) => ({
  engineRate: 48000, outFrames: 128, inFrames: 128 as number | null, inputRate: 48000 as number | null,
  route: { inputUid: 'in-1', outputUid: 'out-1', inputTransport: 'built-in' as const, outputTransport: 'built-in' as const, processing: { echoCancellation: false, noiseSuppression: null, autoGainControl: false } },
  latency: latency(), ...over,
});

describe('native route key', () => {
  it('is routeKeyOf(inputUid>outputUid@inFrames/outFrames, outputMode, engineRate, osFamily)', () => {
    expect(nativeRouteKey({ inputUid: 'a', outputUid: 'b' }, { inFrames: 256, outFrames: 128 }, 'wired', 44100, 'macos')).toBe(routeKeyOf('a>b@256/128', 'wired', 44100, 'macos'));
  });

  it('changes with each of its parts', () => {
    const k = (over: Parameters<typeof info>[0], mode: 'speakers' | 'wired' = 'speakers', os: 'linux' | 'macos' = 'linux') => nativeAudioRoute(info(over), mode, os).routeKey;
    const keys = [k({}), k({ outFrames: 256 }), k({ inFrames: 256 }), k({ engineRate: 44100 }), k({}, 'wired'), k({}, 'speakers', 'macos'), nativeAudioRoute({ ...info(), route: { ...info().route, inputUid: 'in-2' } }, 'speakers', 'linux').routeKey];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is the same for the same device and buffers on every call', () => {
    expect(nativeAudioRoute(info(), 'speakers', 'linux').routeKey).toBe(nativeAudioRoute(info(), 'speakers', 'linux').routeKey);
  });
});

describe('native route record', () => {
  it('maps transports to input kinds (Bluetooth from the transport only)', () => {
    expect(inputKindOfTransport('built-in')).toBe('built-in');
    expect(inputKindOfTransport('wired')).toBe('wired');
    expect(inputKindOfTransport('usb')).toBe('usb-interface');
    expect(inputKindOfTransport('bluetooth')).toBe('bluetooth');
    for (const t of ['hdmi', 'network', 'unknown'] as const) expect(inputKindOfTransport(t)).toBe('unknown');
  });

  it('reports the output latency for trust A and B, not for C, not when absent', () => {
    expect(nativeAudioRoute(info(), 'speakers', 'linux').reportedLatencySec).toBe(0.02);
    expect(nativeAudioRoute(info({}), 'speakers', 'linux').reportedLatencySec).toBe(0.02);
    expect(nativeAudioRoute({ ...info(), latency: latency({ trust: 'B' }) }, 'speakers', 'linux').reportedLatencySec).toBe(0.02);
    expect('reportedLatencySec' in nativeAudioRoute({ ...info(), latency: latency({ trust: 'C' }) }, 'speakers', 'linux')).toBe(false);
    expect('reportedLatencySec' in nativeAudioRoute({ ...info(), latency: latency({ outputSec: null }) }, 'speakers', 'linux')).toBe(false);
  });

  it('carries the processing flags (null where the OS does not say), the rate and the input rate', () => {
    const r = nativeAudioRoute(info({ inputRate: null, inFrames: null }), 'bluetooth', 'android');
    expect(r.appliedProcessing).toEqual({ echoCancellation: false, noiseSuppression: null, autoGainControl: false });
    expect(r.sampleRate).toBe(48000);
    expect(r.trackSampleRate).toBeNull();
    expect(r.outputMode).toBe('bluetooth');
    expect(r.routeKeyAliases).toEqual([r.routeKey]);
  });
});
