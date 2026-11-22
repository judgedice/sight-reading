// PLAN R71: a heard wrong note is drawn on its own letter when the key has it.
import { describe, expect, it } from 'vitest';
import type { GhostNote } from '../core/types.ts';
import { heardOnItsLetter } from './heard-spelling.ts';

const g = (kind: GhostNote['kind'], step: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B', alter: -1 | 0 | 1, octave = 3): GhostNote => ({
  detectedId: 1,
  scoreBeat: 2,
  writtenPitch: { step, alter, octave },
  kind,
  centsError: null,
  targetExpectedIdx: 2,
  displaced: false,
});

describe('heardOnItsLetter', () => {
  it('E3 sung as F3 in C major (spelled E#3 by the follower) is drawn as F3', () => {
    expect(heardOnItsLetter(g('wrong-pitch', 'E', 1), { fifths: 0 }).writtenPitch).toEqual({ step: 'F', alter: 0, octave: 3 });
  });

  it('B2 sung as C3 (spelled B#2) is drawn as C3, the next octave', () => {
    expect(heardOnItsLetter(g('wrong-pitch', 'B', 1, 2), { fifths: 0 }).writtenPitch).toEqual({ step: 'C', alter: 0, octave: 3 });
  });

  it('uses the key: F#3 in G major stays F#3; G3 sung as F#3 in G major (spelled Gb3) is drawn as F#3', () => {
    expect(heardOnItsLetter(g('wrong-pitch', 'F', 1), { fifths: 1 }).writtenPitch).toEqual({ step: 'F', alter: 1, octave: 3 });
    expect(heardOnItsLetter(g('wrong-pitch', 'G', -1), { fifths: 1 }).writtenPitch).toEqual({ step: 'F', alter: 1, octave: 3 });
  });

  it('keeps the follower spelling for a pitch outside the key (E3 sung as Eb3 in C major stays Eb3)', () => {
    expect(heardOnItsLetter(g('wrong-pitch', 'E', -1), { fifths: 0 }).writtenPitch).toEqual({ step: 'E', alter: -1, octave: 3 });
  });

  it('leaves sharp, flat, octave, timing and extra ghosts as they are', () => {
    for (const k of ['sharp', 'flat', 'octave', 'early', 'late', 'extra'] as const) {
      expect(heardOnItsLetter(g(k, 'E', 1), { fifths: 0 }).writtenPitch).toEqual({ step: 'E', alter: 1, octave: 3 });
    }
  });
});
