/**
 * The sounds of try detail (05 sections 8.12, 9.3; round 2 04-design §9): the "Slower" switch, Listen (the written
 * music) and "Hear what we heard" (the notes we detected, re-synthesised). Each button reads "Stop" while its sound
 * plays, at the width of its longer label, so starting a sound moves nothing in the toolbar. The caption has its own
 * reserved line under the toolbar (`SoundCaptionLine`). Playing is the session's sound store for this attempt; the
 * start bar is the bar the player tapped in the score.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { SoundView } from '../../../session/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import type { CopyKey } from '../../../ui/copy/copy.ts';
import { Toggle } from '../../../ui/components/form/index.ts';
import { LiveCaption } from '../../../ui/components/sounds/index.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import type { GlyphId } from '../../../ui/glyph-ids.ts';
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

/** Listen (or Hear bar n) is sounding. */
export const isListening = (s: SoundView): boolean => s.playing === 'listen' || s.playing === 'bar';
/** "Hear what we heard" is sounding. */
export const isHearing = (s: SoundView): boolean => s.playing === 'heard';

export interface ListenControlsProps {
  sound: SoundView;
  slower: boolean;
  onSlower: (slower: boolean) => void;
  onListen: () => void;
  onStop: () => void;
  /** "Hear what we heard"; omitted: the button is not shown. */
  onHear?: (() => void) | undefined;
}

/** The caption line: a failure, what is sounding, nothing heard, or the bar Listen will start from. */
export function listenCaption(sound: SoundView, fromBar: number | null, meter: string | null): string | null {
  if (sound.failed) return copy('sound.failed');
  const c = sound.caption;
  if (sound.playing !== null && c) {
    if (c.kind === 'bar') return copy('listen.playing', { n: c.bar, total: c.of });
    if (c.kind === 'heard-bar') return copy('heard.caption', { n: c.bar, total: c.of });
    if (c.kind === 'lead-in') return copy('sound.playing.tempo', { tempo: copy('tempo.marking', { unit: beatUnit(meter ?? '4/4'), bpm: c.bpm }) });
    return null;
  }
  if (sound.playing === null && fromBar !== null && fromBar > 1) return copy('listen.fromBar', { n: fromBar });
  return null;
}

/** A button whose box is as wide as the longer of its two labels, so swapping them moves nothing beside it. */
function SteadyButton({
  playing,
  idle,
  idleIcon,
  variant,
  onClick,
  testId,
}: {
  playing: boolean;
  idle: CopyKey;
  idleIcon: GlyphId;
  variant: 'primary' | 'secondary';
  onClick: () => void;
  testId: string;
}) {
  const label = copy(playing ? 'action.stop' : idle);
  const other = copy(playing ? idle : 'action.stop');
  return (
    <button
      type="button"
      className={`ui-button ui-button-${playing ? 'secondary' : variant} ui-button-default hist-steady`}
      data-playing={playing ? 'true' : 'false'}
      data-testid={testId}
      onClick={onClick}
    >
      <span className="hist-steady-face">
        <Glyph id={playing ? 'stop' : idleIcon} />
        <span>{label}</span>
      </span>
      {/* The other label, unseen, holds the width (drawn from an attribute, so it is not part of the name). */}
      <span className="hist-steady-face hist-steady-ghost" aria-hidden="true">
        <Glyph id={playing ? idleIcon : 'stop'} />
        <span className="hist-steady-alt" data-alt={other} />
      </span>
    </button>
  );
}

export function ListenControls({ sound, slower, onSlower, onListen, onStop, onHear }: ListenControlsProps) {
  const listening = isListening(sound);
  const hearing = isHearing(sound);
  return (
    <div className="hist-listen" data-testid="listen-controls" data-playing={listening || hearing ? 'true' : 'false'}>
      <div className="hist-listen-row">
        <Toggle checked={slower} label={copy('listen.slower')} onChange={onSlower} />
        <SteadyButton playing={listening} idle="action.listen" idleIcon="listen" variant="secondary" onClick={listening ? onStop : onListen} testId="listen-button" />
        {onHear ? (
          <SteadyButton playing={hearing} idle="action.hearWhatWeHeard" idleIcon="play" variant="primary" onClick={hearing ? onStop : onHear} testId="hear-button" />
        ) : null}
      </div>
    </div>
  );
}

export interface SoundCaptionLineProps {
  sound: SoundView;
  fromBar: number | null;
  meter: string | null;
  /** "Hear what we heard" found nothing to play. */
  heardNone?: boolean;
}

/**
 * The reserved line under the toolbar: "What we heard, bar 3 of 8" with "The notes we detected, in your instrument's
 * sound. Not a recording.", "Playing bar n of m", "From bar n", a failure, or nothing.
 */
/** What the screen's polite region reads for the sounds (always mounted, so each change is announced). */
export function soundAnnouncement(sound: SoundView, fromBar: number | null, meter: string | null, heardNone: boolean): string {
  return (heardNone && sound.playing === null ? copy('heard.none') : listenCaption(sound, fromBar, meter)) ?? '';
}

export function SoundCaptionLine({ sound, fromBar, meter, heardNone = false }: SoundCaptionLineProps) {
  const caption = soundAnnouncement(sound, fromBar, meter, heardNone) || null;
  const live = sound.playing !== null || sound.failed;
  return (
    <span className="hist-caption" data-testid="sound-caption">
      {live ? (
        <LiveCaption failed={sound.failed}>{caption}</LiveCaption>
      ) : caption ? (
        <span className="hist-from-bar">{caption}</span>
      ) : null}
      {isHearing(sound) ? <span className="hist-heard-note">{copy('heard.caption.note')}</span> : null}
    </span>
  );
}
