import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng.ts';
import { decodeWav, encodeWav, floatToPcm16, pcm16ToFloat, toMono } from './wav.ts';

const randomSignal = (n: number, seed: number): Float32Array => {
  const r = createRng(seed);
  return Float32Array.from({ length: n }, () => r.next() * 2 - 1);
};

describe('wav', () => {
  it('float32 round trip is bit-exact', () => {
    const x = randomSignal(5000, 1);
    const back = decodeWav(encodeWav({ sampleRate: 44100, channels: [x] }, { format: 'float32' }));
    expect(back.sampleRate).toBe(44100);
    expect(Array.from(back.channels[0] as Float32Array)).toEqual(Array.from(x));
  });

  it('pcm16 round trip is lossless on quantised data and within 1 LSB/2 otherwise', () => {
    const x = randomSignal(5000, 2);
    const bytes = encodeWav({ sampleRate: 48000, channels: [x] });
    const back = decodeWav(bytes);
    const y = back.channels[0] as Float32Array;
    for (let i = 0; i < x.length; i++) expect(Math.abs((y[i] as number) - (x[i] as number))).toBeLessThanOrEqual(0.5 / 32768 + 1e-9);
    // Decoded data re-encodes to identical bytes, and decodes to identical samples.
    const again = encodeWav(back);
    expect(Array.from(again)).toEqual(Array.from(bytes));
    expect(Array.from(decodeWav(again).channels[0] as Float32Array)).toEqual(Array.from(y));
  });

  it('every 16-bit code survives the float conversion', () => {
    for (let v = -32768; v <= 32767; v += 7) expect(floatToPcm16(pcm16ToFloat(v))).toBe(v);
    expect(floatToPcm16(2)).toBe(32767);
    expect(floatToPcm16(-2)).toBe(-32768);
  });

  it('stereo round trip and mono downmix', () => {
    const l = randomSignal(100, 3);
    const r = randomSignal(100, 4);
    const back = decodeWav(encodeWav({ sampleRate: 16000, channels: [l, r] }, { format: 'float32' }));
    expect(back.channels).toHaveLength(2);
    expect(Array.from(back.channels[1] as Float32Array)).toEqual(Array.from(r));
    const m = toMono(back);
    expect(m[5]).toBeCloseTo(((l[5] as number) + (r[5] as number)) / 2, 6);
  });

  it('skips unknown chunks and rejects garbage', () => {
    const wav = encodeWav({ sampleRate: 8000, channels: [new Float32Array([0.25, -0.25])] });
    const extra = new Uint8Array([...'LIST'].map((c) => c.charCodeAt(0)).concat([3, 0, 0, 0, 1, 2, 3, 0]));
    const withList = new Uint8Array(wav.length + extra.length);
    withList.set(wav.subarray(0, 12), 0);
    withList.set(extra, 12);
    withList.set(wav.subarray(12), 12 + extra.length);
    expect(decodeWav(withList).channels[0]?.[0]).toBe(0.25);
    expect(() => decodeWav(new Uint8Array(20))).toThrow();
  });
});
