import { describe, expect, it } from 'vitest';
import type { SessionState } from '../../../core/types.ts';
import { interruptionPolicy, type InterruptionEvent, type PolicyAction } from './interruption.ts';

const STATES: SessionState[] = ['idle', 'loading', 'covered', 'scanning', 'count-in', 'performing', 'finishing', 'results', 'error'];
const TAKE: SessionState[] = ['count-in', 'performing'];

const EVENTS: { name: string; ev: InterruptionEvent }[] = [
  { name: 'hidden', ev: { type: 'hidden' } },
  { name: 'pagehide', ev: { type: 'pagehide' } },
  { name: 'freeze', ev: { type: 'freeze' } },
  { name: 'context-interrupted', ev: { type: 'context-interrupted' } },
  { name: 'suspended (unrequested)', ev: { type: 'context-suspended', requested: false } },
  { name: 'suspended (requested)', ev: { type: 'context-suspended', requested: true } },
  { name: 'track-mute', ev: { type: 'track-mute' } },
  { name: 'track-ended', ev: { type: 'track-ended' } },
  { name: 'device-change (key changed)', ev: { type: 'device-change', keyChanged: true } },
  { name: 'device-change (same key)', ev: { type: 'device-change', keyChanged: false } },
  { name: 'idle-timeout', ev: { type: 'idle-timeout' } },
  { name: 'left-practice', ev: { type: 'left-practice' } },
];

const voidOf = (reason: 'interrupted' | 'device-change', stopTracks: boolean, countsAsSkip: boolean): PolicyAction => ({
  kind: 'void', reason, burnExcerpt: true, countsAsSkip, stopTracks, requireGesture: true,
});

/** The expected action, written out per event (independent of the implementation's structure). */
function expected(state: SessionState, name: string, firstNote: boolean): PolicyAction {
  const take = TAKE.includes(state);
  switch (name) {
    case 'hidden':
    case 'pagehide':
    case 'freeze':
      return take ? voidOf('interrupted', true, firstNote) : { kind: 'close-audio' };
    case 'context-interrupted':
    case 'track-mute':
      return take ? voidOf('interrupted', false, firstNote) : { kind: 'ignore' };
    case 'suspended (unrequested)':
      return take ? voidOf('interrupted', false, firstNote) : { kind: 'ignore' };
    case 'suspended (requested)':
      return { kind: 'ignore' };
    case 'track-ended':
      return take ? voidOf('interrupted', true, firstNote) : { kind: 'ignore' };
    case 'device-change (key changed)':
      return take ? voidOf('device-change', false, firstNote) : { kind: 'stale-calibration' };
    case 'device-change (same key)':
      return take ? voidOf('device-change', false, firstNote) : { kind: 'ignore' };
    case 'idle-timeout':
      return state === 'results' ? { kind: 'close-audio' } : { kind: 'ignore' };
    case 'left-practice':
      return { kind: 'close-audio' };
  }
  throw new Error(name);
}

describe('interruptionPolicy: every event in every session state (IOS2, W2, W4, W7)', () => {
  for (const state of STATES) {
    for (const { name, ev } of EVENTS) {
      for (const firstNote of [false, true]) {
        it(`${state} / ${name} / firstNotePlayed=${firstNote}`, () => {
          expect(interruptionPolicy({ session: state, firstNotePlayed: firstNote }, ev)).toEqual(expected(state, name, firstNote));
        });
      }
    }
  }

  it('a void always burns the excerpt and requires a gesture', () => {
    for (const state of TAKE) {
      for (const { ev } of EVENTS) {
        const a = interruptionPolicy({ session: state }, ev);
        if (a.kind === 'void') {
          expect(a.burnExcerpt).toBe(true);
          expect(a.requireGesture).toBe(true);
        }
      }
    }
  });

  it('countsAsSkip is true only after the first played note (R33)', () => {
    const before = interruptionPolicy({ session: 'performing', firstNotePlayed: false }, { type: 'hidden' });
    const after = interruptionPolicy({ session: 'performing', firstNotePlayed: true }, { type: 'hidden' });
    expect(before.kind === 'void' && before.countsAsSkip).toBe(false);
    expect(after.kind === 'void' && after.countsAsSkip).toBe(true);
  });

  it('is pure: the same input gives the same output and the inputs are not mutated', () => {
    const state = { session: 'performing' as const, firstNotePlayed: true };
    const ev: InterruptionEvent = { type: 'track-mute' };
    const frozen = JSON.stringify([state, ev]);
    expect(interruptionPolicy(state, ev)).toEqual(interruptionPolicy(state, ev));
    expect(JSON.stringify([state, ev])).toBe(frozen);
  });
});
