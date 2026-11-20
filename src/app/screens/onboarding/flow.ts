/**
 * Onboarding steps as a small pure machine (04 section 5.1). Back returns to the step the player came from.
 *
 * Six steps (round 2, 01-ux §3.2): welcome, instrument, microphone, calibration, "Sing one note" or "Play one note",
 * difficulty. The note step needs the microphone, so declining it goes straight to the difficulty; without the match
 * engine (`match: false`) calibration does too.
 */
import type { MicProblem } from '../states/mic.ts';
import type { CalibrationResult } from '../calibration/CalibrationCard.tsx';

export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6;
export const STEP_COUNT = 6;
/** The note step and the difficulty step. */
export const MATCH_STEP = 5;
export const LEVEL_STEP = 6;

export type MicState = 'unasked' | 'requesting' | 'granted' | 'declined' | MicProblem;

export interface OnboardingState {
  step: OnboardingStep;
  /** Steps visited before this one, newest last. */
  trail: OnboardingStep[];
  mic: MicState;
  calibration: CalibrationResult | null;
  /** The note step is offered (the match engine is there). */
  match: boolean;
}

export const initialOnboarding = (o: { match?: boolean } = {}): OnboardingState => ({ step: 1, trail: [], mic: 'unasked', calibration: null, match: o.match ?? true });

export type OnboardingEvent =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'mic-requesting' }
  /** The microphone is on: "Microphone is on." shows, then `mic-continue` opens calibration. */
  | { type: 'mic-granted' }
  | { type: 'mic-continue' }
  | { type: 'mic-problem'; problem: MicProblem }
  /** "Not now", or "Practise without listening" on the denied card: on to the difficulty step with the mic off. */
  | { type: 'mic-skip' }
  | { type: 'calibration-done'; result: CalibrationResult }
  /** Continue after a hit, or Skip, on the note step. The step never sends this by itself. */
  | { type: 'match-done' };

const go = (s: OnboardingState, step: OnboardingStep, patch: Partial<OnboardingState> = {}): OnboardingState => ({ ...s, ...patch, step, trail: [...s.trail, s.step] });

export function onboardingReducer(s: OnboardingState, e: OnboardingEvent): OnboardingState {
  switch (e.type) {
    case 'next':
      return s.step === 1 || s.step === 2 ? go(s, (s.step + 1) as OnboardingStep) : s;
    case 'back': {
      const prev = s.trail[s.trail.length - 1];
      if (prev === undefined) return s;
      // Going back to the pre-prompt re-asks; a pending request is dropped, and so is a grant already shown.
      return { ...s, step: prev, trail: s.trail.slice(0, -1), mic: s.mic === 'requesting' || (s.mic === 'granted' && prev === 3) ? 'unasked' : s.mic };
    }
    case 'mic-requesting':
      return s.step === 3 ? { ...s, mic: 'requesting' } : s;
    case 'mic-granted':
      return s.step === 3 ? { ...s, mic: 'granted' } : s;
    case 'mic-continue':
      return s.step === 3 && s.mic === 'granted' ? go(s, 4) : s;
    case 'mic-problem':
      return s.step === 3 ? { ...s, mic: e.problem } : s;
    case 'mic-skip':
      return s.step === 3 ? go(s, LEVEL_STEP, { mic: 'declined', calibration: null }) : s;
    case 'calibration-done':
      return s.step === 4 ? go(s, s.match ? MATCH_STEP : LEVEL_STEP, { calibration: e.result }) : s;
    case 'match-done':
      return s.step === MATCH_STEP ? go(s, LEVEL_STEP) : s;
  }
}
