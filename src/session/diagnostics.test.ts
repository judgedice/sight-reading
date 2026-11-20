// Diagnostics per try (round 2 detection): the device-local ring of traces and the audio encoding.
import { describe, expect, it } from 'vitest';
import { MemoryKv } from '../store/test-data.ts';
import { isReservedKvKey } from '../store/index.ts';
import {
  DIAG_AUDIO_KEEP,
  DIAG_KEEP,
  DiagnosticsStore,
  decodePcm16,
  diagnosticsFileName,
  encodePcm16,
  localStamp,
  recentDiagnosticsFileName,
  TRACE_FORMAT,
  type TryTrace,
} from './diagnostics.ts';

const trace = (id: string, audio: boolean): TryTrace =>
  ({ format: TRACE_FORMAT, version: 1, attemptId: id, ...(audio ? { audio: { rate: 16000, startT: 0, encoding: 'pcm16le-base64', samples: 2, data: encodePcm16(Float32Array.of(0.5, -0.5)) } } : {}) }) as unknown as TryTrace;

describe('DiagnosticsStore', () => {
  it('keeps the last DIAG_KEEP traces, and audio only on the newest DIAG_AUDIO_KEEP', async () => {
    const kv = new MemoryKv();
    const s = new DiagnosticsStore(kv);
    expect(await s.settings()).toEqual({ includeAudio: false });
    for (let i = 0; i < DIAG_KEEP + 5; i++) await s.put(trace(`a${i}`, true));
    const ids = await s.ids();
    expect(ids).toHaveLength(DIAG_KEEP);
    expect(ids[0]).toBe('a5');
    expect((await s.last())?.attemptId).toBe(`a${DIAG_KEEP + 4}`);
    expect(await s.get('a0')).toBeNull();
    const withAudio = [];
    for (const id of ids) if ((await s.get(id))?.audio) withAudio.push(id);
    expect(withAudio).toEqual(ids.slice(-DIAG_AUDIO_KEEP));
    // Device-local: never exported in a backup, kept on import.
    for (const k of await kv.keys()) expect(isReservedKvKey(k)).toBe(true);
  });

  it('the opt-in setting is stored and read back', async () => {
    const s = new DiagnosticsStore(new MemoryKv());
    await s.setSettings({ includeAudio: true });
    expect(await s.settings()).toEqual({ includeAudio: true });
  });
});

describe('PCM16 base64', () => {
  it('round-trips to within one 16-bit step at every length', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 1000]) {
      const x = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) * 0.9);
      const y = decodePcm16(encodePcm16(x), n);
      expect(y.length).toBe(n);
      for (let i = 0; i < n; i++) expect(Math.abs((y[i] as number) - (x[i] as number))).toBeLessThan(1 / 32000);
    }
  });
});

describe('diagnostics file names (round 2, 01-ux.md §15.4)', () => {
  it('local time: sightread-try-{yyyy-mm-dd}-{hhmm} from the start, sightread-tries-... from the export', () => {
    expect(localStamp('2026-11-18T23:07:59.000Z', 0)).toBe('2026-11-18-2307');
    // 60 minutes behind UTC is UTC-1; -60 is UTC+1 (as Date#getTimezoneOffset gives them).
    expect(localStamp('2026-11-18T23:07:59.000Z', -60)).toBe('2026-11-19-0007');
    expect(localStamp('2026-01-01T00:30:00.000Z', 60)).toBe('2025-12-31-2330');
    expect(diagnosticsFileName({ createdAt: '2026-11-18T09:05:00.000Z', startedAt: '2026-11-18T09:04:10.000Z' }, 0)).toBe('sightread-try-2026-11-18-0904.json');
    expect(diagnosticsFileName({ createdAt: '2026-11-18T09:05:00.000Z' }, 0)).toBe('sightread-try-2026-11-18-0905.json');
    expect(recentDiagnosticsFileName('2026-11-18T09:05:00.000Z', 0)).toBe('sightread-tries-2026-11-18-0905.json');
    // The device's own offset by default.
    expect(diagnosticsFileName({ createdAt: '2026-11-18T09:05:00.000Z' })).toMatch(/^sightread-try-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    expect(() => localStamp('yesterday')).toThrow(RangeError);
  });

  it('all() returns every stored trace, oldest first', async () => {
    const s = new DiagnosticsStore(new MemoryKv());
    expect(await s.all()).toEqual([]);
    for (const id of ['a', 'b', 'c']) await s.put(trace(id, false));
    expect((await s.all()).map((t) => t.attemptId)).toEqual(['a', 'b', 'c']);
  });
});
