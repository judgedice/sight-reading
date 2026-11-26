// Round 3 copy (docs/redesign/round3/01-ux-review.md §8): the wizard, Home, the mode pill and the audio warnings.
import { describe, expect, it } from 'vitest';
import { copy, isCopyKey } from './copy.ts';

describe('round 3 copy', () => {
  it('names the tab Home and keeps Practice and Ranked as modes (R78)', () => {
    expect(copy('nav.home')).toBe('Home');
    expect(copy('mode.practice')).toBe('Practice');
    expect(copy('mode.ranked')).toBe('Ranked');
    expect(copy('action.startPractice')).toBe('Start practice');
    expect(copy('action.startRanked')).toBe('Start ranked try');
    expect(copy('action.tryAgainPractice')).toBe('Try again as practice');
    expect(copy('match.entry')).toBe('Match a note');
    expect(copy('scales.entry')).toBe('Sing a scale');
    expect(copy('home.warmup')).toBe('Warm up');
  });

  it('the wizard says three steps, names them, and says what skipping costs (R74)', () => {
    expect(copy('onboarding.steps.label', { n: 2, total: 3, name: copy('onboarding.step.sound') })).toBe('Setup, step 2 of 3: Sound check');
    expect(copy('onboarding.step', { n: 1, total: 3 })).toBe('Step 1 of 3');
    expect(copy('onboarding.timing.skipNote')).toBe('Skipped, your tries are practice until you run it.');
    expect(copy('onboarding.timing.failFew', { found: 2, total: 10 })).toBe('We heard 2 of 10 clicks, not enough to time them.');
    expect(copy('onboarding.ready.difficulty')).toBe('1 of 10, the simplest');
    for (const gone of ['onboarding.level.title', 'onboarding.level.placement', 'onboarding.calibration.title', 'setup.difficulty.follow', 'match.onboarding.lead']) {
      expect(isCopyKey(gone), gone).toBe(false);
    }
  });

  it('audio warnings give the measured number first and say practice, never "won\'t earn XP" (R80)', () => {
    expect(copy('calibrate.warn.delay', { ms: 160 })).toBe(
      "Measured: 160 ms. That's longer than we can time fairly, so tries will be practice for now. Wired headphones often help.",
    );
    expect(copy('calibrate.warn.bluetooth')).not.toMatch(/XP/);
    expect(copy('calStatus.delay.detail', { ms: 160, max: 120 })).toBe("We measured 160 ms on this setup. Tries are practice until it's under 120 ms. Wired headphones often help.");
  });

  it('a ranked try that becomes practice says so with its reason (R79)', () => {
    expect(copy('mode.nowPractice', { reason: copy('mode.reason.listened-first') })).toBe('Now a practice try: you listened first.');
    expect(copy('setup.difficulty.above', { n: 1, level: 1 })).toBe('One above your difficulty (1).');
    expect(copy('setup.difficulty.above', { n: 2, level: 3 })).toBe('2 above your difficulty (3).');
  });
});
