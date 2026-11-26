import { useEffect, useReducer } from 'react';
import type { Configs, Instrument } from '../../../core/types.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { instrumentShortName } from '../../../ui/copy/instrument-names.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { actWord, hearReducer, heardName, initialHear, voiceAbove, type HearFrame, type HearState } from './hear-model.ts';
import type { OnboardingServices } from './services.ts';

/**
 * Listens for "Hear you" while `active`: capture opens at once (no target note), every frame goes through the pure
 * reducer, and everything stops on the way out. Nothing is graded or stored.
 */
export function useHear(services: OnboardingServices['match'], instrument: Instrument | undefined, active: boolean): HearState {
  const [state, dispatch] = useReducer(hearReducer, undefined, initialHear);
  const id = instrument?.id;
  useEffect(() => {
    if (!active || !services || !id) return undefined;
    let live = true;
    const engine = services.service;
    void engine
      .listenAny(id, (f: HearFrame) => {
        if (live) dispatch({ t: f.t, midi: f.midi, levelDb: f.levelDb, steady: f.steady });
      })
      .catch(() => undefined);
    return () => {
      live = false;
      engine.stop();
    };
  }, [active, services, id]);
  return state;
}

export interface HearPanelProps {
  state: HearState;
  instrument: Instrument;
  cfg: Configs;
  /** "Choose tenor": the note sat above this voice's range. */
  onChangeVoice: (instrumentId: string) => void;
  headingId: string;
}

/**
 * The "Hear you" stage card (mockup wizard-2b): "Sing any note", the input level, then the note name in large type,
 * fixed once steady, with "We hear you clearly." It never follows the voice after that: tuning is Match a note's job.
 */
export function HearPanel({ state, instrument, cfg, onChangeVoice, headingId }: HearPanelProps) {
  const voice = instrument.family === 'voice';
  const note = state.note;
  const other = note !== null && state.heard ? voiceAbove(cfg, instrument, note) : null;
  const percent = Math.round(state.level * 100);
  const name = note !== null ? heardName(instrument, note) : null;
  return (
    <section className="ob-stage-panel ob-hear" data-testid="ob-hear" data-heard={state.heard ? 'true' : undefined} aria-labelledby={headingId}>
      <h2 id={headingId} className="ob-stage-title" tabIndex={-1}>
        {copy('onboarding.stage.hear.sub', { act: actWord(voice) })}
      </h2>
      <p className="ob-text">{copy('onboarding.hear.body', { act: actWord(voice) })}</p>
      <div className="ob-level">
        <p className="ob-level-label" id={`${headingId}-level`}>
          {copy('onboarding.hear.level')}
        </p>
        <span className="ob-level-track" role="meter" aria-labelledby={`${headingId}-level`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span className="ob-level-fill" style={{ inlineSize: `${percent}%` }} />
        </span>
      </div>
      <div className="ob-heard" data-state={state.heard ? 'heard' : name ? 'steady' : state.quiet ? 'quiet' : 'listening'}>
        {name ? (
          <p className="ob-heard-note" data-testid="ob-heard-note" aria-hidden={state.heard ? undefined : 'true'}>
            {name}
          </p>
        ) : null}
        <div className="ob-heard-text" role="status" aria-live="polite">
          {state.heard && name ? (
            <>
              <p className="ob-heard-ok">
                <Glyph id="check" size={16} />
                <span>{copy('onboarding.hear.heard')}</span>
              </p>
              {other ? null : (
                <p className="ob-heard-where">
                  {voice ? copy('onboarding.hear.where', { note: name, voice: instrumentShortName(instrument).toLowerCase() }) : copy('onboarding.hear.where.instrument', { note: name })}
                </p>
              )}
            </>
          ) : state.quiet ? (
            <p className="ob-heard-where">{copy('onboarding.hear.quiet', { act: actWord(voice) })}</p>
          ) : (
            <p className="ob-heard-where">{copy('calibrate.listening')}</p>
          )}
        </div>
      </div>
      {other ? (
        <p className="ob-offer" data-testid="ob-other-voice">
          <span>
            {copy('match.onboarding.otherVoice', { voice: instrumentShortName(instrument).toLowerCase(), other: instrumentShortName(other).toLowerCase() })}
          </span>
          <Button label={copy('match.onboarding.changeVoice', { other: instrumentShortName(other) })} variant="tonal" size="compact" onClick={() => onChangeVoice(other.id)} />
        </p>
      ) : null}
      <p className="ob-hint">{copy('onboarding.hear.tuning')}</p>
    </section>
  );
}
