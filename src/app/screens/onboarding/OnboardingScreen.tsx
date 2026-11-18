import './onboarding.css';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { Instrument } from '../../../core/types.ts';
import { Card } from '../../../ui/components/containers/index.ts';
import { Button, Stepper, Toggle } from '../../../ui/components/form/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { PlaceholderScreen } from '../Placeholder.tsx';
import { CalibrationCard } from '../calibration/CalibrationCard.tsx';
import { MicProblemCard } from '../states/States.tsx';
import { text } from '../states/text.ts';
import { initialOnboarding, onboardingReducer, STEP_COUNT, type OnboardingStep } from './flow.ts';
import { abbreviation, familyLabelKey, groupInstruments, transpositionLine } from './instruments.ts';
import { useOnboardingServices, type LevelChoice, type OnboardingServices } from './services.ts';

function InstrumentCard({ i, checked, onSelect, name }: { i: Instrument; checked: boolean; onSelect: () => void; name: string }) {
  const line = transpositionLine(i);
  return (
    <label className="ob-instrument" data-checked={checked ? 'true' : 'false'}>
      <input type="radio" className="ob-radio" name={name} value={i.id} checked={checked} onChange={onSelect} />
      <span className="ob-circle" aria-hidden="true">
        {abbreviation(i)}
      </span>
      <span className="ob-instrument-text">
        <span className="ob-instrument-name">
          {i.label}
          {i.status === 'beta' ? <span className="ob-badge">{copy('badge.beta')}</span> : null}
        </span>
        {line ? <span className="ob-instrument-sub">{line}</span> : null}
      </span>
    </label>
  );
}

