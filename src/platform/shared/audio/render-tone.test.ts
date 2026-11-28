import { describe, expect, it } from 'vitest';
import { renderTone } from './render-tone.ts';

describe('renderTone', () => {
  it('has the requested length, silent first sample and peak bounded by the amplitude', () => {
    const d = renderTone(1000, 0.1, 48000, 0.5);
    expect(d.length).toBe(4800);
    expect(d[0]).toBe(0);
    let max = 0;
    for (const v of d) max = Math.max(max, Math.abs(v));
    expect(max).toBeGreaterThan(0.49);
    expect(max).toBeLessThanOrEqual(0.5);
  });

  it('fades in and out over 10 ms and is a full-level sine between', () => {
    const sr = 48000;
    const d = renderTone(440, 0.2, sr, 0.5);
    const fade = 480;
    expect(Math.abs(d[fade / 2] ?? 0)).toBeLessThan(0.5 * Math.abs(Math.sin((2 * Math.PI * 440 * (fade / 2)) / sr)) + 1e-6);
    const i = 2400;
    expect(d[i]).toBeCloseTo(0.5 * Math.sin((2 * Math.PI * 440 * i) / sr), 6);
    expect(Math.abs(d[d.length - 1] ?? 1)).toBeLessThan(1e-3);
  });

  it('never renders fewer than one sample', () => {
    expect(renderTone(440, 0, 48000, 0.5).length).toBe(1);
  });
});
