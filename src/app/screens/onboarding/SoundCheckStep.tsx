import { useId, type Dispatch } from 'react';
import type { Configs, Instrument } from '../../../core/types.ts';
import { Card } from '../../../ui/components/containers/index.ts';
import { copy, type CopyKey } from '../../../ui/copy/copy.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { CalibrationCard } from '../calibration/CalibrationCard.tsx';
import { deniedStepsKey, micProblemKey, type MicProblem } from '../states/mic.ts';
import { text } from '../states/text.ts';
import { SOUND_STAGES, stageStatuses, type OnboardingEvent, type OnboardingState, type SoundStage, type StageStatus } from './flow.ts';
import { HearPanel, useHear } from './HearStep.tsx';
import { actWord } from './hear-model.ts';
import type { OnboardingServices } from './services.ts';
import { WizardFooter } from './WizardFooter.tsx';

const STATUS_KEY: Partial<Record<StageStatus, string>> = { done: 'done', now: 'now', skipped: 'skipped', 'needs-mic': 'needsMic' };
const t = (key: string): string => copy(key as CopyKey);

function stageSub(stage: SoundStage, voice: boolean): string {
  return copy(`onboarding.stage.${stage}.sub` as CopyKey, { act: actWord(voice) });
}

/** The stages as a list (desktop) or three chips (phone), each with Done, Now, Skipped or "Needs the microphone". */
function StageList({ state, voice, phone }: { state: OnboardingState; voice: boolean; phone: boolean }) {
  const statuses = stageStatuses(state);
  const stages = SOUND_STAGES.filter((s) => s !== 'hear' || state.match);
  return (
    <ol className={phone ? 'ob-stages ob-stages-chips' : 'ob-stages'} aria-label={copy('onboarding.step.sound')} data-testid="ob-stages">
      {stages.map((id, i) => {
        const status = statuses[id];
        const statusKey = STATUS_KEY[status];
        const name = t(`onboarding.stage.${id}`);
        const sub = status === 'now' ? `${copy('onboarding.stage.status.now')}: ${stageSub(id, voice).toLowerCase()}` : statusKey ? t(`onboarding.stage.status.${statusKey}`) : stageSub(id, voice);
        return (
          <li key={id} className="ob-stage" data-stage={id} data-status={status} aria-current={status === 'now' ? 'step' : undefined}>
            <span className="ob-stage-dot" aria-hidden="true">
              {status === 'done' ? <Glyph id="check" size={14} /> : i + 1}
            </span>
            <span className="ob-stage-text">
              <span className="ob-stage-name">{name}</span>
              {phone ? <span className="ui-visually-hidden">{`, ${sub}`}</span> : <span className="ob-stage-sub">{sub}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The microphone's problem card, led by why it shows (01-ux-review §3.3). */
function MicProblemBlock({ problem, browser }: { problem: MicProblem; browser: OnboardingServices['micBrowser'] }) {
  return (
    <div className="ob-problem" role="alert" data-testid={`mic-${problem}`}>
      <p className="ob-because">
        <b>{copy(problem === 'denied' ? 'onboarding.mic.becauseDenied' : 'onboarding.mic.becauseProblem')}</b>
      </p>
      <p className="ob-problem-body">{text(problem === 'denied' ? 'permission.denied.title' : micProblemKey(problem))}</p>
      {problem === 'denied' ? <p className="ob-problem-steps">{text(deniedStepsKey(browser))}</p> : null}
    </div>
  );
}

export interface SoundCheckStepProps {
  services: OnboardingServices;
  cfg: Configs;
  state: OnboardingState;
  dispatch: Dispatch<OnboardingEvent>;
  instrument: Instrument;
  /** Below the wide layout: the stages are chips above the card. */
  phone: boolean;
  onChangeVoice: (instrumentId: string) => void;
  onBack: () => void;
}

/**
 * Step 2, Sound check (round 3, 01-ux-review §3.3): Microphone, Hear you and Timing on one screen. Moving from one
 * stage to the next keeps the screen; the stage list ticks and the card shows the next stage.
 */
export function SoundCheckStep({ services, cfg, state, dispatch, instrument, phone, onChangeVoice, onBack }: SoundCheckStepProps) {
  const voice = instrument.family === 'voice';
  const headingId = useId();
  const stage = state.stage;
  const hearing = useHear(services.match, instrument, stage === 'hear' && state.mic === 'granted');
  const match = services.match;

  const requestMic = (): void => {
    // Runs unlock and getUserMedia from this click (01 section 7.1); the prompt never appears before this stage.
    const pending = services.requestMic();
    dispatch({ type: 'mic-requesting' });
    void pending.then(
      (r) => dispatch(r.ok ? { type: 'mic-granted' } : { type: 'mic-problem', problem: r.problem }),
      () => dispatch({ type: 'mic-problem', problem: 'no-device' }),
    );
  };

  const problem = state.mic === 'denied' || state.mic === 'no-device' || state.mic === 'busy' || state.mic === 'insecure' ? state.mic : null;

  let panel;
  let footer;
  if (stage === 'mic') {
    panel = (
      <section className="ob-stage-panel" data-testid="ob-mic" aria-labelledby={headingId}>
        <Glyph id="mic" size={40} className="ob-mic-glyph" />
        <h2 id={headingId} className="ob-stage-title" tabIndex={-1}>
          {copy('onboarding.mic.title')}
        </h2>
        <p className="ob-text">{copy('onboarding.mic.body', { act: actWord(voice).toLowerCase() })}</p>
        {problem ? (
          <MicProblemBlock problem={problem} browser={services.micBrowser} />
        ) : (
          <>
            <p className="ob-text">{copy('onboarding.mic.browser')}</p>
            <p className="ob-note">
              <Glyph id="info" size={16} />
              <span>{copy('onboarding.mic.notNowHint')}</span>
            </p>
          </>
        )}
      </section>
    );
    footer = problem ? (
      <WizardFooter
        onBack={onBack}
        skip={{ label: copy('onboarding.mic.continueWithout'), onClick: () => dispatch({ type: 'mic-skip' }) }}
        primary={problem === 'insecure' ? null : { label: copy('action.tryAgain'), onClick: requestMic }}
      />
    ) : (
      <WizardFooter
        onBack={onBack}
        skip={{ label: copy('action.notNow'), onClick: () => dispatch({ type: 'mic-skip' }) }}
        primary={{ label: copy('action.allowMicrophone'), onClick: requestMic, loading: state.mic === 'requesting' }}
      />
    );
  } else if (stage === 'hear' && match) {
    panel = <HearPanel state={hearing} instrument={instrument} cfg={cfg} onChangeVoice={onChangeVoice} headingId={headingId} />;
    footer = (
      <WizardFooter
        onBack={onBack}
        skip={{ label: copy('onboarding.hear.skip'), onClick: () => dispatch({ type: 'hear-skip' }) }}
        primary={{ label: copy('action.next'), onClick: () => dispatch({ type: 'hear-done' }), disabled: !hearing.heard }}
      />
    );
  } else {
    panel = (
      <CalibrationCard
        variant="wizard"
        allowSkip
        services={services.calibration}
        onDone={(result, ms) => dispatch({ type: 'calibration-done', result, ms: ms ?? null })}
        renderFooter={(f) => <WizardFooter onBack={onBack} skip={f.skip} primary={f.primary} note={f.note} />}
      />
    );
    footer = null;
  }

  return (
    <section className="ob-sound" data-testid="ob-sound" data-stage={stage}>
      <div className="ob-sound-head">
        <h1 className="ob-title">{copy('onboarding.step.sound')}</h1>
        <p className="ob-text">{copy('onboarding.sound.body')}</p>
      </div>
      <div className="ob-sound-body">
        <StageList state={state} voice={voice} phone={phone} />
        <Card className="ob-stage-card">{panel}</Card>
      </div>
      {footer}
    </section>
  );
}
