/**
 * Listen on results (05 sections 8.11 and 9.3, designer's note 10, 06 section 6.15): the live caption ("Playing bar n
 * of m" while it plays, "From bar n" for a tapped bar), the "Slower" switch (75%) and Listen, which reads "Stop" with
 * the stop icon on a brass edge while it plays. The screen's one polite region says "Stopped"; bars are not announced.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { idleSoundView, type SoundView } from '../../../session/index.ts';
import { Toggle } from '../../../ui/components/form/index.ts';
import { LiveCaption } from '../../../ui/components/sounds/index.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { text } from './text.ts';

const IDLE = idleSoundView();
const NO_SOUNDS = { getState: (): SoundView => IDLE, subscribe: () => () => undefined };

/** The sound store as it concerns the excerpt on screen: a stored attempt's sound (history) reads as idle here. */
export function useResultsSound(sounds: StoreApi<SoundView> | undefined): SoundView {
  const store = sounds ?? NO_SOUNDS;
  const view = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return useMemo(() => (view.attemptId === null ? view : IDLE), [view]);
}

/** Listen or Hear bar n is sounding. */
export const isListening = (s: SoundView): boolean => s.playing === 'listen' || s.playing === 'bar';

/** The caption beside the toolbar: what is sounding, a failure, or the bar Listen will start from. */
export function resultsListenCaption(sound: SoundView, fromBar: number | null): { text: string; live: boolean } | null {
  if (sound.failed) return { text: text('sound.failed'), live: true };
  const c = sound.caption;
  if (isListening(sound) && c && c.kind === 'bar') return { text: text('listen.playing', { n: c.bar, total: c.of }), live: true };
  if (!isListening(sound) && fromBar !== null && fromBar > 1) return { text: text('listen.fromBar', { n: fromBar }), live: false };
  return null;
}

export interface ResultsListenProps {
  sound: SoundView;
  slower: boolean;
  fromBar: number | null;
  onSlower: (on: boolean) => void;
  onListen: () => void;
  onStop: () => void;
}

export function ResultsListen({ sound, slower, fromBar, onSlower, onListen, onStop }: ResultsListenProps) {
  const playing = isListening(sound);
  const caption = resultsListenCaption(sound, fromBar);
  return (
    <div className="res-listen" data-testid="listen-controls" data-playing={playing ? 'true' : 'false'}>
      {caption ? (
        caption.live ? (
          <LiveCaption failed={sound.failed}>{caption.text}</LiveCaption>
        ) : (
          <p className="res-from-bar" data-testid="from-bar">
            {caption.text}
          </p>
        )
      ) : null}
      <Toggle checked={slower} label={text('listen.slower')} onChange={onSlower} />
      <button
        type="button"
        className={playing ? 'ui-button ui-button-secondary ui-button-compact res-listen-button res-listen-playing' : 'ui-button ui-button-primary ui-button-compact res-listen-button'}
        data-testid="listen-button"
        onClick={playing ? onStop : onListen}
      >
        <Glyph id={playing ? 'stop' : 'listen'} size={16} />
        <span>{playing ? text('action.stop') : text('action.listen')}</span>
      </button>
    </div>
  );
}
