import { copy } from '../../../ui/copy/copy.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { STEP_COUNT, WIZARD_STEPS, type OnboardingStep } from './flow.ts';

const STEP_NAME = { instrument: 'onboarding.step.instrument', sound: 'onboarding.step.sound', ready: 'onboarding.step.ready' } as const;

export const stepName = (step: Exclude<OnboardingStep, 'welcome'>): string => copy(STEP_NAME[step]);

export interface WizardStepperProps {
  /** The current step; on Welcome the preview shows all three as later steps. */
  step: OnboardingStep;
  /** How far through the current step its bar is filled, 0 to 1 (the Sound check's stages). */
  progress: number;
  /** A done step's name goes back to it. Absent (Welcome's preview): nothing is a button. */
  onGoTo?: (step: Exclude<OnboardingStep, 'welcome'>) => void;
  /** Welcome shows the stepper as a preview: no eyebrow, no current step. */
  preview?: boolean;
}

/**
 * The setup stepper (round 3, 01-ux-review §3.1, R74): three named segments across the top. Done steps are ink with a
 * tick and are buttons back to themselves; the current one is brass with its bar part-filled and `aria-current="step"`;
 * later ones are grey. Under it the eyebrow "Step 2 of 3".
 */
export function WizardStepper({ step, progress, onGoTo, preview = false }: WizardStepperProps) {
  const at = step === 'welcome' ? -1 : WIZARD_STEPS.indexOf(step);
  const current = step === 'welcome' ? null : step;
  const label = current ? copy('onboarding.steps.label', { n: at + 1, total: STEP_COUNT, name: stepName(current) }) : copy('welcome.steps');
  return (
    <nav className="ob-stepper" aria-label={label} data-preview={preview ? 'true' : undefined}>
      <ol className="ob-stepper-list">
        {WIZARD_STEPS.map((id, i) => {
          const status = i < at ? 'done' : i === at ? 'now' : 'later';
          const fill = status === 'done' ? 1 : status === 'now' ? Math.max(0.08, Math.min(1, progress)) : 0;
          const name = stepName(id);
          const inner = (
            <>
              <span className="ob-stepper-bar" aria-hidden="true">
                <span className="ob-stepper-fill" style={{ inlineSize: `${Math.round(fill * 100)}%` }} />
              </span>
              <span className="ob-stepper-head">
                <span className="ob-stepper-dot" aria-hidden="true">
                  {status === 'done' ? <Glyph id="check" size={14} /> : i + 1}
                </span>
                <span className="ob-stepper-name">{name}</span>
              </span>
            </>
          );
          return (
            <li key={id} className="ob-stepper-item" data-status={status} aria-current={status === 'now' ? 'step' : undefined}>
              {status === 'done' && onGoTo ? (
                <button type="button" className="ob-stepper-button" onClick={() => onGoTo(id)}>
                  {inner}
                  <span className="ui-visually-hidden">{`, ${copy('onboarding.stage.status.done')}`}</span>
                </button>
              ) : (
                <span className="ob-stepper-static">{inner}</span>
              )}
            </li>
          );
        })}
      </ol>
      {current && !preview ? <p className="ob-eyebrow">{copy('onboarding.step', { n: at + 1, total: STEP_COUNT })}</p> : null}
    </nav>
  );
}
