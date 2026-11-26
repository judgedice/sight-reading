import './onboarding.css';
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { Configs, Instrument } from '../../../core/types.ts';
import { InstrumentGrid, PickedRange, type PickerSoundView } from '../../../ui/components/picker/index.ts';
import { hasSoundSet, soundSetFor } from '../../../instruments/sound-sets.ts';
import { rangeModel } from '../../../instruments/range.ts';
import { Button, Toggle } from '../../../ui/components/form/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { appConfigs } from '../../compose/configs.ts';
import { useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { PlaceholderScreen } from '../Placeholder.tsx';
import { calibrationIsMandatoryPath } from '../calibration/flow.ts';
import { initialOnboarding, onboardingReducer, progressOf, restoreProgress, resumeState, stageProgress, type OnboardingState } from './flow.ts';
import { rangeData, START_DIFFICULTY } from './ranges.ts';
import { ReadyStep } from './ReadyStep.tsx';
import { useOnboardingServices, type OnboardingServices } from './services.ts';
import { SoundCheckStep } from './SoundCheckStep.tsx';
import { useMedia } from './use-media.ts';
import { WelcomePhrase } from './WelcomePhrase.tsx';
import { WizardFooter } from './WizardFooter.tsx';
import { WizardStepper } from './WizardStepper.tsx';

/** Where the picture moves from the bottom of the page to the page's right column. */
const WIDE_QUERY = '(min-width: 64rem)';
/** Below this the picker's cards use the phone layout (the same switch as the picker dialog). */
const PHONE_QUERY = '(max-width: 43.6875rem)';

const NO_SOUND = { get: () => null, subscribe: () => () => undefined };

/** The machine's start: a saved position when there is one, else Welcome. */
function startState(services: OnboardingServices): { state: OnboardingState; instrumentId: string | null; showBeta: boolean; resumed: boolean } {
  const opts = { match: services.match !== undefined, mandatory: calibrationIsMandatoryPath(services.capabilities) };
  const saved = restoreProgress(services.progress ?? null);
  const known = (id: string | null): string | null => (id !== null && services.instruments.some((i) => i.id === id) ? id : null);
  if (!saved) return { state: initialOnboarding(opts), instrumentId: known(services.initial.instrumentId), showBeta: services.initial.showBeta, resumed: false };
  const instrumentId = known(saved.instrumentId);
  // A resumed step past the picker needs an instrument; without one the picker opens.
  const state = instrumentId === null ? { ...initialOnboarding(opts), step: 'instrument' as const } : resumeState(saved, opts);
  return { state, instrumentId, showBeta: saved.showBeta || services.initial.showBeta, resumed: true };
}

/**
 * First-run setup (round 3, 01-ux-review §3, R74): Welcome (not counted), then Instrument, Sound check (Microphone,
 * Hear you, Timing on one screen) and Ready, under a named stepper with a fixed footer. Everyone starts at
 * difficulty 1 (R75). The position is saved on every step change, so a reload resumes there.
 */
function Onboarding({ services }: { services: OnboardingServices }) {
  const navigate = useNavigate();
  const cfg: Configs = useMemo(() => appConfigs(), []);
  const start = useMemo(() => startState(services), [services]);
  const [state, dispatch] = useReducer(onboardingReducer, start.state);
  const [instrumentId, setInstrumentId] = useState<string | null>(start.instrumentId);
  const [showBeta, setShowBeta] = useState(start.showBeta);
  const [saving, setSaving] = useState<'first-piece' | 'home' | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wide = useMedia(WIDE_QUERY);
  const phone = useMedia(PHONE_QUERY);
  const step = state.step;

  // Save the position on every change (R74); finishing clears it.
  useEffect(() => {
    if (saving) return;
    services.saveProgress?.(progressOf(state, instrumentId, showBeta));
  }, [services, state, instrumentId, showBeta, saving]);

  // Welcome puts focus on its one action; every later step puts it on the heading (WCAG 2.4.3).
  const focusKey = step === 'sound' ? `sound:${state.stage}` : step;
  useEffect(() => {
    if (step === 'welcome') document.getElementById('ob-start')?.focus({ preventScroll: true });
    else if (step === 'sound') (document.querySelector('.ob-stage-card .ob-stage-title') as HTMLElement | null)?.focus({ preventScroll: true });
    else headingRef.current?.focus({ preventScroll: true });
  }, [focusKey, step]);

  // Leaving the picker stops any range note still sounding.
  useEffect(() => {
    if (step !== 'instrument') services.stopSounds?.();
  }, [step, services]);
  useEffect(() => () => services.stopSounds?.(), [services]);

  const instruments = services.instruments;
  const selected: Instrument | undefined = instrumentId === null ? undefined : instruments.find((i) => i.id === instrumentId);
  const rangeFor = useMemo(
    () => (id: string) => {
      const inst = instruments.find((i) => i.id === id) ?? instruments[0];
      if (!inst) throw new RangeError(`no instrument ${id}`);
      return rangeData(cfg, inst, START_DIFFICULTY);
    },
    [cfg, instruments],
  );
  const hear = services.playNote ? (midi: number): void => void services.playNote?.(midi) : undefined;
  const pickerSound = services.pickerSound;
  const soundSrc = pickerSound?.state ?? NO_SOUND;
  const soundState = useSyncExternalStore<{ playing: string | null; index: number | null; failed: boolean } | null>(soundSrc.subscribe, soundSrc.get, soundSrc.get);
  const sound = useMemo<PickerSoundView | undefined>(
    () =>
      pickerSound
        ? {
            play: (id, midis) => pickerSound.play(id, midis),
            stop: () => pickerSound.stop(),
            prepare: (id) => pickerSound.prepare(id),
            playing: soundState?.playing ?? null,
            index: soundState?.index ?? null,
            failed: soundState?.failed ?? false,
          }
        : undefined,
    [pickerSound, soundState],
  );
  const standInId = selected && hasSoundSet(selected.id) ? soundSetFor(selected.id).standIn : null;
  const standIn = standInId ? (cfg.instrumentById[standInId] ?? null) : null;
  const served = selected ? rangeModel(cfg, selected, START_DIFFICULTY).names.served : null;

  const finish = (to: 'first-piece' | 'home'): void => {
    if (!selected) return;
    setSaving(to);
    void services
      .finish({
        displayName: copy('player.defaultName'),
        instrumentId: selected.id,
        showBeta,
        micAllowed: state.mic === 'granted',
        calibration: state.timing === 'n/a' ? null : state.timing,
        hear: state.hear === 'pending' ? 'skipped' : state.hear,
        start: to,
      })
      .then((path) => navigate(path, { replace: true }))
      .catch(() => setSaving(null));
  };

  const goBack = (): void => dispatch({ type: 'back' });
  const stepper = step === 'welcome' ? null : <WizardStepper step={step} progress={stageProgress(state)} onGoTo={(s) => dispatch({ type: 'goto-step', step: s })} />;

  return (
    <div className="ob" data-testid="screen-welcome" data-route-id="welcome" data-step={step} data-stage={step === 'sound' ? state.stage : undefined} data-wide={wide ? 'true' : 'false'}>
      {step === 'welcome' ? (
        <section className="ob-welcome">
          <div className="ob-paper">
            <WelcomePhrase />
          </div>
          <h1 ref={headingRef} tabIndex={-1} className="ob-display">
            {copy('welcome.headline')}
          </h1>
          <p className="ob-lede">{copy('welcome.body')}</p>
          <Button id="ob-start" label={copy('action.getStarted')} variant="primary" size="hero" onClick={() => dispatch({ type: 'next' })} />
          <div className="ob-welcome-steps">
            <p className="ob-hint">{copy('welcome.steps')}</p>
            <WizardStepper step="welcome" progress={0} preview />
          </div>
          <p className="ob-privacy">{copy('welcome.privacy')}</p>
        </section>
      ) : null}

      {stepper}

      {step === 'instrument' ? (
        <>
          <section className="ob-pick" data-testid="ob-instrument">
            <div className="ob-pick-head">
              <h1 ref={headingRef} tabIndex={-1} className="ob-title">
                {copy('onboarding.instrument.title')}
              </h1>
              <p className="ob-text" id="ob-pick-why">
                {copy('onboarding.instrument.body')}
              </p>
            </div>
            <div className="ob-pick-grid">
              <InstrumentGrid
                instruments={instruments}
                value={instrumentId}
                onChange={setInstrumentId}
                rangeFor={rangeFor}
                showLessTested={showBeta}
                keep={instrumentId ? [instrumentId] : []}
                layout={phone ? 'phone' : 'desktop'}
              />
              <div className="ob-pick-switch">
                <Toggle label={copy('settings.practice.beta')} checked={showBeta} onChange={setShowBeta} />
              </div>
            </div>
            <aside className="ob-pick-side" aria-label={copy('picker.selected')}>
              {selected && served ? (
                <>
                  <PickedRange instrument={selected} data={rangeFor(selected.id)} onHearNote={hear ? (midi) => hear(midi) : undefined} sound={sound} standIn={standIn} variant={wide ? 'column' : 'panel'} />
                  <p className="ob-start-line" data-testid="ob-start-line">
                    {copy('onboarding.instrument.start', { low: served[0], high: served[1] })}
                  </p>
                </>
              ) : null}
            </aside>
          </section>
          <WizardFooter
            onBack={goBack}
            primary={{ label: copy('onboarding.next.sound'), onClick: () => dispatch({ type: 'next' }), disabled: selected === undefined, describedBy: 'ob-pick-why', testId: 'wizard-next' }}
          />
        </>
      ) : null}

      {step === 'sound' && selected ? (
        <SoundCheckStep services={services} cfg={cfg} state={state} dispatch={dispatch} instrument={selected} phone={!wide} onChangeVoice={setInstrumentId} onBack={goBack} />
      ) : null}

      {step === 'ready' && selected ? (
        <ReadyStep
          headingRef={headingRef}
          state={state}
          instrument={selected}
          served={served}
          saving={saving}
          onChangeInstrument={() => dispatch({ type: 'goto-step', step: 'instrument' })}
          onRunTiming={() => dispatch({ type: 'goto-timing' })}
          onBack={goBack}
          onFinish={finish}
        />
      ) : null}
    </div>
  );
}

/** `#/welcome` (05 section 8; round 3 R74). Without the composition root's services it stays a labelled stand-in. */
export function OnboardingScreen(props: ScreenProps) {
  const services = useOnboardingServices();
  if (!services) return <PlaceholderScreen {...props} />;
  return <Onboarding services={services} />;
}
