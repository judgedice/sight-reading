import { describe, expect, it } from 'vitest';
import { copy } from '../../../ui/copy/copy.ts';
import { barTempoText, beatGrouping, beatInBar, countInBeat, meterStep, statusMessage, stopVariant } from './model.ts';

describe('performance model', () => {
  it('maps score beats and count-in clicks to a beat of the bar', () => {
    expect(beatInBar(0, 4)).toBe(1);
    expect(beatInBar(3.9, 4)).toBe(4);
    expect(beatInBar(4, 4)).toBe(1);
    expect(beatInBar(-1, 4)).toBe(4);
    expect(countInBeat(1, 4)).toBe(1);
    expect(countInBeat(4, 4)).toBe(4);
    expect(countInBeat(5, 4)).toBe(1);
  });

  it('groups 5/8 and 7/8 by beaming and leaves other meters alone', () => {
    expect(beatGrouping(5, 8, 5)).toEqual([3, 2]);
    expect(beatGrouping(7, 8, 7)).toEqual([2, 2, 3]);
    expect(beatGrouping(6, 8, 2)).toBeUndefined();
    expect(beatGrouping(4, 4, 4)).toBeUndefined();
  });

  it('says one thing at a time, highest priority first', () => {
    const base = { state: 'performing' as const, bar: 4, totalBars: 10 };
    expect(statusMessage({ ...base, status: null })).toBe(copy('play.status.bar', { n: 4, total: 10 }));
    expect(statusMessage({ ...base, state: 'count-in', status: null })).toBe(copy('play.status.countIn'));
    expect(statusMessage({ ...base, state: 'count-in', status: { kind: 'restarting-count-in', reason: 'rotation' } })).toBe(copy('play.status.restartCountIn'));
    expect(statusMessage({ ...base, status: { kind: 'come-in-at', bar: 6 } })).toBe(copy('play.status.comeIn', { n: 6 }));
    expect(statusMessage({ ...base, status: { kind: 'lost-place' } })).toBe(copy('play.status.lostPlace'));
    expect(statusMessage({ ...base, status: { kind: 'no-signal' } })).toBe(copy('play.status.noSignal'));
    // The pickup (bar 0) reads as bar 1.
    expect(statusMessage({ ...base, bar: 0, status: null })).toBe(copy('play.status.bar', { n: 1, total: 10 }));
  });

  it('writes "Bar 4 · ♩ = 92" with the compound unit for 6/8', () => {
    expect(barTempoText(4, '4/4', 92)).toBe('Bar 4 · ♩ = 92');
    expect(barTempoText(1, '6/8', 60)).toBe('Bar 1 · ♩. = 60');
  });

  it('picks the stop confirm per 04 section 5.10', () => {
    expect(stopVariant('practice', true, false)).toBe('practice');
    expect(stopVariant('ranked', true, false)).toBe('ranked-before-note');
    expect(stopVariant('ranked', true, true)).toBe('ranked-after-note');
    expect(stopVariant('ranked', false, false)).toBe('ranked-after-note');
  });

  it('quantises the meter to its 64 px', () => {
    expect(meterStep(-60)).toBe(0);
    expect(meterStep(0)).toBe(64);
    expect(meterStep(-30)).toBe(32);
    expect(meterStep(-30.1)).toBe(32);
    expect(meterStep(-90)).toBe(0);
  });
});
