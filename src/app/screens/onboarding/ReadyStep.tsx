import type { RefObject } from 'react';
import type { Instrument } from '../../../core/types.ts';
import { ModePill } from '../../../ui/components/setup/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { instrumentName } from '../../../ui/copy/instrument-names.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import type { OnboardingState } from './flow.ts';
import { WizardFooter } from './WizardFooter.tsx';

export interface ReadyStepProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  state: OnboardingState;
  instrument: Instrument;
  /** The served range at difficulty 1, low and high names. */
  served: readonly [string, string] | null;
  saving: 'first-piece' | 'home' | null;
  onChangeInstrument: () => void;
  onRunTiming: () => void;
  onBack: () => void;
  onFinish: (to: 'first-piece' | 'home') => void;
}

function Row({ id, ok, label, value, detail, action }: { id: string; ok: boolean; label: string; value: string; detail?: string | null; action?: { label: string; onClick: () => void } | null }) {
  return (
    <li className="ob-ready-row" data-row={id} data-ok={ok ? 'true' : 'false'}>
      <span className="ob-ready-mark" aria-hidden="true">
        {ok ? <Glyph id="check" size={16} /> : '–'}
      </span>
      <span className="ob-ready-label">{label}</span>
      <span className="ob-ready-value">
        <span className="ob-ready-main">{value}</span>
        {detail ? <span className="ob-ready-detail">{detail}</span> : null}
      </span>
      {action ? (
        <button type="button" className="su-link ob-ready-action" onClick={action.onClick} aria-label={`${action.label}: ${label}`}>
          {action.label}
        </button>
      ) : (
        <span />
      )}
    </li>
  );
}

/**
 * Step 3, Ready (round 3, 01-ux-review §3.4): one row per item with a fix where one exists, the mode the first tries
 * will use, then "Start my first piece" (the cover at difficulty 1) or "Go to Home".
 */
export function ReadyStep({ headingRef, state, instrument, served, saving, onChangeInstrument, onRunTiming, onBack, onFinish }: ReadyStepProps) {
  const micOn = state.mic === 'granted';
  const timing = state.timing;
  const measured = timing === 'calibrated';
  const ranked = micOn && measured;
  return (
    <>
      <section className="ob-ready" data-testid="ob-ready">
        <div className="ob-sound-head">
          <h1 ref={headingRef} tabIndex={-1} className="ob-title">
            {copy('onboarding.ready.title')}
          </h1>
          <p className="ob-text">{copy('onboarding.ready.body')}</p>
        </div>
        <div className="ob-ready-card">
          <ul className="ob-ready-list">
            <Row
              id="instrument"
              ok
              label={copy('onboarding.step.instrument')}
              value={instrumentName(instrument)}
              detail={served ? copy('range.atDifficulty', { level: 1, low: served[0], high: served[1] }) : null}
              action={{ label: copy('action.change'), onClick: onChangeInstrument }}
            />
            <Row id="microphone" ok={micOn} label={copy('onboarding.stage.mic')} value={copy(micOn ? 'onboarding.ready.mic.on' : 'onboarding.ready.mic.off')} />
            {state.match ? (
              <Row
                id="hear"
                ok={state.hear === 'heard'}
                label={copy('onboarding.stage.hear')}
                value={copy(state.hear === 'heard' ? 'onboarding.ready.hear.ok' : micOn ? 'onboarding.stage.status.skipped' : 'onboarding.stage.status.needsMic')}
              />
            ) : null}
            <Row
              id="timing"
              ok={measured}
              label={copy('onboarding.stage.timing')}
              value={copy(measured ? 'onboarding.ready.timing.ok' : timing === 'estimate' ? 'onboarding.ready.timing.estimate' : micOn ? 'onboarding.ready.timing.none' : 'onboarding.stage.status.needsMic', { ms: state.timingMs ?? 0 })}
              detail={measured ? null : micOn ? copy('onboarding.ready.timing.none.detail') : null}
              action={micOn && !measured ? { label: copy('action.runItNow'), onClick: onRunTiming } : null}
            />
            <Row id="difficulty" ok label={copy('row.level')} value={copy('onboarding.ready.difficulty')} detail={copy('onboarding.ready.difficulty.detail')} />
          </ul>
          <p className="ob-ready-mode" data-testid="ob-ready-mode">
            <Glyph id="info" size={16} />
            <ModePill mode={ranked ? 'ranked' : 'practice'} size="compact" />
            <span>{copy(ranked ? 'onboarding.ready.mode.ranked' : 'onboarding.ready.mode.practice')}</span>
          </p>
        </div>
      </section>
      <WizardFooter
        onBack={onBack}
        skip={{ label: copy('onboarding.ready.home'), onClick: () => onFinish('home'), disabled: saving !== null, testId: 'ready-home' }}
        primary={{ label: copy('onboarding.ready.start'), onClick: () => onFinish('first-piece'), loading: saving === 'first-piece', testId: 'ready-start' }}
      />
    </>
  );
}
