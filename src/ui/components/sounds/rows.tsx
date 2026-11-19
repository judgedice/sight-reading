import type { ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';
import type { GlyphId } from '../../glyph-ids.ts';
import { TempoMarking } from '../setup/TempoRow.tsx';
import { splitAt } from '../setup/text.ts';
import type { SoundId, SoundsModel, TempoValue } from './types.ts';

/** One sound as the group, the dock and the explain sheet show it. */
export interface SoundRow {
  id: SoundId;
  icon: GlyphId;
  /** The full name: the visible title on desktop, the accessible name on the dock. */
  label: string;
  /** The dock's visible label. */
  shortLabel: string;
  /** Caption, always visible on desktop. */
  caption: ReactNode;
  playing: boolean;
  disabled: boolean;
}

/** "One bar of clicks at ♩ = 72." with the note drawn, not typed. */
export function TempoCaption({ tempo }: { tempo: TempoValue }) {
  const [before, after] = splitAt('hearTempo.caption', {}, 'tempo');
  return (
    <>
      {before}
      <TempoMarking unit={tempo.unit} bpm={tempo.bpm} />
      {after}
    </>
  );
}

/** "Tempo: ♩ = 72": the live caption text while the tempo plays. */
export function PlayingTempo({ tempo }: { tempo: TempoValue }) {
  const [before, after] = splitAt('sound.playing.tempo', {}, 'tempo');
  return (
    <>
      {before}
      <TempoMarking unit={tempo.unit} bpm={tempo.bpm} />
      {after}
    </>
  );
}

/**
 * The rows in the order of 06 section 6.8: Listen first, Hear the tempo, the reference, then Check my tuning when it
 * applies. `idle` shows every sound at rest (the explain sheet never reads "Stop").
 */
export function soundRows(model: SoundsModel, options: { idle?: boolean } = {}): SoundRow[] {
  const playing = options.idle ? null : model.playing;
  const voice = model.reference === 'voice';
  const listenPlaying = playing === 'listen';
  const off = (id: SoundId): boolean => model.disabled?.[id] === true;
  const rows: SoundRow[] = [
    {
      id: 'listen',
      icon: listenPlaying ? 'stop' : 'listen',
      label: listenPlaying ? copy('action.stop') : copy('action.listenFirst'),
      shortLabel: listenPlaying ? copy('action.stop') : copy('action.listenFirst'),
      caption: model.ranked && !listenPlaying && !options.idle ? copy('listen.rankedLine') : copy('listen.practiceCaption'),
      playing: listenPlaying,
      disabled: off('listen'),
    },
    {
      id: 'tempo',
      icon: 'metronome',
      label: copy('action.hearTempo'),
      shortLabel: copy('action.hearTempo.short'),
      caption: <TempoCaption tempo={model.tempo} />,
      playing: playing === 'tempo',
      disabled: off('tempo'),
    },
    {
      id: 'reference',
      icon: voice ? 'pitch' : 'key-chord',
      label: voice ? copy('action.hearReference') : copy('action.hearKey'),
      shortLabel: voice ? copy('action.hearReference.short') : copy('action.hearKey.short'),
      caption: voice ? copy('reference.caption.voice') : copy('reference.caption.instrument'),
      playing: playing === 'reference',
      disabled: off('reference'),
    },
  ];
  if (model.tuning) {
    rows.push({
      id: 'tuning',
      icon: 'tuning-fork',
      label: copy('action.tuningNote'),
      shortLabel: copy('action.tuningNote'),
      caption: playing === 'tuning' ? copy('tuning.listening') : copy('tuning.caption', { seconds: model.tuningSeconds }),
      playing: playing === 'tuning',
      disabled: off('tuning'),
    });
  }
  return rows;
}
