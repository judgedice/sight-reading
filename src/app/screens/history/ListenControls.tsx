/**
 * Listen on attempt detail (05 sections 8.12, 9.3): a "Slower" switch and the Listen button, which reads "Stop" while
 * it plays, with the live caption ("Playing bar n of m", "From bar n"). Playing is the session's sound store for this
 * attempt; the start bar is the bar the player tapped in the score.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { SoundView } from '../../../session/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { Button, Toggle } from '../../../ui/components/form/index.ts';
import { LiveCaption } from '../../../ui/components/sounds/index.ts';
import { beatUnit } from '../setup/model.ts';

const IDLE: SoundView = {
  playing: null,
  caption: null,
  bar: null,
  fromBar: null,
  slower: false,
  attemptId: null,
  failed: false,
  startsAt: null,
  endsAt: null,
};
const NO_SOUNDS = { getState: (): SoundView => IDLE, subscribe: () => () => undefined };

/** What the sound store says about this attempt: idle for every other sound and every other attempt. */
export function useAttemptSound(sounds: StoreApi<SoundView> | undefined, attemptId: string): SoundView {
  const store = sounds ?? NO_SOUNDS;
  const view = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return useMemo(() => (view.attemptId === attemptId ? view : view.failed ? { ...IDLE, failed: true } : IDLE), [view, attemptId]);
}

export interface ListenControlsProps {
  sound: SoundView;
  slower: boolean;
  /** The bar a tap chose (displayed bar number), or null for the start. */
  fromBar: number | null;
  /** The excerpt's meter, for the beat unit in the lead-in caption. */
  meter: string | null;
  onSlower: (slower: boolean) => void;
  onListen: () => void;
  onStop: () => void;
}

/** The caption line: a failure, what is sounding, or the bar Listen will start from. */
export function listenCaption(sound: SoundView, fromBar: number | null, meter: string | null): string | null {
  if (sound.failed) return copy('sound.failed');
  const c = sound.caption;
  if (sound.playing !== null && c) {
    if (c.kind === 'bar') return copy('listen.playing', { n: c.bar, total: c.of });
    if (c.kind === 'lead-in') return copy('sound.playing.tempo', { tempo: copy('tempo.marking', { unit: beatUnit(meter ?? '4/4'), bpm: c.bpm }) });
    return null;
  }
  if (sound.playing === null && fromBar !== null && fromBar > 1) return copy('listen.fromBar', { n: fromBar });
  return null;
}

export function ListenControls({ sound, slower, fromBar, meter, onSlower, onListen, onStop }: ListenControlsProps) {
  const playing = sound.playing === 'listen' || sound.playing === 'bar';
  const caption = listenCaption(sound, fromBar, meter);
  return (
    <div className="hist-listen" data-testid="listen-controls" data-playing={playing ? 'true' : 'false'}>
      {playing || sound.failed ? <LiveCaption failed={sound.failed}>{caption}</LiveCaption> : caption ? <p className="hist-from-bar">{caption}</p> : null}
      <div className="hist-listen-row">
        <Toggle checked={slower} label={copy('listen.slower')} onChange={onSlower} />
        <Button
          label={playing ? copy('action.stop') : copy('action.listen')}
          icon={playing ? 'stop' : 'listen'}
          variant="primary"
          onClick={playing ? onStop : onListen}
          data-testid="listen-button"
        />
      </div>
      <p className="ui-visually-hidden" role="status" aria-live="polite">
        {caption ?? ''}
      </p>
    </div>
  );
}
