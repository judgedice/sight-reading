// Diagnostics per try (round 2 detection): the device-local ring of traces and the audio encoding.
import { describe, expect, it } from 'vitest';
import { MemoryKv } from '../store/test-data.ts';
import { isReservedKvKey } from '../store/index.ts';
import { DIAG_AUDIO_KEEP, DIAG_KEEP, DiagnosticsStore, decodePcm16, encodePcm16, TRACE_FORMAT, type TryTrace } from './diagnostics.ts';

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