function Onboarding({ services }: { services: OnboardingServices }) {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(onboardingReducer, undefined, initialOnboarding);
  const [name, setName] = useState('');
  const [instrumentId, setInstrumentId] = useState(services.initial.instrumentId);
  const [showBeta, setShowBeta] = useState(services.initial.showBeta);
  const [level, setLevel] = useState(2);
  const [choosing, setChoosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const radioName = 'onboarding-instrument';
  const step: OnboardingStep = state.step;

  // Move focus to the new step's heading so keyboard and screen reader users land at its top (2.4.3).
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const micAllowed = state.mic === 'granted';

  const finish = (choice: LevelChoice): void => {
    setSaving(true);
    void services
      .finish({
        displayName: name.trim() || copy('player.defaultName'),
        instrumentId,
        showBeta,
        micAllowed,
        calibration: state.calibration,
        level: choice,
      })
      .then((to) => navigate(to, { replace: true }))
      .catch(() => setSaving(false));
  };

  const requestMic = (): void => {
    // Runs unlock and getUserMedia from this click (01 section 7.1); the prompt never appears before this step.
    const pending = services.requestMic();
    dispatch({ type: 'mic-requesting' });
    void pending.then(
      (r) => dispatch(r.ok ? { type: 'mic-granted' } : { type: 'mic-problem', problem: r.problem }),
      () => dispatch({ type: 'mic-problem', problem: 'no-device' }),
    );
  };

  const groups = groupInstruments(services.instruments, showBeta);
  // A beta pick stays valid only while beta cards show.
  const selectable = groups.some((g) => g.items.some((i) => i.id === instrumentId));

  return (
    <div className="ob" data-testid="screen-welcome" data-route-id="welcome" data-step={step}>
      <Card className="ob-card">
        <header className="ob-head">
          {step > 1 ? <Button label={copy('common.back')} variant="tertiary" size="compact" icon="chevron-left" onClick={() => dispatch({ type: 'back' })} /> : <span />}
          <p className="ob-step">{copy('onboarding.step', { n: step, total: STEP_COUNT })}</p>
        </header>

        {step === 1 ? (
          <section className="ob-body">
            <h1 ref={headingRef} tabIndex={-1} className="ob-title">
              {copy('welcome.headline')}
            </h1>
            <p className="ob-text">{copy('welcome.body')}</p>
            <label className="ob-name">
              <span className="ob-label">{copy('settings.profile.name')}</span>
              <input
                type="text"
                className="ob-input"
                value={name}
                placeholder={copy('player.defaultName')}
                autoComplete="nickname"
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
              />
              <span className="ob-hint">{text('onboarding.name.hint')}</span>
            </label>
            <div className="ob-actions">
              <Button label={copy('action.getStarted')} variant="primary" size="hero" onClick={() => dispatch({ type: 'next' })} />
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="ob-body">
            <h1 ref={headingRef} tabIndex={-1} className="ob-title">
              {text('onboarding.instrument.title')}
            </h1>
            <p className="ob-text">{text('onboarding.instrument.body')}</p>
            <div role="radiogroup" aria-label={text('onboarding.instrument.title')} className="ob-groups">
              {groups.map((g) => (
                <fieldset key={g.group} className="ob-family">
                  <legend className="ob-legend">{text(familyLabelKey(g.group))}</legend>
                  <div className="ob-grid">
                    {g.items.map((i) => (
                      <InstrumentCard key={i.id} i={i} name={radioName} checked={i.id === instrumentId} onSelect={() => setInstrumentId(i.id)} />
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <Toggle label={copy('settings.practice.beta')} checked={showBeta} onChange={setShowBeta} />
            <div className="ob-actions">
              <Button label={copy('action.continue')} variant="primary" disabled={!selectable} onClick={() => dispatch({ type: 'next' })} />
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="ob-body" data-testid="ob-mic">
            <Glyph id="mic" size={48} className="ob-mic-glyph" />
            <h1 ref={headingRef} tabIndex={-1} className="ob-title">
              {copy('onboarding.mic.title')}
            </h1>
            <p className="ob-text">{copy('onboarding.mic.body')}</p>
            {state.mic === 'denied' || state.mic === 'no-device' || state.mic === 'busy' || state.mic === 'insecure' ? (
              <MicProblemCard
                problem={state.mic}
                browser={services.micBrowser}
                onTryAgain={requestMic}
                onPractiseWithoutListening={() => dispatch({ type: 'mic-skip' })}
              />
            ) : (
              <div className="ob-actions">
                <Button label={copy('action.allowMicrophone')} variant="primary" icon="mic" loading={state.mic === 'requesting'} onClick={requestMic} />
                <Button label={copy('action.notNow')} variant="tertiary" onClick={() => dispatch({ type: 'mic-skip' })} />
              </div>
            )}
          </section>
        ) : null}

        {step === 4 ? (
          <section className="ob-body">
            <h1 ref={headingRef} tabIndex={-1} className="ob-title">
              {text('onboarding.calibration.title')}
            </h1>
            <CalibrationCard embedded allowSkip services={services.calibration} onDone={(result) => dispatch({ type: 'calibration-done', result })} />
          </section>
        ) : null}

        {step === 5 ? (
          <section className="ob-body" data-testid="ob-level">
            <h1 ref={headingRef} tabIndex={-1} className="ob-title">
              {text('onboarding.level.title')}
            </h1>
            <div className="ob-actions ob-actions-stack">
              <Button
                label={copy('onboarding.level.placement', { count: services.placement.excerpts, minutes: services.placement.minutes })}
                variant="primary"
                loading={saving}
                onClick={() => finish({ kind: 'placement' })}
              />
              {choosing ? null : <Button label={copy('onboarding.level.choose')} variant="secondary" onClick={() => setChoosing(true)} />}
            </div>
            {choosing ? (
              <div className="ob-choose">
                <Stepper ariaLabel={text('onboarding.level.stepper')} value={level} min={1} max={services.levelCount} onChange={setLevel} />
                <p className="ob-text" data-testid="ob-level-description">
                  {services.levelDescription(level)}
                </p>
                <Button label={copy('action.startPractising')} variant="primary" loading={saving} onClick={() => finish({ kind: 'level', level })} />
              </div>
            ) : null}
          </section>
        ) : null}
      </Card>
    </div>
  );
}

/** `#/welcome` (04 section 5.1). Without the composition root's services it stays a labelled stand-in. */
export function OnboardingScreen(props: ScreenProps) {
  const services = useOnboardingServices();
  if (!services) return <PlaceholderScreen {...props} />;
  return <Onboarding services={services} />;
}
