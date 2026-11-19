import './onboarding.css';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Configs } from '../../../core/types.ts';
import { InstrumentGrid, PickedRange } from '../../../ui/components/picker/index.ts';
import { Card } from '../../../ui/components/containers/index.ts';
import { Button, Toggle } from '../../../ui/components/form/index.ts';
import { DifficultyControl } from '../../../ui/components/setup/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { appConfigs } from '../../compose/configs.ts';
import { useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { PlaceholderScreen } from '../Placeholder.tsx';
import { calibrationIsMandatoryPath } from '../calibration/flow.ts';
import { CalibrationCard } from '../calibration/CalibrationCard.tsx';
import { deniedStepsKey, micProblemKey, type MicProblem } from '../states/mic.ts';
import { text } from '../states/text.ts';
import { initialOnboarding, onboardingReducer, STEP_COUNT, type OnboardingStep } from './flow.ts';
import { assumeServed, difficultyRowFor, rangeData, START_DIFFICULTY } from './ranges.ts';
import { useOnboardingServices, type LevelChoice, type OnboardingServices } from './services.ts';
import { useMedia } from './use-media.ts';
import { WelcomePhrase } from './WelcomePhrase.tsx';

/** "Microphone is on." stays on screen this long before the calibration step opens (05 section 8.3). */
export const MIC_GRANTED_HOLD_MS = 600;

/** Where the picture moves from a pinned bottom panel to the page's right column. */
const WIDE_QUERY = '(min-width: 64rem)';
/** Below this the picker's cards use the phone layout (the same switch as the picker dialog). */
const PHONE_QUERY = '(max-width: 43.6875rem)';

function Wordmark() {
  return (
    <div className="ob-wordmark">
      <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
        <g stroke="var(--text)" strokeWidth="1.3" opacity="0.9">
          <path d="M1.5 4.5h21M1.5 8.25h21M1.5 12h21M1.5 15.75h21M1.5 19.5h21" />
        </g>
        <ellipse cx="13" cy="10.1" rx="3.6" ry="2.6" transform="rotate(-22 13 10.1)" fill="var(--brass)" />
      </svg>
      <span>{copy('app.name')}</span>
    </div>
  );
}

function MicProblemBlock({
  problem,
  browser,
  onTryAgain,
  onContinue,
}: {
  problem: MicProblem;
  browser: OnboardingServices['micBrowser'];
  onTryAgain: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="ob-problem" role="alert" data-testid={`mic-${problem}`}>
      <Glyph id="mic-off" size={32} className="ob-problem-icon" />
      <p className="ob-problem-body">{text(problem === 'denied' ? 'permission.denied.title' : micProblemKey(problem))}</p>
      {problem === 'denied' ? <p className="ob-problem-steps">{text(deniedStepsKey(browser))}</p> : null}
      <div className="ob-actions">
        {problem !== 'insecure' ? <Button label={copy('action.tryAgain')} variant="primary" onClick={onTryAgain} /> : null}
        <Button label={copy('onboarding.mic.continueWithout')} variant={problem === 'insecure' ? 'primary' : 'secondary'} onClick={onContinue} />
      </div>
    </div>
  );
}

function Onboarding({ services }: { services: OnboardingServices }) {
  const navigate = useNavigate();
  const cfg: Configs = useMemo(() => appConfigs(), []);
  const [state, dispatch] = useReducer(onboardingReducer, undefined, initialOnboarding);
  const [instrumentId, setInstrumentId] = useState(services.initial.instrumentId);
  const [showBeta, setShowBeta] = useState(services.initial.showBeta);
  const [level, setLevel] = useState(START_DIFFICULTY);
  const [chose, setChose] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wide = useMedia(WIDE_QUERY);
  const phone = useMedia(PHONE_QUERY);
  const step: OnboardingStep = state.step;
  const micAllowed = state.mic === 'granted';
  // With the microphone off, placement cannot run, so "I'll choose" is already open.
  const choosing = chose ?? !micAllowed;
  const eligible = services.countEligible?.bind(services) ?? assumeServed;

  // Welcome puts focus on its one action; every later step puts it on the heading, so keyboard and screen reader
  // users land at the top of the step (WCAG 2.4.3).
  useEffect(() => {
    if (step === 1) document.getElementById('ob-start')?.focus({ preventScroll: true });
    else headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  // Leaving the picker page stops any range note still sounding.
  useEffect(() => {
    if (step !== 2 && step !== 5) services.stopSounds?.();
  }, [step, services]);
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      services.stopSounds?.();
    },
    [services],
  );

  const instruments = services.instruments;
  const selected = instruments.find((i) => i.id === instrumentId) ?? instruments[0];
  const rangeFor = useMemo(
    () => (id: string) => {
      const inst = instruments.find((i) => i.id === id) ?? instruments[0];
      if (!inst) throw new RangeError(`no instrument ${id}`);
      return rangeData(cfg, inst, START_DIFFICULTY);
    },
    [cfg, instruments],
  );
  const hear = services.playNote ? (midi: number): void => void services.playNote?.(midi) : undefined;

  const finish = (choice: LevelChoice): void => {
    setSaving(true);
    void services
      .finish({
        displayName: copy('player.defaultName'),
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
      (r) => {
        if (!r.ok) {
          dispatch({ type: 'mic-problem', problem: r.problem });
          return;
        }
        dispatch({ type: 'mic-granted' });
        holdTimer.current = setTimeout(() => dispatch({ type: 'mic-continue' }), MIC_GRANTED_HOLD_MS);
      },
      () => dispatch({ type: 'mic-problem', problem: 'no-device' }),
    );
  };

  const goBack = (): void => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    dispatch({ type: 'back' });
  };

  const header =
    step > 1 ? (
      <header className="ob-head">
        <Button label={copy('common.back')} variant="quiet" size="compact" icon="chevron-left" onClick={goBack} />
        <p className="ob-step">{copy('onboarding.step', { n: step, total: STEP_COUNT })}</p>
      </header>
    ) : null;

  const picked = selected ? (
    <PickedRange
      instrument={selected}
      data={rangeFor(selected.id)}
      onHearNote={hear ? (midi) => hear(midi) : undefined}
            variant={wide ? 'column' : 'panel'}
    />
  ) : null;

  const difficultyInst = selected;
  const difficultyPicture = difficultyInst ? (
    <PickedRange
      instrument={difficultyInst}
      data={rangeData(cfg, difficultyInst, level)}
      onHearNote={hear ? (midi) => hear(midi) : undefined}
            variant="column"
    />
  ) : null;

  return (
    <div className="ob" data-testid="screen-welcome" data-route-id="welcome" data-step={step} data-wide={wide ? 'true' : 'false'}>
      {header}

      {step === 1 ? (
        <section className="ob-welcome">
          <Wordmark />
          <div className="ob-paper">
            <WelcomePhrase />
          </div>
          <h1 ref={headingRef} tabIndex={-1} className="ob-display">
            {copy('welcome.headline')}
          </h1>
          <p className="ob-lede">{copy('welcome.body')}</p>
          <Button id="ob-start" label={copy('action.getStarted')} variant="primary" size="hero" onClick={() => dispatch({ type: 'next' })} />
          <p className="ob-privacy">{copy('welcome.privacy')}</p>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="ob-pick" data-testid="ob-instrument">
          <div className="ob-pick-head">
            <h1 ref={headingRef} tabIndex={-1} className="ob-title">
              {copy('onboarding.instrument.title')}
            </h1>
            <p className="ob-text">{copy('onboarding.instrument.body')}</p>
          </div>
          <div className="ob-pick-grid">
            <InstrumentGrid
              instruments={instruments}
              value={instrumentId}
              onChange={setInstrumentId}
              rangeFor={rangeFor}
              showLessTested={showBeta}
              keep={[instrumentId]}
                            layout={phone ? 'phone' : 'desktop'}
            />
            <div className="ob-pick-switch">
              <Toggle label={copy('settings.practice.beta')} checked={showBeta} onChange={setShowBeta} />
            </div>
          </div>
          <aside className="ob-pick-side" aria-label={copy('onboarding.instrument.title')}>
            {picked}
            <Button label={copy('action.continue')} variant="primary" onClick={() => dispatch({ type: 'next' })} />
          </aside>
        </section>
      ) : null}

      {step === 3 ? (
        <Card className="ob-card">
          <section className="ob-body" data-testid="ob-mic">
            <Glyph id="mic" size={48} className="ob-mic-glyph" />
            <h1 ref={headingRef} tabIndex={-1} className="ob-title">
              {copy('onboarding.mic.title')}
            </h1>
            <p className="ob-text">{copy('onboarding.mic.body')}</p>
            {state.mic === 'denied' || state.mic === 'no-device' || state.mic === 'busy' || state.mic === 'insecure' ? (
              <MicProblemBlock problem={state.mic} browser={services.micBrowser} onTryAgain={requestMic} onContinue={() => dispatch({ type: 'mic-skip' })} />
            ) : state.mic === 'granted' ? (
              <p className="ob-granted" role="status">
                <Glyph id="check" size={20} />
                <span>{copy('onboarding.mic.granted')}</span>
              </p>
            ) : (
              <div className="ob-actions ob-actions-stack">
                <Button label={copy('action.allowMicrophone')} variant="primary" icon="mic" loading={state.mic === 'requesting'} onClick={requestMic} />
                <Button label={copy('action.notNow')} variant="quiet" onClick={() => dispatch({ type: 'mic-skip' })} />
                <p className="ob-hint">{copy('onboarding.mic.notNowHint')}</p>
              </div>
            )}
          </section>
        </Card>
      ) : null}

      {step === 4 ? (
        <section className="ob-cal" data-testid="ob-calibration">
          <h1 ref={headingRef} tabIndex={-1} className="ob-title">
            {text('onboarding.calibration.title')}
          </h1>
          {/* The calibration card is the step's own card; nothing wraps it. */}
          <CalibrationCard embedded allowSkip services={services.calibration} onDone={(result) => dispatch({ type: 'calibration-done', result })} />
          {calibrationIsMandatoryPath(services.calibration.capabilities) ? null : <p className="ob-hint ob-skip-hint">{copy('calibrate.skipHint')}</p>}
        </section>
      ) : null}

      {step === 5 ? (
        <Card className="ob-card ob-card-level">
          <section className="ob-body" data-testid="ob-level">
            <h1 ref={headingRef} tabIndex={-1} className="ob-title">
              {text('onboarding.level.title')}
            </h1>
            <div className="ob-actions ob-actions-stack">
              <Button
                label={copy('onboarding.level.placement', { count: services.placement.excerpts, minutes: services.placement.minutes })}
                variant="primary"
                loading={saving && !choosing}
                disabled={!micAllowed}
                aria-describedby={micAllowed ? undefined : 'ob-needs-mic'}
                onClick={() => finish({ kind: 'placement' })}
              />
              {micAllowed ? null : (
                <p id="ob-needs-mic" className="ob-hint">
                  {copy('onboarding.level.needsMic')}
                </p>
              )}
              <Button label={copy('onboarding.level.choose')} variant={choosing ? 'tonal' : 'secondary'} aria-pressed={choosing} onClick={() => setChose(true)} />
            </div>
            {choosing && difficultyInst ? (
              <div className="ob-choose">
                <DifficultyControl
                  hideFollow
                  row={difficultyRowFor(cfg, difficultyInst.id, level, eligible, services.levelDescription(level))}
                  onChange={(l) => {
                    if (l !== 'random') setLevel(l);
                  }}
                />
                {difficultyPicture}
                <Button label={copy('action.startPractising')} variant="primary" loading={saving} onClick={() => finish({ kind: 'level', level })} />
              </div>
            ) : null}
          </section>
        </Card>
      ) : null}
    </div>
  );
}

/** `#/welcome` (05 section 8). Without the composition root's services it stays a labelled stand-in. */
export function OnboardingScreen(props: ScreenProps) {
  const services = useOnboardingServices();
  if (!services) return <PlaceholderScreen {...props} />;
  return <Onboarding services={services} />;
}
