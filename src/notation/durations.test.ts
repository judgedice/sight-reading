import { describe, expect, it } from 'vitest';
import { isBeamable, singleDuration, splitDuration, vexDuration, writtenTicks } from './durations.ts';

describe('durations', () => {
  it('maps single-glyph lengths', () => {
    expect(vexDuration(singleDuration(480)!, false)).toBe('q');
    expect(vexDuration(singleDuration(720)!, false)).toBe('qd');
    expect(vexDuration(singleDuration(840)!, false)).toBe('qdd');
    expect(vexDuration(singleDuration(1440)!, true)).toBe('hdr');
    expect(vexDuration(singleDuration(1920)!, false)).toBe('w');
    expect(vexDuration(singleDuration(3840)!, false)).toBe('1/2');
    expect(vexDuration(singleDuration(120)!, false)).toBe('16');
    expect(vexDuration(singleDuration(360)!, false)).toBe('8d');
    expect(singleDuration(600)).toBeNull();
  });

  it('splits lengths that need ties, summing exactly', () => {
    for (const t of [600, 1200, 2400, 1800, 270, 4800]) {
      const parts = splitDuration(t);
      expect(parts.reduce((a, p) => a + p.ticks, 0)).toBe(t);
      expect(parts.length).toBeGreaterThan(1);
      for (let i = 1; i < parts.length; i++) expect(parts[i]!.ticks).toBeLessThanOrEqual(parts[i - 1]!.ticks);
    }
    expect(splitDuration(600).map((p) => vexDuration(p, false))).toEqual(['q', '16']);
  });

  it('rejects non-positive lengths and rounds off-grid ones to the 64th grid', () => {
    expect(() => splitDuration(0)).toThrow(RangeError);
    expect(splitDuration(481).reduce((a, p) => a + p.ticks, 0)).toBe(480);
  });

  it('tuplets are written at the notated value', () => {
    expect(writtenTicks(160, { actual: 3, normal: 2 })).toBe(240);
    expect(writtenTicks(480)).toBe(480);
  });

  it('beams eighths and shorter only', () => {
    expect(isBeamable(singleDuration(240)!)).toBe(true);
    expect(isBeamable(singleDuration(360)!)).toBe(true);
    expect(isBeamable(singleDuration(480)!)).toBe(false);
  });
});
