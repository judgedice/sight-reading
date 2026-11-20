import type { KeyboardEvent } from 'react';
import type { Clef, Instrument } from '../../../core/types.ts';
import { copy } from '../../copy/copy.ts';
import { instrumentName, instrumentShortName } from '../../copy/instrument-names.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import { RulerBar } from '../range/RulerBar.tsx';
import { formatRangeText, shortTranspositionText } from '../range/range-text.ts';
import type { RangeData } from '../range/types.ts';
import { instrumentIcon, voiceClef } from './groups.ts';

/** Bravura clefs for the voice tiles (06 section 6.11). */
const CLEF_GLYPH: Record<Clef, string> = {
  treble: '',
  'treble-8vb': '',
  bass: '',
  alto: '',
  tenor: '',
};

export interface InstrumentCardProps {
  instrument: Instrument;
  data: RangeData;
  checked: boolean;
  /** Roving tab stop: only one card in the group is tabbable. */
  tabbable: boolean;
  showServed: boolean;
  onSelect: (id: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Focus lands here when the dialog opens. */
  autoFocus?: boolean;
  /** Hover or focus: start loading this instrument's sound. Never plays. */
  onPrepare?: ((id: string) => void) | undefined;
}

/** The card's accessible name: "Baritone voice, range G2 to G4" (05 section 6.3, `instrument.card.a11y`). */
export function cardName(instrument: Instrument, data: RangeData): string {
  const [low, high] = data.model.names.full;
  return copy('instrument.card.a11y', { instrument: instrumentName(instrument), low, high });
}

/**
 * One instrument card (05 section 6.3, 06 section 6.11): icon tile (a clef for voices), name, range in text (sung for
 * voices, written for transposing instruments), the ruler on the shared C1 to C8 axis, then the second line: tenor
 * "Written an octave higher", transposing "Sounds a major 2nd lower · bars show sounding pitch". A radio.
 */
export function InstrumentCard({ instrument, data, checked, tabbable, showServed, onSelect, onKeyDown, autoFocus, onPrepare }: InstrumentCardProps) {
  const { model } = data;
  const voice = instrument.family === 'voice';
  const [low, high] = model.names.full;
  const note = model.cardNote;
  const octaveVoice = model.transposition.kind === 'voice-octave';
  const beta = instrument.status === 'beta';
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={cardName(instrument, data)}
      tabIndex={tabbable ? 0 : -1}
      className={['pk-card', voice ? 'pk-card-voice' : 'pk-card-instrument', checked ? 'is-on' : null].filter(Boolean).join(' ')}
      onClick={() => onSelect(instrument.id)}
      onKeyDown={onKeyDown}
      onPointerEnter={onPrepare ? () => onPrepare(instrument.id) : undefined}
      onFocus={onPrepare ? () => onPrepare(instrument.id) : undefined}
      data-instrument={instrument.id}
      data-autofocus={autoFocus ? '' : undefined}
    >
      <span className="pk-pic" aria-hidden="true">
        {voice ? <span className="pk-clef">{CLEF_GLYPH[voiceClef(instrument)]}</span> : <Glyph id={instrumentIcon(instrument.family)} size={24} />}
      </span>
      <span className="pk-name">
        <span>{instrumentShortName(instrument)}</span>
        {beta ? <span className="pk-badge">{copy('badge.beta')}</span> : null}
      </span>
      <span className="pk-range">{copy('range.cardText', { low, high })}</span>
      <span className="pk-ruler">
        <RulerBar full={model.concert.full} served={showServed ? model.concert.served : undefined} />
      </span>
      <span className="pk-note">
        {note && octaveVoice ? formatRangeText(note) : null}
        {note && !octaveVoice ? (
          <>
            <span>{shortTranspositionText(note)}</span>
            <span className="pk-note-sep">{copy('range.barsSounding')}</span>
          </>
        ) : null}
      </span>
      {checked ? (
        <span className="pk-check" aria-hidden="true">
          <Glyph id="check-ui" size={13} />
        </span>
      ) : null}
    </button>
  );
}
