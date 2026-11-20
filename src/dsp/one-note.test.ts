// Round 2 detection: one sung note stays one note (`DspConfig.oneNote`, grading.detection.oneNote). Signals from the
// untrained-voice performer model (src/testkit/untrained/voice.ts), a baritone through a laptop mic.
import { describe, expect, it } from 'vitest';
import type { ClockSeconds, DspConfig } from '../core/types.ts';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { resolveOneNote } from '../rules/index.ts';
import { renderUntrainedVoice, type SungNote, type UntrainedVoiceTake } from '../testkit/untrained/voice.ts';
import { runOffline } from './pipeline.ts';

const cfg = configs();
const inst = cfg.instrumentById['voice-baritone']!;
const base: DspConfig = {
  analysisRate: 16000,
  windowSamples: inst.detection.windowSamples,
  hopSamples: 128,
  minHz: inst.detection.minHz,
  maxHz: inst.detection.maxHz,
  a4Hz: 440,
  clarityThreshold: inst.detection.clarityThreshold,
  changeCents: inst.detection.changeCents,
  onsetProfile: inst.detection.onsetProfile,
  vibratoClass: inst.detection.vibratoClass,
  outputMode: 'wired',
  clicks: [],
  clickTemplate: null,
  repeatHints: [],
  attackExcludeMs: cfg.grading.intonation.attackExcludeMsByFamily.voice,
  clickLeakDb: null,
};
const withOneNote = (c: DspConfig, level = 1): DspConfig => ({ ...c, oneNote: resolveOneNote(cfg, inst, level) });

const sung = (p: Partial<SungNote> & Pick<SungNote, 'midi' | 'onsetSec' | 'endSec'>): SungNote => ({
  ref: 0, offsetCents: 0, joined: false, dipDb: 0, scoopCents: 0, scoopSec: 0, releaseCents: 0, releaseSec: 0, vibHz: 5.5, vibCents: 0,
  vibJitter: 0, driftCents: 0, breathSec: 0, breathDb: -12, consonantSec: 0, creakSec: 0, gainDb: 0, attackSec: 0.05,
  scoopWobbleCents: 0, overshootCents: 0, overshootSec: 0, glitchAt: 0, glitchSec: 0, glitchKind: 'subharmonic', glitchSemitones: 0, dipUnderCents: 0,
  dipUnderSec: 0, releaseDropDb: 25, ...p,
});
const take = (notes: SungNote[]): UntrainedVoiceTake => ({ notes, levelDb: -30, micHighPassHz: 220, noiseDbfs: -62, seed: 5 });
const noteOns = (t: UntrainedVoiceTake, c: DspConfig): number => {
  const x = renderUntrainedVoice(t, Math.max(...t.notes.map((n) => n.endSec)) + 0.5, 16000);
  return runOffline(x, 16000, c).events.filter((e) => e.type === 'note-on').length;
};

describe('one sung note is one note (round 2)', () => {
  it('a 200 c scoop into a held note: one note with the voice tolerances (two without)', () => {
    const t = take([sung({ midi: 50, onsetSec: 0.4, endSec: 1.3, scoopCents: -200, scoopSec: 0.16 })]);
    expect(noteOns(t, withOneNote(base))).toBe(1);
    expect(noteOns(t, base)).toBeGreaterThanOrEqual(2);
  });

  it('a falling, dying release: one note', () => {
    const t = take([sung({ midi: 52, onsetSec: 0.4, endSec: 1.3, releaseCents: -180, releaseSec: 0.2 })]);
    expect(noteOns(t, withOneNote(base))).toBe(1);
  });

  it('fast slurred notes at the written onsets stay separate (the onset hints stop the scoop rule)', () => {
    const on = [0.4, 0.525, 0.65, 0.775];
    const midis = [50, 52, 53, 55];
    const t = take(midis.map((m, i) => sung({ midi: m, onsetSec: on[i]!, endSec: on[i + 1] ?? 1.3, joined: i > 0, dipDb: 0 })));
    const hints = on.map((x) => x as ClockSeconds);
    expect(noteOns(t, { ...withOneNote(base, 5), onsetHints: hints })).toBe(4);
  });
});
