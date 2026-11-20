import type { ReactNode } from 'react';
import type { Configs, Instrument } from '../../../core/types.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { MatchStaff } from './MatchStaff.tsx';
import { Needle } from './Needle.tsx';
import type { MatchController } from './use-match.ts';
import { hintLine, needleView, rangeChips, readName, stateLine, summaryLine, targetStaff, youLine } from './view.ts';

export interface MatchPanelProps {
  ctl: MatchController;
  instrument: Instrument;
  cfg: Configs;
  /** Practice: the range chips. Onboarding has none. */
  chips: boolean;
  /** Extra actions after Play it again (onboarding: Continue after a hit). */
  actions?: ReactNode;
  /** Under the state line, before the meter (onboarding: the other-voice offer). */
  aside?: ReactNode;
  /** From the summary: Done. */
  onDone?: () => void;
}

/** The body of "Match a note" (04-design §4): target, state line, "You" line, meter, hint, actions. */
export function MatchPanel({ ctl, instrument, cfg, chips, actions, aside, onDone }: MatchPanelProps) {
  const { state, mic } = ctl;
  const voice = instrument.family === 'voice';
  const name = readName(instrument, state.target);
  const staff = targetStaff(instrument, state.target);

  if (state.phase === 'summary') {
    const line = summaryLine(state);
    return (
      <section className="mt-summary" data-testid="match-summary">
        <div className="mt-summary-dots" aria-hidden="true">
          {state.results.map((r, i) => (
            <span key={i} className="mt-dot" data-done={r.hit ? 'hit' : 'miss'} />
          ))}
        </div>
        {line ? (
          <h2 className="mt-summary-line" role="status">
            {line}
          </h2>
        ) : null}
        <p className="mt-hint">{copy('match.summary.note')}</p>
        <div className="mt-actions">
          <Button label={copy('match.again')} variant="primary" onClick={ctl.fiveMore} />
          {onDone ? <Button label={copy('match.done')} variant="secondary" onClick={onDone} /> : null}
        </div>
      </section>
    );
  }

  const noMic = mic === 'none' || mic === 'requesting';
  const line = noMic ? { text: copy('match.noMic'), tone: 'quiet' as const, chevron: null } : stateLine(state, instrument);
  const you = noMic ? null : youLine(state, instrument);
  const hint = noMic ? null : hintLine(state);
  const needle = needleView(state);
  const ring = state.phase === 'hit' ? 'hit' : state.phase === 'idle' && mic === 'allowed' ? 'playing' : null;
  const youText = you ? (
    <>
      {you.text.slice(0, you.text.indexOf(you.note))}
      <strong>{you.note}</strong>
      {you.text.slice(you.text.indexOf(you.note) + you.note.length)}
    </>
  ) : null;

  return (
    <div className="mt-body" data-phase={noMic ? 'no-mic' : state.phase}>
      <div className="mt-target">
        <div className="mt-paper">
          <MatchStaff note={staff.note} ring={ring} />
        </div>
        <div className="mt-name">
          <p className="mt-note" data-testid="match-target">
            {name}
          </p>
          <p className="mt-sub">{copy(voice ? 'match.target' : 'match.target.instrument')}</p>
        </div>
      </div>

      <p className="mt-line" data-tone={line.tone} data-chevron={line.chevron ?? 'none'} role="status" data-testid="match-line">
        {line.chevron === 'left-up' ? <Glyph id="chevron-down" size={32} className="mt-chevron mt-chevron-up" /> : null}
        {line.tone === 'hit' ? <Glyph id="check-ui" size={32} className="mt-check" /> : null}
        <span>{line.text}</span>
        {line.chevron === 'right-down' ? <Glyph id="chevron-down" size={32} className="mt-chevron" /> : null}
      </p>
      <p className="mt-you" data-testid="match-you">
        {youText}
      </p>
      {aside}

      <Needle view={noMic ? { ...needle, at: null, dim: true } : needle} />
      <p className="mt-hint" data-testid="match-hint">
        {hint ?? ''}
      </p>

      <div className="mt-foot">
        {noMic ? (
          <div className="mt-actions">
            <Button label={copy('action.allowMicrophone')} variant="primary" icon="mic" loading={mic === 'requesting'} onClick={ctl.allowMic} />
          </div>
        ) : (
          <>
            <div className="mt-actions">
              <Button label={copy('match.playAgain')} variant="secondary" icon="play" className="mt-again" onClick={ctl.playAgain} />
              {actions}
            </div>
            {chips ? (
              <div className="mt-chips" role="group" aria-label={copy('match.pickNote')}>
                <span className="mt-chips-label">{copy('match.pickNote')}</span>
                <span className="mt-chips-row">
                  {rangeChips(instrument, cfg).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="mt-chip"
                      aria-pressed={m === state.target}
                      data-testid={`match-chip-${m}`}
                      onClick={() => ctl.chooseNote(m)}
                    >
                      {readName(instrument, m)}
                    </button>
                  ))}
                </span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
