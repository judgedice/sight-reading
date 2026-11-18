import { describe, expect, it } from 'vitest';
import { configs } from '../../fixtures/follow/gen/io.ts';
import {
  bandFor, betaInstruments, clefsAt, detectionRange, getInstrument, launchInstruments, listInstruments,
  tierForLevel, transposition, voiceTypes, writtenToConcert,
} from './index.ts';

const cfg = configs();

describe('instruments', () => {
  it('maps levels to tiers two at a time', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(tierForLevel).join('')).toBe('AABBCCDDEE');
    for (const l of cfg.levels.levels) expect(tierForLevel(l.level)).toBe(l.tier);
    expect(() => tierForLevel(0)).toThrow(RangeError);
    expect(() => tierForLevel(11)).toThrow(RangeError);
  });
  it('looks up instruments and throws on unknown ids', () => {
    expect(getInstrument(cfg, 'flute').id).toBe('flute');
    expect(() => getInstrument(cfg, 'kazoo')).toThrow(RangeError);
  });
  it('splits launch and beta lists', () => {
    const launch = launchInstruments(cfg);
    expect(launch.length).toBe(listInstruments(cfg, { includeBeta: false }).length);
    expect(launch.every((i) => i.status === 'launch')).toBe(true);
    const all = listInstruments(cfg, { includeBeta: true });
    expect(all.length).toBe(launch.length + betaInstruments(cfg).length);
    expect(all.length).toBe(cfg.instruments.instruments.length);
  });
  it('returns the tier band and a fresh array', () => {
    const fl = getInstrument(cfg, 'flute');
    expect(bandFor(fl, 1)).toEqual(fl.tiers.A);
    expect(bandFor(fl, 10)).toEqual(fl.tiers.E);
    expect(bandFor(fl, 1)).not.toBe(fl.tiers.A);
  });
  it('bands widen monotonically with level', () => {
    for (const i of listInstruments(cfg, { includeBeta: true })) {
      let prev = bandFor(i, 1);
      for (let l = 2; l <= 10; l++) {
        const b = bandFor(i, l);
        expect(b[0]).toBeLessThanOrEqual(prev[0]);
        expect(b[1]).toBeGreaterThanOrEqual(prev[1]);
        prev = b;
      }
    }
  });
  it('lists clefs primary first, gated by level', () => {
    for (const i of listInstruments(cfg, { includeBeta: true })) {
      const c = clefsAt(i, 10);
      expect(c[0]).toBe(i.clefs[0]!.clef);
      expect(clefsAt(i, 1)).toContain(i.clefs[0]!.clef);
    }
  });
  it('exposes transposition, detection range and voice types', () => {
    expect(transposition(getInstrument(cfg, 'clarinet-bb')).chromatic).toBe(2);
    expect(writtenToConcert(getInstrument(cfg, 'clarinet-bb'), 62)).toBe(60);
    const [lo, hi] = detectionRange(getInstrument(cfg, 'voice-soprano'));
    expect(lo).toBeLessThan(hi);
    expect(voiceTypes(cfg).length).toBeGreaterThanOrEqual(4);
    expect(voiceTypes(cfg).every((v) => v.family === 'voice')).toBe(true);
  });
});
