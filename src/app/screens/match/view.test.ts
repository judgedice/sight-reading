import { describe, expect, it } from 'vitest';
import { appConfigs } from '../../compose/configs.ts';
import { initialMatchState, type MatchState } from './model.ts';
import { needleView, neighbourVoice, rangeChips, readName, summaryLine, youLine } from './view.ts';

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

  it('the You line drops cents when the needle is pinned or centred', () => {
    expect(youLine(state({ phase: 'sharp', you: 55, needle: 50 }), inst('voice-baritone'))?.text).toBe('You: G3');
    expect(youLine(state({ phase: 'in-band', you: 55, needle: 0.2 }), inst('voice-baritone'))?.text).toBe('You: G3');
    expect(youLine(state({ phase: 'idle', you: 55, needle: 3 }), inst('voice-baritone'))).toBeNull();
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
