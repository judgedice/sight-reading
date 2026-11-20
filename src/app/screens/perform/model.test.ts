import { describe, expect, it } from 'vitest';
import { copy } from '../../../ui/copy/copy.ts';
import type { FollowerEvent, GhostNote, LiveJudgment } from '../../../core/types.ts';
import {
  barTempoText,
  beatGrouping,
  beatInBar,
  countInBarText,
  countInBeat,
  countInPosition,
  countInTitle,
  entryCount,
  ghostsLiveAt,
  liveEventAllowed,
  meterBars,
  pitchSteps,
  referenceSteps,
  statusMessage,
  stopVariant,
} from './model.ts';

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

  it('lights the strip meter bars from the level', () => {
    expect(meterBars(-60)).toBe(0);
    expect(meterBars(-90)).toBe(0);
    expect(meterBars(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(meterBars(0)).toBe(7);
    expect(meterBars(-30)).toBe(4);
    expect(meterBars(-30.001)).toBe(4);
    expect(meterBars(-55)).toBe(1);
  });

  it('marks the starting pitch steps from the live caption', () => {
    expect(pitchSteps(null)).toEqual({ chord: 'pending', note: 'pending' });
    expect(pitchSteps('key-chord')).toEqual({ chord: 'live', note: 'pending' });
    expect(pitchSteps('first-note')).toEqual({ chord: 'done', note: 'live' });
  });

  it('count-in position and lines: bar 1 listens, the last bar says when to come in (01-ux section 11)', () => {
    const before = countInPosition(0, 4, 2);
    expect(before).toEqual({ bar: 1, bars: 2, beat: 0, last: false });
    const b1 = countInPosition(3, 4, 2);
    const b2 = countInPosition(5, 4, 2);
    expect(b1).toEqual({ bar: 1, bars: 2, beat: 3, last: false });
    expect(b2).toEqual({ bar: 2, bars: 2, beat: 1, last: true });
    expect(countInTitle(b1, 4)).toBe(copy('countIn.listen'));
    expect(countInTitle(b2, 4)).toBe('Come in after 4');
    expect(countInTitle(b1, 4)).not.toBe(countInTitle(b2, 4));
    expect(countInBarText(b1)).toBe('Count-in bar 1 of 2');
    expect(countInBarText(b2)).toBe('Count-in bar 2 of 2');
    expect(countInPosition(1, 3, 1)).toEqual({ bar: 1, bars: 1, beat: 1, last: true });
    expect(countInTitle(countInPosition(1, 3, 1), 3)).toBe('Come in after 3');
  });

  it('starting-pitch steps, and "Count-in next" for the beat after the first note', () => {
    expect(referenceSteps(null, false)).toEqual({ chord: 'pending', note: 'pending', next: false });
    expect(referenceSteps('key-chord', true)).toEqual({ chord: 'live', note: 'pending', next: false });
    expect(referenceSteps('first-note', true)).toEqual({ chord: 'done', note: 'live', next: false });
    expect(referenceSteps('count-in-next', true)).toEqual({ chord: 'done', note: 'done', next: true });
    expect(referenceSteps(null, true)).toEqual({ chord: 'done', note: 'done', next: true });
  });

  it('ghosts live: from difficulty 4 by default, or always, or never (PLAN R61)', () => {
    for (const d of [1, 2, 3]) expect(ghostsLiveAt('from4', d, 3)).toBe(false);
    for (const d of [4, 7, 10]) expect(ghostsLiveAt('from4', d, 3)).toBe(true);
    expect(ghostsLiveAt(undefined, 2, 3)).toBe(false);
    expect(ghostsLiveAt('always', 1, 3)).toBe(true);
    expect(ghostsLiveAt('never', 10, 3)).toBe(false);
  });

  it('live filter: no ghost before bar 1 or when ghosts are off; calm difficulties wait for a sure judgment', () => {
    const ghost: FollowerEvent = { type: 'ghost', ghost: { kind: 'extra' } as GhostNote };
    const sure: FollowerEvent = { type: 'judgment', judgment: { provisional: false } as LiveJudgment };
    const unsure: FollowerEvent = { type: 'judgment', judgment: { provisional: true } as LiveJudgment };
    const clock: FollowerEvent = { type: 'clock', scoreBeat: -2 };
    expect(liveEventAllowed(ghost, { ghosts: true, calm: false, beforeMusic: false })).toBe(true);
    expect(liveEventAllowed(ghost, { ghosts: true, calm: false, beforeMusic: true })).toBe(false);
    expect(liveEventAllowed(ghost, { ghosts: false, calm: true, beforeMusic: false })).toBe(false);
    expect(liveEventAllowed(sure, { ghosts: false, calm: true, beforeMusic: false })).toBe(true);
    expect(liveEventAllowed(unsure, { ghosts: false, calm: true, beforeMusic: false })).toBe(false);
    expect(liveEventAllowed(unsure, { ghosts: true, calm: false, beforeMusic: false })).toBe(true);
    expect(liveEventAllowed(clock, { ghosts: false, calm: true, beforeMusic: true })).toBe(true);
    expect(liveEventAllowed({ type: 'missed', expectedIdx: 0 }, { ghosts: false, calm: true, beforeMusic: false })).toBe(true);
  });

  it('comes in after the last count, or earlier when the first note is in a pickup', () => {
    const meter = { countsPerBar: 4, countUnitTicks: 480 } as never;
    const note = (tick: number) => ({ kind: 'note', tick }) as never;
    expect(entryCount({ meter, pickupTicks: 0, measures: [{ events: [note(0)] }] } as never)).toBe(4);
    expect(entryCount({ meter, pickupTicks: 480, measures: [{ events: [note(0)] }] } as never)).toBe(3);
    expect(entryCount({ meter, pickupTicks: 720, measures: [{ events: [note(0)] }] } as never)).toBe(2);
    expect(entryCount({ meter, pickupTicks: 480, measures: [{ events: [{ kind: 'rest', tick: 0 }, note(480)] }] } as never)).toBe(4);
    expect(countInTitle(countInPosition(5, 4, 2), 3)).toBe('Come in after 3');
  });
});
