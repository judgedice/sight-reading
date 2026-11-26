/**
 * The first-run wizard as a small pure machine (round 3, 01-ux-review §3, R74). Welcome is an intro and is not
 * counted; then three named steps: Instrument, Sound check (stages Microphone, Hear you, Timing) and Ready.
 *
 * - Back goes one stage back inside Sound check, then one step back.
 * - Declining the microphone marks Hear you and Timing "Needs the microphone" and opens Ready (ruling 13 stands).
 * - Without the match engine (`match: false`) Hear you is left out (`n/a`).
 * - Where calibration is the mandatory path (R16, iOS without reported latency) Timing has no skip (`mandatory`).
 *
 * The position is saved (`OnboardingProgress`) so a reload resumes at the same step; `restoreProgress` also reads the
 * six-step ids of round 2, so a saved position from that flow never traps a player mid-setup.
 */
import type { MicProblem } from '../states/mic.ts';
import type { CalibrationResult } from '../calibration/CalibrationCard.tsx';

export type OnboardingStep = 'welcome' | 'instrument' | 'sound' | 'ready';
export type SoundStage = 'mic' | 'hear' | 'timing';

/** The counted steps, in order (Welcome is not one of them). */
export const WIZARD_STEPS: readonly Exclude<OnboardingStep, 'welcome'>[] = ['instrument', 'sound', 'ready'];
export const STEP_COUNT = WIZARD_STEPS.length;
export const SOUND_STAGES: readonly SoundStage[] = ['mic', 'hear', 'timing'];

export type MicState = 'unasked' | 'requesting' | 'granted' | 'declined' | MicProblem;
/** `n/a`: left out (no match engine) or not reachable (microphone off). */
export type HearState = 'pending' | 'heard' | 'skipped' | 'n/a';
/** null: not run yet; `n/a`: the microphone is off, so it cannot run. */
export type TimingState = CalibrationResult | null | 'n/a';

export interface OnboardingState {
  step: OnboardingStep;
  stage: SoundStage;
  mic: MicState;
  hear: HearState;
  timing: TimingState;
  /** Hear you is offered (the match engine is there). */
  match: boolean;
  /** Timing cannot be skipped (R16). */
  mandatory: boolean;
  /** The measured delay, ms, once Timing passed. */
  timingMs?: number | null;
}

export interface OnboardingOptions {
  match?: boolean;
  mandatory?: boolean;
}

export const initialOnboarding = (o: OnboardingOptions = {}): OnboardingState => ({
  step: 'welcome',
  stage: 'mic',
  mic: 'unasked',
  hear: o.match === false ? 'n/a' : 'pending',
  timing: null,
  match: o.match ?? true,
  mandatory: o.mandatory ?? false,
});

export type OnboardingEvent =
  | { type: 'next' }
  | { type: 'back' }
  /** A done step's name in the stepper (later steps cannot be chosen). */
  | { type: 'goto-step'; step: Exclude<OnboardingStep, 'welcome'> }
  /** "Run it now" on Ready: back to the Timing stage. */
  | { type: 'goto-timing' }
  | { type: 'mic-requesting' }
  /** The microphone is on: the stage list ticks and Hear you opens in the same card (no new screen). */
  | { type: 'mic-granted' }
  | { type: 'mic-problem'; problem: MicProblem }
  /** "Not now", or "Continue without the microphone" on a problem card: Ready, with the microphone off. */
  | { type: 'mic-skip' }
  | { type: 'hear-done' }
  | { type: 'hear-skip' }
  | { type: 'calibration-done'; result: CalibrationResult; ms?: number | null };

/** The stage after the microphone, or Ready when it is the last. */
function afterHear(s: OnboardingState): OnboardingState {
  return { ...s, stage: 'timing' };
}

