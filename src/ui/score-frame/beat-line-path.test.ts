// The beat line's path (PLAN R70): head to head across barlines, steady between heads, one jump only at a system break.
import { describe, expect, it } from 'vitest';
import { beatSpeeds, buildLinePath, linePointAt, type LineAnchor } from './beat-line-path.ts';

/** The five-note scale's heads as the HEAD build drew them at 1440 px: 132 px a beat in a bar, 225 px over a barline. */
const SCALE_HEADS: LineAnchor[] = [
  { beat: 0, system: 0, x: 340 },
  { beat: 1, system: 0, x: 471 },
  { beat: 2, system: 0, x: 603 },
  { beat: 3, system: 0, x: 735 },
  { beat: 4, system: 0, x: 960 },
  { beat: 5, system: 0, x: 1093 },
  { beat: 6, system: 0, x: 1225 },
  { beat: 7, system: 0, x: 1357 },
  { beat: 8, system: 0, x: 1589 },
];
const SCALE_END: LineAnchor[] = [{ beat: 12, system: 0, x: 1830 }];

describe('beat line path', () => {
  const path = buildLinePath(SCALE_HEADS, SCALE_END);

  it('crosses every head exactly at its beat', () => {
    for (const h of SCALE_HEADS) expect(linePointAt(path, h.beat)).toEqual({ system: 0, x: h.x });
  });

  it('goes straight from beat 4 to the next bar\'s first head: no stop before the barline and no jump across it', () => {
    // Fourth beat of bar 1: the line covers 735 -> 960 in one beat, at a constant speed.
    const xs = Array.from({ length: 11 }, (_, i) => linePointAt(path, 3 + i / 10)!.x);
    const steps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const s of steps) expect(s).toBeCloseTo(22.5, 6);
    // Just before and at the downbeat of bar 2 the line is continuous (no jump).
    expect(linePointAt(path, 4)!.x - linePointAt(path, 4 - 1e-6)!.x).toBeLessThan(0.01);
  });

  it('keeps each beat at the speed its two heads give, and beat 4 is never slower than the others', () => {
    const v = beatSpeeds(path, 0, 8);
    expect(v).toEqual([131, 132, 132, 225, 133, 132, 132, 232]);
    // Before R70 the line stopped short of the barline in beat 4 (about half the bar's speed) and jumped across it;
    // now beat 4 carries it to the next bar's first head, so it is the fastest beat, as the wider spacing forces.
    expect(v[3]).toBeGreaterThan(Math.max(...v.slice(0, 3)));
  });

  it('spreads a held note over its beats (a whole note moves a quarter of its distance per beat)', () => {
    const v = beatSpeeds(path, 8, 12);
    for (const s of v) expect(s).toBeCloseTo((1830 - 1589) / 4, 6);
  });

  it('waits at the first head before the music and holds at the end after it', () => {
    expect(linePointAt(path, -4)).toEqual({ system: 0, x: 340 });
    expect(linePointAt(path, 20)).toEqual({ system: 0, x: 1830 });
  });

  it('moves to the next system only at the system break, after reaching the end of the first', () => {
    const heads: LineAnchor[] = [
      { beat: 0, system: 0, x: 100 },
      { beat: 1, system: 0, x: 200 },
      { beat: 2, system: 1, x: 80 },
      { beat: 3, system: 1, x: 180 },
    ];
    const p = buildLinePath(heads, [
      { beat: 2, system: 0, x: 300 },
      { beat: 4, system: 1, x: 280 },
    ]);
    expect(linePointAt(p, 1.5)).toEqual({ system: 0, x: 250 });
    expect(linePointAt(p, 2 - 1e-9)!.system).toBe(0);
    expect(linePointAt(p, 2)).toEqual({ system: 1, x: 80 });
    expect(beatSpeeds(p, 0, 4)).toEqual([100, 100, 100, 100]);
  });

  it('never goes back: a head left of the one before it is dropped', () => {
    const p = buildLinePath(
      [
        { beat: 0, system: 0, x: 100 },
        { beat: 1, system: 0, x: 90 },
        { beat: 2, system: 0, x: 300 },
      ],
      [],
    );
    expect(p.map((a) => a.beat)).toEqual([0, 2]);
    expect(linePointAt(p, 1)!.x).toBe(200);
  });
});
