/**
 * Drives "Match a note": the model (`model.ts`) and the engine (`MatchNoteService`). The hook plays each new target,
 * opens the microphone after it, feeds frames and ticks on the engine's clock into the reducer, and stops everything
 * on the way out. It touches nothing else: no attempts, no profile, no history, no settings.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Configs, Instrument, PitchSteadiness } from '../../../core/types.ts';
import { pitchSteadinessFor, type MatchNoteService } from '../../../session/index.ts';
import { initialMatchState, matchReducer, type MatchEvent, type MatchMode, type MatchState } from './model.ts';
import type { MatchServices } from './services.ts';

/** How often the reducer's timers (hit hold, not heard, too far, next note) are checked. */
export const TICK_MS = 100;

/** The part of the engine the screen uses. */
export type MatchEngine = Pick<MatchNoteService, 'playTarget' | 'listen' | 'stop' | 'nowMs'>;

/** `checking` until the permission is known; `none` shows "Allow microphone". */
export type MicGate = 'checking' | 'allowed' | 'none' | 'requesting';

export interface MatchController {
  state: MatchState;
  mic: MicGate;
  /** True once the current note has been hit at least once (onboarding keeps Continue after Play it again). */
  everHit: boolean;
  playAgain(): void;
  chooseNote(midi: number): void;
  /** From the summary: five more. */
  fiveMore(): void;
  /** Runs the permission request from the click. */
  allowMic(): void;
  /** The needle preset in use (Settings › Display, or the default by family). */
  steadiness: PitchSteadiness;
  /** Cents on the "You" line (Settings › Display › show cents). */
  showCents: boolean;
  /** Stores a new needle preset and plays the note again with it. Absent: the root offers no setter. */
  setSteadiness?: (v: PitchSteadiness) => void;
}

export function useMatch(
  services: Pick<MatchServices, 'micAllowed' | 'requestMic' | 'level' | 'display' | 'setPitchSteadiness'> & { service: MatchEngine; cfg: Configs },
  instrument: Instrument,
  mode: MatchMode,
): MatchController {
  const { service, cfg } = services;
  const [state, dispatch] = useReducer(matchReducer, undefined, () => initialMatchState(instrument, cfg, mode, services.level?.() ?? 1));
  const [display, setDisplay] = useState(() => services.display?.() ?? { showCents: false });
  const steadiness = pitchSteadinessFor(display.pitchSteadiness, instrument.family);
  const [mic, setMic] = useState<MicGate>('checking');
  const [nonce, setNonce] = useState(0);
  const [everHit, setEverHit] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  /**
   * `stop()` lets go of the microphone and the audio graph, so the engine cannot play again until the audio is unlocked.
   * After a stop the next click runs the unlock (`requestMic`, inside the gesture) and the next play waits for it.
   * The screen starts released: another screen (onboarding, a try) may have let the microphone go, so the first play
   * runs the unlock too, still inside the click that opened the screen.
   */
  const released = useRef(true);
  const ready = useRef<Promise<{ ok: boolean }> | null>(null);
  const wake = useCallback((): void => {
    if (!released.current) return;
    released.current = false;
    ready.current = services.requestMic();
  }, [services]);

  useEffect(() => {
    let live = true;
    services.micAllowed().then(
      (ok) => live && setMic(ok ? 'allowed' : 'none'),
      () => live && setMic('none'),
    );
    return () => {
      live = false;
    };
  }, [services]);

  // Every new note (a new index, round or target, or Play it again) plays once, then listens.
  const playKey = `${state.roundNumber}:${state.index}:${state.target}:${nonce}`;
  useEffect(() => {
    if (mic !== 'allowed' || stateRef.current.phase !== 'idle') return;
    let live = true;
    const send = (e: MatchEvent): void => {
      if (live) dispatch(e);
    };
    wake();
    void (async () => {
      try {
        // Kept, not cleared: React's development remount runs this effect twice, and both runs wait for the same unlock.
        const unlocking = ready.current;
        if (unlocking && !(await unlocking).ok) {
          if (live) setMic('none');
          return;
        }
        if (!live) return;
        await service.playTarget(stateRef.current.target, instrument.id);
        if (!live) return;
        send({ type: 'played', t: service.nowMs() });
        await service.listen((frame) => send({ type: 'frame', frame }));
      } catch {
        // The microphone went away (revoked, unplugged): show the no-microphone state.
        if (live) setMic('none');
      }
    })();
    return () => {
      live = false;
    };
  }, [mic, playKey, service, instrument.id, wake]);

  // The reducer's clock: hit hold, not heard, too far, and the next note in a round.
  const ticking = state.phase !== 'idle' && state.phase !== 'summary';
  useEffect(() => {
    if (!ticking) return;
    const h = setInterval(() => dispatch({ type: 'tick', t: service.nowMs() }), TICK_MS);
    return () => clearInterval(h);
  }, [ticking, service]);

  // Nothing more to hear: the summary, or a hit that waits for the player (onboarding, or a note they chose).
  const resting = state.phase === 'summary' || (state.phase === 'hit' && (state.mode === 'onboarding' || state.chosen));
  useEffect(() => {
    if (!resting) return;
    service.stop();
    released.current = true;
  }, [resting, service]);

  useEffect(() => {
    if (state.phase === 'hit') setEverHit(true);
  }, [state.phase]);

  // Leaving the screen stops the note, the microphone and the worker. The stop waits a turn, so React's development
  // remount (StrictMode) does not stop the engine under a screen that stays.
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (leaving.current !== null) clearTimeout(leaving.current);
    leaving.current = null;
    return () => {
      leaving.current = setTimeout(() => service.stop(), 0);
    };
  }, [service]);

  const playAgain = useCallback(() => {
    wake();
    dispatch({ type: 'again' });
    setNonce((n) => n + 1);
  }, [wake]);
  const chooseNote = useCallback(
    (midi: number) => {
      wake();
      dispatch({ type: 'choose-note', midi });
      setEverHit(false);
      setNonce((n) => n + 1);
    },
    [wake],
  );
  const fiveMore = useCallback(() => {
    wake();
    dispatch({ type: 'again' });
    setNonce((n) => n + 1);
  }, [wake]);
  const allowMic = useCallback(() => {
    // The request starts inside the click (05 W1).
    const pending = services.requestMic();
    released.current = false;
    ready.current = null;
    setMic('requesting');
    pending.then(
      (r) => setMic(r.ok ? 'allowed' : 'none'),
      () => setMic('none'),
    );
  }, [services]);

  const store = services.setPitchSteadiness;
  const setSteadiness = useMemo(
    () =>
      store
        ? (v: PitchSteadiness): void => {
            store(v);
            setDisplay((d) => ({ ...d, pitchSteadiness: v }));
            // The engine reads the preset when it starts listening: play the note again with it.
            playAgain();
          }
        : undefined,
    [store, playAgain],
  );

  return { state, mic, everHit, playAgain, chooseNote, fiveMore, allowMic, steadiness, showCents: display.showCents, ...(setSteadiness ? { setSteadiness } : {}) };
}