export function onboardingReducer(s: OnboardingState, e: OnboardingEvent): OnboardingState {
  switch (e.type) {
    case 'next':
      if (s.step === 'welcome') return { ...s, step: 'instrument' };
      if (s.step === 'instrument') return { ...s, step: 'sound', stage: s.mic === 'granted' ? (s.hear === 'pending' ? 'hear' : 'timing') : 'mic' };
      return s;
    case 'back': {
      if (s.step === 'instrument') return { ...s, step: 'welcome' };
      if (s.step === 'ready') {
        // Back from Ready opens the last stage that ran: Timing, or the microphone when it was declined.
        return { ...s, step: 'sound', stage: s.mic === 'granted' ? 'timing' : 'mic', mic: s.mic === 'granted' ? 'granted' : 'unasked' };
      }
      if (s.step === 'sound') {
        if (s.stage === 'timing') return s.match && s.mic === 'granted' ? { ...s, stage: 'hear' } : { ...s, stage: 'mic' };
        if (s.stage === 'hear') return { ...s, stage: 'mic' };
        // A pending request is dropped and the pre-prompt asks again; a grant already given stays.
        return { ...s, step: 'instrument', mic: s.mic === 'requesting' ? 'unasked' : s.mic };
      }
      return s;
    }
    case 'goto-step': {
      const at = WIZARD_STEPS.indexOf(e.step);
      const now = s.step === 'welcome' ? -1 : WIZARD_STEPS.indexOf(s.step);
      if (at < 0 || at >= now) return s;
      return e.step === 'sound' ? { ...s, step: 'sound', stage: s.mic === 'granted' ? 'timing' : 'mic' } : { ...s, step: e.step };
    }
    case 'goto-timing':
      return s.mic === 'granted' ? { ...s, step: 'sound', stage: 'timing', timing: null } : { ...s, step: 'sound', stage: 'mic' };
    case 'mic-requesting':
      return s.step === 'sound' && s.stage === 'mic' ? { ...s, mic: 'requesting' } : s;
    case 'mic-granted': {
      if (s.step !== 'sound' || s.stage !== 'mic') return s;
      const hear: HearState = s.match ? (s.hear === 'n/a' ? 'pending' : s.hear) : 'n/a';
      const timing = s.timing === 'n/a' ? null : s.timing;
      // A resumed setup whose stages were all decided goes straight on to Ready.
      if (hear !== 'pending' && timing !== null) return { ...s, mic: 'granted', hear, timing, step: 'ready' };
      return { ...s, mic: 'granted', hear, timing, stage: hear === 'pending' ? 'hear' : 'timing' };
    }
    case 'mic-problem':
      return s.step === 'sound' && s.stage === 'mic' ? { ...s, mic: e.problem } : s;
    case 'mic-skip':
      return s.step === 'sound' && s.stage === 'mic' ? { ...s, step: 'ready', mic: 'declined', hear: 'n/a', timing: 'n/a' } : s;
    case 'hear-done':
      return s.step === 'sound' && s.stage === 'hear' ? afterHear({ ...s, hear: 'heard' }) : s;
    case 'hear-skip':
      return s.step === 'sound' && s.stage === 'hear' ? afterHear({ ...s, hear: 'skipped' }) : s;
    case 'calibration-done':
      if (s.step !== 'sound' || s.stage !== 'timing') return s;
      if (e.result === 'skipped' && s.mandatory) return s;
      return { ...s, step: 'ready', timing: e.result, timingMs: e.result === 'calibrated' ? (e.ms ?? null) : null };
  }
}

/** How far through the sound check the stepper's bar is, 0 to 1. */
export function stageProgress(s: OnboardingState): number {
  if (s.step !== 'sound') return s.step === 'ready' ? 1 : 0;
  const i = SOUND_STAGES.indexOf(s.stage);
  return (i + 0.5) / SOUND_STAGES.length;
}

export type StageStatus = 'done' | 'now' | 'skipped' | 'needs-mic' | 'upcoming';

/** Each stage's row in the stage list (desktop) or chip (phone). */
export function stageStatuses(s: OnboardingState): Record<SoundStage, StageStatus> {
  const micOff = s.mic === 'declined';
  const of = (stage: SoundStage, done: boolean, skipped: boolean): StageStatus =>
    s.step === 'sound' && s.stage === stage ? 'now' : done ? 'done' : skipped ? 'skipped' : micOff ? 'needs-mic' : 'upcoming';
  return {
    mic: s.mic === 'granted' ? 'done' : of('mic', false, micOff),
    hear: s.match ? of('hear', s.hear === 'heard', s.hear === 'skipped') : 'skipped',
    timing: of('timing', s.timing === 'calibrated' || s.timing === 'estimate', s.timing === 'skipped'),
  };
}

