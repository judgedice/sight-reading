import { describe, expect, it } from 'vitest';
import type { ExcerptSource, KeySig } from '../../../core/types.ts';
import { fixtureDoc } from '../../../notation/testing/corpus-node.ts';
import { testExcerpt } from './test-support.tsx';
import {
  STARS_ORDER,
  activeRow,
  autoTickedCount,
  creditLine,
  extremeIds,
  formatClock,
  isTicked,
  signatureDetail,
  signatureNotes,
  sourceLine,
  startingInSeconds,
  writtenAccidentalIds,
  type StarsId,
} from './model.ts';

const k = (fifths: number, mode: 'major' | 'minor' = 'major'): KeySig => ({ fifths, mode });

describe('scan model', () => {
  it('lists the altered letters of a signature in order', () => {
    expect(signatureNotes(k(4))).toEqual(['F♯', 'C♯', 'G♯', 'D♯']);
    expect(signatureNotes(k(-2))).toEqual(['B♭', 'E♭']);
    expect(signatureNotes(k(0))).toEqual([]);
  });

  it('writes the Signatures detail, and drops the colon for C major', () => {
    const e4 = testExcerpt({ writtenKey: k(4), meter: { beats: 6, beatType: 8, countUnitTicks: 36, countsPerBar: 2 } });
    expect(signatureDetail(e4)).toBe('E major, 4 sharps: F♯ C♯ G♯ D♯. 6/8, felt in 2.');
    const c = testExcerpt({ writtenKey: k(0) });
    expect(signatureDetail(c)).toBe('C major, 0 sharps. 4/4, felt in 4.');
  });

  it('finds written accidentals against the key signature and in-bar memory', () => {
    const base = testExcerpt({ writtenKey: k(0) });
    const note = (id: string, step: 'F' | 'G', alter: -1 | 0 | 1, extra = {}) => ({ kind: 'note', id, tick: 0, durTicks: 12, writtenPitch: { step, alter, octave: 4 }, concertPitch: { step, alter, octave: 4 }, ...extra }) as never;
    const p = {
      ...base,
      measures: [
        { index: 0, isPickup: false, startTick: 0, displayBar: 1, events: [note('a', 'F', 1), note('b', 'F', 1), note('c', 'F', 0), note('d', 'G', 0)] },
        { index: 1, isPickup: false, startTick: 48, displayBar: 2, events: [note('e', 'F', 1)] },
      ],
    };
    // a: sharp (shown); b: same sharp again, remembered; c: natural cancels it (shown); d: plain; e: new bar, shown again.
    expect(writtenAccidentalIds(p)).toEqual(['a', 'c', 'e']);
    const inD = { ...p, writtenKey: k(2) };
    // F# is in the key: a and b show nothing; c is a natural (shown); e is F# again (nothing).
    expect(writtenAccidentalIds(inD)).toEqual(['c']);
  });

  it('never repeats the sign on a tie continuation', () => {
    const base = testExcerpt({ writtenKey: k(0) });
    const n = (id: string, tieStop?: true) => ({ kind: 'note', id, tick: 0, durTicks: 12, writtenPitch: { step: 'F', alter: 1, octave: 4 }, concertPitch: { step: 'F', alter: 1, octave: 4 }, ...(tieStop ? { tieStop } : {}) }) as never;
    const p = { ...base, measures: [{ index: 0, isPickup: false, startTick: 0, displayBar: 1, events: [n('a')] }, { index: 1, isPickup: false, startTick: 48, displayBar: 2, events: [n('b', true)] }] };
    expect(writtenAccidentalIds(p)).toEqual(['a']);
  });

  it('extremes are the high and low notes, once when they coincide', () => {
    const e = testExcerpt();
    expect(extremeIds({ ...e, extremes: { highId: 'h', lowId: 'l' } })).toEqual(['h', 'l']);
    expect(extremeIds({ ...e, extremes: { highId: 'x', lowId: 'x' } })).toEqual(['x']);
  });

  it('ticks a row every fifth of the scan time (30 s: every 6 s)', () => {
    expect(autoTickedCount(30, 30)).toBe(0);
    expect(autoTickedCount(24, 30)).toBe(1);
    expect(autoTickedCount(23.9, 30)).toBe(1);
    expect(autoTickedCount(12, 30)).toBe(3);
    expect(autoTickedCount(0, 30)).toBe(5);
    expect(autoTickedCount(5, 0)).toBe(0);
  });

  it('a manual choice beats the clock, and the active row is the first unticked', () => {
    const manual = new Map<StarsId, boolean>([['signatures', false], ['rhythms', true]]);
    expect(isTicked(0, 3, manual)).toBe(false);
    expect(isTicked(1, 3, manual)).toBe(true);
    expect(isTicked(3, 0, manual)).toBe(true);
    expect(activeRow(3, manual)).toBe('signatures');
    expect(activeRow(5, new Map())).toBeNull();
    expect(STARS_ORDER).toHaveLength(5);
  });

  it('says "Starting in N" only in the last 5 s of a ranked scan', () => {
    expect(startingInSeconds('ranked', 5)).toBe(5);
    expect(startingInSeconds('ranked', 4.2)).toBe(5);
    expect(startingInSeconds('ranked', 1)).toBe(1);
    expect(startingInSeconds('ranked', 6)).toBeNull();
    expect(startingInSeconds('ranked', 0)).toBeNull();
    expect(startingInSeconds('practice', 3)).toBeNull();
  });

  it('formats clock times, credit lines and the CC BY source line', () => {
    expect(formatClock(30)).toBe('0:30');
    expect(formatClock(75)).toBe('1:15');
    const src = fixtureDoc('holmes-lc5855050-voice-m1-8').source;
    const pd: ExcerptSource = { ...src, composer: 'Schubert', composerDates: '1797–1828', work: 'Heidenröslein', catalog: 'D 257', sourceMeasures: [1, 8], license: 'CC0-1.0' };
    expect(creditLine(pd)).toBe('Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC0');
    expect(sourceLine(pd)).toBeNull();
    expect(sourceLine({ ...pd, license: 'CC-BY-4.0', encoder: 'A. Encoder', corpus: 'openscore-lieder' })).toBe('Typeset by A. Encoder · openscore-lieder · CC BY 4.0');
    expect(creditLine({ ...pd, composerDates: undefined as never })).not.toContain('()');
  });
});
