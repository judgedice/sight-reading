import { describe, expect, it } from 'vitest';
import { appConfigs } from '../../compose/configs.ts';
import { initialMatchState, type MatchState } from './model.ts';
import { heardStaff, hintLine, needleView, neighbourVoice, rangeChips, readName, settledLine, settledMidi, summaryLine, youLine } from './view.ts';

const cfg = appConfigs();
const inst = (id: string) => cfg.instrumentById[id]!;
const state = (over: Partial<MatchState>, id = 'voice-baritone'): MatchState => ({ ...initialMatchState(inst(id), cfg), ...over });

describe('match view', () => {
  it('names notes as the player reads them: sung for voices, written for transposing instruments', () => {
    expect(readName(inst('voice-tenor'), 52)).toBe('E3');
    // A B-flat trumpet reads a major 2nd above the sounding note.
    expect(readName(inst('trumpet-bb'), 58)).toBe('C4');
  });

  it('range chips are the C major chord tones in the served range at difficulty 1', () => {
    expect(rangeChips(inst('voice-baritone'), cfg).map((m) => readName(inst('voice-baritone'), m))).toEqual(['C3', 'E3', 'G3', 'C4']);
  });

  it('the summary line: direction, centre, and none without hits', () => {
    expect(summaryLine(state({ phase: 'summary', summary: { hit: 4, total: 5, meanCents: 8, cents: 8, direction: 'sharp' } }))).toBe('4 of 5 hit. On average you were 8 cents high.');
    expect(summaryLine(state({ phase: 'summary', summary: { hit: 5, total: 5, meanCents: 0.2, cents: 0, direction: 'centre' } }))).toBe('You were right in the middle on average.');
    expect(summaryLine(state({ phase: 'summary', summary: { hit: 0, total: 5, meanCents: null, cents: 0, direction: null } }))).toBeNull();
  });

  it('the You line names the target within 50 c, in words, and adds cents rounded to 5 only with show cents on (§6.1)', () => {
    const b = inst('voice-baritone');
    // 45 c flat of E3 is nearer E♭3, but the line names the target: never a different note and a deviation in one line.
    const flat45 = state({ phase: 'flat', target: 52, you: 51, needle: -45, youCents: -45 });
    expect(youLine(flat45, b)?.text).toBe('You: E3, a little low');
    expect(youLine(flat45, b)?.note).toBe('E3');
    expect(youLine(flat45, b, true)?.text).toBe('You: E3, a little low (45 cents)');
    expect(youLine(state({ phase: 'sharp', target: 52, you: 52, needle: 17, youCents: 17 }), b, true)?.text).toBe('You: E3, a little high (15 cents)');
    expect(youLine(state({ phase: 'sharp', target: 52, you: 52, needle: 18, youCents: 18 }), b, true)?.text).toBe('You: E3, a little high (20 cents)');
    // Near the centre: no words.
    expect(youLine(state({ phase: 'in-band', target: 55, you: 55, needle: 4, youCents: 4 }), b, true)?.text).toBe('You: G3');
    // Past 50 c, the nearest note and "much too": the needle is pinned, so no cents.
    expect(youLine(state({ phase: 'sharp', target: 52, you: 53, needle: 50, youCents: 70 }), b, true)?.text).toBe('You: F3, much too high');
    expect(youLine(state({ phase: 'far-up', target: 52, you: 47, needle: -50, youCents: -500 }), b)?.text).toBe('You: B2, much too low');
    expect(youLine(state({ phase: 'idle', you: 55, needle: 3 }), b)).toBeNull();
    // The line reads the value the model refreshes 4 times a second, not the live needle.
    expect(youLine(state({ phase: 'flat', target: 52, you: 52, needle: -2, youCents: -30 }), b, true)?.text).toBe('You: E3, a little low (30 cents)');
  });

  it('the settled note after a hold: "You sang: E♭3, a little high", drawn beside the target on the same staff', () => {
    const b = inst('voice-baritone');
    const s = state({ phase: 'listening', target: 52, settled: { midi: 51.4, cents: -60 } });
    expect(settledLine(s, b)?.text).toBe('You sang: E♭3, a little high');
    expect(settledMidi(s)).toBe(51);
    expect(settledLine(state({ phase: 'hit', target: 52, settled: { midi: 52.03, cents: 3 } }), b)?.text).toBe('You sang: E3');
    expect(settledLine(state({ phase: 'listening' }), b)).toBeNull();
    const h = heardStaff(b, 52, 51);
    expect(h?.pitch.alter).not.toBe(0);
    expect(heardStaff(b, 52, null)).toBeNull();
  });

  it('the meter: green only in tune, the wobble width on Steady and Balanced, dimmed in a short silence', () => {
    const inTune = needleView(state({ phase: 'in-band', needle: -5, spread: [-20, 15] }), true);
    expect(inTune.tone).toBe('in');
    expect(inTune.spread?.[0]).toBeCloseTo(0.3);
    expect(inTune.spread?.[1]).toBeCloseTo(0.65);
    // The needle inside the band but the centre not yet judged in tune: ink, not green.
    expect(needleView(state({ phase: 'listening', needle: -5 })).tone).toBe('ink');
    expect(needleView(state({ phase: 'flat', needle: -40, spread: [-50, -30] }), false).spread).toBeNull();
    const stale = needleView(state({ phase: 'listening', needle: -12, dim: true, spread: [-20, 0] }), true);
    expect(stale.stale).toBe(true);
    expect(stale.at).toBeCloseTo(0.38);
    expect(stale.spread).toBeNull();
    expect(needleView(state({ phase: 'listening', needle: null })).at).toBeNull();
    expect(hintLine(state({ phase: 'listening', needle: null }))).toBe('The needle moves when we hear a steady note.');
    expect(hintLine(state({ phase: 'listening', needle: 3 }))).toBeNull();
  });

  it('the needle is dim and absent while the note plays, and the band follows the in-tune window', () => {
    const v = needleView(state({ phase: 'idle' }));
    expect(v.at).toBeNull();
    expect(v.dim).toBe(true);
    expect(v.band).toBeCloseTo(0.3);
  });

  it('the other voice: tenor above baritone, baritone below tenor, nothing above soprano', () => {
    expect(neighbourVoice(cfg, inst('voice-baritone'), 'above')?.id).toBe('voice-tenor');
    expect(neighbourVoice(cfg, inst('voice-tenor'), 'below')?.id).toBe('voice-baritone');
    expect(neighbourVoice(cfg, inst('voice-soprano'), 'above')).toBeNull();
    expect(neighbourVoice(cfg, inst('flute'), 'above')).toBeNull();
  });
});