// ---- persistence ---------------------------------------------------------------------------------------------

/** What `AppSettings.onboardingProgress` holds: the position, not the browser's permission. */
export interface OnboardingProgress {
  step: Exclude<OnboardingStep, 'welcome'>;
  stage?: SoundStage;
  instrumentId: string | null;
  showBeta: boolean;
  hear?: Exclude<HearState, 'pending'>;
  timing?: CalibrationResult;
}

export function progressOf(s: OnboardingState, instrumentId: string | null, showBeta: boolean): OnboardingProgress | null {
  if (s.step === 'welcome') return null;
  const out: OnboardingProgress = { step: s.step, instrumentId, showBeta };
  if (s.step === 'sound') out.stage = s.stage;
  if (s.hear !== 'pending') out.hear = s.hear;
  if (s.timing !== null && s.timing !== 'n/a') out.timing = s.timing;
  return out;
}

/** Round 2's six steps by number: welcome, instrument, microphone, calibration, one note, difficulty. */
const LEGACY_NUMBERED: Record<number, { step: OnboardingProgress['step']; stage?: SoundStage }> = {
  2: { step: 'instrument' },
  3: { step: 'sound', stage: 'mic' },
  4: { step: 'sound', stage: 'timing' },
  5: { step: 'sound', stage: 'hear' },
  6: { step: 'ready' },
};
/** This round's step names. */
const NAMED: Record<string, { step: OnboardingProgress['step']; stage?: SoundStage }> = {
  instrument: { step: 'instrument' },
  sound: { step: 'sound', stage: 'mic' },
  ready: { step: 'ready' },
};

const isStage = (x: unknown): x is SoundStage => x === 'mic' || x === 'hear' || x === 'timing';

/**
 * Reads a saved position, whatever round wrote it. Anything it cannot read starts at Welcome; nothing here can leave
 * the player on a step they cannot leave. The microphone is never restored as granted: the browser is asked again.
 */
export function restoreProgress(raw: unknown): OnboardingProgress | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const at = typeof r['step'] === 'number' ? LEGACY_NUMBERED[r['step']] : typeof r['step'] === 'string' ? NAMED[r['step']] : undefined;
  if (!at) return null;
  const stage = at.step === 'sound' ? (isStage(r['stage']) ? r['stage'] : (at.stage ?? 'mic')) : undefined;
  const instrumentId = typeof r['instrumentId'] === 'string' ? r['instrumentId'] : null;
  const out: OnboardingProgress = { step: at.step, instrumentId, showBeta: r['showBeta'] === true };
  if (stage) out.stage = stage;
  if (r['hear'] === 'heard' || r['hear'] === 'skipped' || r['hear'] === 'n/a') out.hear = r['hear'];
  if (r['timing'] === 'calibrated' || r['timing'] === 'estimate' || r['timing'] === 'skipped') out.timing = r['timing'];
  // Past the instrument step without an instrument (a round 2 draft did not save it): choose one first.
  if (out.step !== 'instrument' && instrumentId === null) return { step: 'instrument', instrumentId: null, showBeta: out.showBeta };
  return out;
}

/**
 * The state a saved position resumes in. The browser is asked for the microphone again, so any step past it reopens
 * at the Microphone stage with what was decided kept; Allow then goes on to the first open stage, or Ready (R74).
 * Ready after the microphone was declined stays declined.
 */
export function resumeState(p: OnboardingProgress, o: OnboardingOptions = {}): OnboardingState {
  const base = initialOnboarding(o);
  if (p.step === 'instrument') return { ...base, step: 'instrument' };
  if (p.step === 'ready' && p.hear === 'n/a' && base.match && p.timing === undefined) return { ...base, step: 'ready', mic: 'declined', hear: 'n/a', timing: 'n/a' };
  const hear: HearState = !base.match ? 'n/a' : p.hear === 'heard' || p.hear === 'skipped' ? p.hear : 'pending';
  return { ...base, step: 'sound', stage: 'mic', hear, timing: p.timing ?? null };
}
