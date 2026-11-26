/**
 * The read-through's sounds (05 sections 8.8, 9.3, 9.4 and 10): one sound at a time from the session's `SoundView`,
 * the ranked "Listen first" confirm, Check my tuning, the live caption and the score highlight it drives, and the
 * polite announcements. The screen lays the group (desktop) or the dock (phones) out; this hook owns the behaviour.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { PreparedExcerpt } from '../../../core/types.ts';
import { idleSoundView, type SoundNotes, type SoundView } from '../../../session/index.ts';
import { takesTuningNote } from '../../../session/take-plan.ts';
import { PlayingTempo, type SoundId, type SoundsModel } from '../../../ui/components/sounds/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { keyName } from '../setup/key-names.ts';
import { useReadable, useStoreSlice } from './hooks.ts';
import { announcementFor, firstNoteLabel, highlightFor, soundIdOf, tempoOf, type ScoreHighlight } from './read-model.ts';
import type { PracticeFlowServices } from './services.ts';

const IDLE_SOUNDS: StoreApi<SoundView> = {
  getState: idleSoundView,
  getInitialState: idleSoundView,
  setState: () => undefined,
  subscribe: () => () => undefined,
} as unknown as StoreApi<SoundView>;

/** How long a tuning result or failure stays in the caption line, ms (05 section 8.8: six seconds). */
export const NOTICE_MS = 6000;

type Notice = { text: string; failed: boolean } | null;

export interface ReadSounds {
  model: SoundsModel;
  press: (id: SoundId) => void;
  caption: ReactNode;
  captionFailed: boolean;
  highlight: ScoreHighlight;
  /** The notes of the Listen playing now and its clock: the score's sounding-note highlight. Null when none plays. */
  sounding: SoundNotes | null;
  confirmOpen: boolean;
  keepRanked: () => void;
  listenMakePractice: () => void;
  /** Stops any sound (Start playing, leaving the screen). */
  stopAll: () => void;
}

export interface ReadSoundsArgs {
  svc: PracticeFlowServices;
  prepared: PreparedExcerpt | null;
  mode: 'ranked' | 'practice';
  /** Read-through on screen (not the cover). */
  active: boolean;
  announce: (text: string) => void;
}

export function useReadSounds({ svc, prepared, mode, active, announce }: ReadSoundsArgs): ReadSounds {
  const store = svc.sounds ?? IDLE_SOUNDS;
  const playingKind = useStoreSlice(store, (s) => s.playing);
  const soundCaption = useStoreSlice(store, (s) => s.caption);
  const soundBar = useStoreSlice(store, (s) => s.bar);
  const failed = useStoreSlice(store, (s) => s.failed);
  const soundNotes = useStoreSlice(store, (s) => s.notes ?? null);
  const listening = useReadable(svc.settings).practice.listening;
  const [tuning, setTuning] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inst = prepared ? svc.configs.instrumentById[prepared.instrumentId] : undefined;
  const voice = inst?.family === 'voice';
  const tunes = !!inst && takesTuningNote(inst) && listening;

  const showNotice = useCallback((n: Notice) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(n);
    if (n) noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  // Announce each sound as it starts and each caption step that names something (never the Listen bars).
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (!prepared) return;
    const text = announcementFor(soundCaption, prepared);
    if (text && text !== said.current) announce(text);
    said.current = text;
  }, [soundCaption, prepared, announce]);

  const playingId: SoundId | null = tuning ? 'tuning' : soundIdOf(playingKind);
  const stopAll = useCallback(() => svc.stopSounds?.(), [svc]);

  const run = useCallback(
    (f: (() => Promise<void>) | undefined) => {
      if (!f) return;
      showNotice(null);
      f().catch(() => undefined);
    },
    [showNotice],
  );

  const startListen = useCallback(() => run(svc.listenFirst), [run, svc]);

  const press = useCallback(
    (id: SoundId) => {
      if (id === 'tuning') {
        if (tuning) return;
        stopAll();
        showNotice(null);
        setTuning(true);
        svc.session.captureTuningNote().then(
          (cents) => {
            setTuning(false);
            const c = Math.round(Math.abs(cents));
            showNotice({ text: copy('scan.tuning.result', { cents: c, direction: copy(cents < 0 ? 'direction.flat' : 'direction.sharp') }), failed: false });
          },
          () => {
            setTuning(false);
            showNotice({ text: copy('tuning.fail'), failed: true });
          },
        );
        return;
      }
      if (playingId === id) {
        stopAll();
        if (id === 'listen') announce(copy('listen.stopped'));
        return;
      }
      if (id === 'listen') {
        if (mode === 'ranked') setConfirmOpen(true);
        else startListen();
      } else if (id === 'tempo') run(svc.hearTempo);
      else if (voice) run(svc.hearStartingPitch ?? (() => svc.session.playVoiceReference()));
      else run(svc.hearKey);
    },
    [tuning, playingId, mode, voice, svc, stopAll, showNotice, announce, startListen, run],
  );

  const keepRanked = useCallback(() => setConfirmOpen(false), []);
  const listenMakePractice = useCallback(() => {
    setConfirmOpen(false);
    startListen();
    announce(copy('mode.nowPractice', { reason: copy('mode.reason.listened-first') }));
  }, [startListen, announce]);

  // The confirm never outlives the read-through (count-in at 0 closes it as Keep it ranked).
  useEffect(() => {
    if (!active) setConfirmOpen(false);
  }, [active]);

  const tempo = prepared ? tempoOf(prepared) : { unit: '♩', bpm: 60 };
  const model: SoundsModel = {
    reference: voice ? 'voice' : 'instrument',
    ranked: mode === 'ranked',
    tempo,
    tuning: tunes,
    tuningSeconds: svc.configs.grading.tuning.captureSec,
    playing: playingId,
    disabled: {
      listen: !svc.listenFirst,
      tempo: !svc.hearTempo,
      reference: voice ? false : !svc.hearKey,
    },
  };

  let caption: ReactNode = null;
  let captionFailed = false;
  if (failed) {
    caption = copy('sound.failed');
    captionFailed = true;
  } else if (soundCaption && prepared) {
    switch (soundCaption.kind) {
      case 'key-chord':
        caption = copy('reference.playing.chord', { key: keyName(soundCaption.writtenKey) });
        break;
      case 'first-note':
        caption = copy('reference.playing.first', { note: firstNoteLabel(soundCaption.written, soundCaption.concertMidi) });
        break;
      case 'tempo':
      case 'lead-in':
        caption = <PlayingTempo tempo={{ unit: tempo.unit, bpm: soundCaption.bpm }} />;
        break;
      case 'bar':
        caption = copy('listen.playing', { n: soundCaption.bar, total: soundCaption.of });
        break;
      default:
        caption = null;
    }
  } else if (notice) {
    caption = notice.text;
    captionFailed = notice.failed;
  }

  const highlight = prepared && active ? highlightFor(prepared, failed ? null : soundCaption, soundBar) : { key: false, firstNote: null, bar: null };
  const sounding = prepared && active && !failed ? soundNotes : null;
  return { model, press, caption, captionFailed, highlight, sounding, confirmOpen, keepRanked, listenMakePractice, stopAll };
}
