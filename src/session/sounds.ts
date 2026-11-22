/**
 * The "Hear it" player (05 §9.3): one sound at a time, its live caption, and the bar it is on. Screens read the
 * `SoundView` store; the session calls `play` and `stop`. Starting a sound stops the one playing; `stop` cancels
 * everything the backend scheduled through `playNotes`, `playClicks` and `playTone` (never a take's metronome).
 *
 * Captions follow the backend's clock as heard: each segment is set by a timer at the moment its clock time comes out
 * of the speakers (`audibleNow`, so the output latency is taken off), and the store goes back to idle when the sound
 * ends. A sound that fails to start shows `failed` for six seconds (05 §8.8 states).
 *
 * The notes a sound plays (Listen, Hear bars, Hear what we heard) are in `notes`, set once when it starts: each written
 * note's index and the clock times it sounds from and to, with the clock to read them against. The score's
 * sounding-note highlight follows them frame by frame without a store update per note.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AudioBackend } from '../core/platform.ts';
import type { KeySig, MetronomeSound, SpelledPitch } from '../core/types.ts';

/** Which control is sounding. */
export type SoundKind = 'listen' | 'bar' | 'tempo' | 'key' | 'reference' | 'note' | 'preview' | 'range' | 'heard';

/** What the live caption says (05 §8.8): the screen turns it into copy. */
export type SoundCaption =
  /** The lead-in bar of clicks before Listen or Hear bar n. */
  | { kind: 'lead-in'; bpm: number }
  /** "Playing bar n of m". */
  | { kind: 'bar'; bar: number; of: number }
  /** "Tempo: ♩ = 72". */
  | { kind: 'tempo'; bpm: number }
  /** "Key chord: A major": the written key names it (designer's note 4); it sounds in the concert key. */
  | { kind: 'key-chord'; writtenKey: KeySig; concertKey: KeySig }
  /** "First note: G3": the excerpt's written first note, and the pitch that sounds. */
  | { kind: 'first-note'; written: SpelledPitch; concertMidi: number }
  /** The gap of one beat after the starting pitch, before the first count-in click: "Count-in next". */
  | { kind: 'count-in-next' }
  /** A range-picture note. */
  | { kind: 'note'; midi: number }
  /** "Play my range" (round 2): the note at `index` (0-based) of the notes asked for is sounding. */
  | { kind: 'range-note'; index: number; midi: number }
  /** "Hear what we heard" (round 2): "What we heard, bar {n} of {total}". */
  | { kind: 'heard-bar'; bar: number; of: number }
  /** A metronome sound preview. */
  | { kind: 'preview'; sound: MetronomeSound };

/** One written note of a sound: its expected-note index and the backend clock times it sounds from and to. */
export interface SoundNoteSpan {
  idx: number;
  /** The note's event ids in the score (a tie chain has several). */
  eventIds: readonly string[];
  startsAt: number;
  endsAt: number;
}

/** The notes of the sound playing now and the clock to read them against (the backend's clock as heard). */
export interface SoundNotes {
  /** In start order. A note heard twice (Hear bars) appears twice. */
  spans: readonly SoundNoteSpan[];
  /** Backend clock seconds of what comes out of the speakers now. */
  clock: () => number;
}

export interface SoundView {
  playing: SoundKind | null;
  caption: SoundCaption | null;
  /** The bar sounding (Listen, Hear bar n) for the score highlight; null otherwise. */
  bar: number | null;
  /** The start bar of the Listen playing now (results: "From bar n"), or null. */
  fromBar: number | null;
  /** "Slower" is on for the Listen playing now. */
  slower: boolean;
  /** The stored attempt being played (history), or null for the excerpt on screen. */
  attemptId: string | null;
  /** The instrument whose range is playing ("Play my range", a range note), or null. */
  instrumentId?: string | null;
  /** The last sound could not start: "That sound didn't play." for six seconds. */
  failed: boolean;
  /** Backend clock times of the sound playing now. */
  startsAt: number | null;
  endsAt: number | null;
  /** The written notes it plays, for the sounding-note highlight (Listen, Hear bars, Hear what we heard); else null. */
  notes?: SoundNotes | null;
}

export const idleSoundView = (): SoundView => ({
  playing: null,
  caption: null,
  bar: null,
  fromBar: null,
  slower: false,
  attemptId: null,
  instrumentId: null,
  failed: false,
  startsAt: null,
  endsAt: null,
  notes: null,
});

/** One caption change, seconds after the sound's origin. */
export interface SoundSegment {
  atSec: number;
  caption: SoundCaption;
  bar?: number | null;
}

export interface SoundRequest {
  kind: SoundKind;
  /** Seconds the sound lasts from its origin. */
  durSec: number;
  segments: readonly SoundSegment[];
  fromBar?: number | null;
  slower?: boolean;
  attemptId?: string | null;
  instrumentId?: string | null;
  /** The written notes the sound plays: expected-note index and seconds from the origin it sounds from and to. */
  notes?: readonly { idx: number; eventIds: readonly string[]; atSec: number; untilSec: number }[];
  /** Schedules the sound with its origin at the given backend clock time. */
  schedule(origin: number): Promise<void>;
}

interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Seconds from the call to the sound's origin, so the first note is never clipped by scheduling. */
export const SOUND_LEAD_SEC = 0.08;
/** How long a failure shows, ms (05 §8.8). */
export const SOUND_FAILED_MS = 6000;

export class SoundPlayer {
  readonly view: StoreApi<SoundView> = createStore<SoundView>()(() => idleSoundView());
  private gen = 0;
  private handles: unknown[] = [];
  private failHandle: unknown = null;

  constructor(
    private readonly audio: Pick<AudioBackend, 'now' | 'stopSounds'> & Partial<Pick<AudioBackend, 'audibleNow'>>,
    private readonly timers: Timers,
  ) {}

  /**
   * Backend clock seconds of the sound coming out of the speakers now: `audibleNow` when the backend has one (never
   * ahead of `now`, never more than a second behind it), else `now`.
   */
  heardNow(): number {
    const now = this.audio.now() as number;
    const heard = typeof this.audio.audibleNow === 'function' ? (this.audio.audibleNow() as number) : now;
    return Number.isFinite(heard) && heard <= now && heard > now - 1 ? heard : now;
  }

  /**
   * The player's beat line timing (PLAN R70, `display.beatLineOffsetMs`), seconds: positive draws what is heard later,
   * negative earlier. Visual only: it moves the sounding note and the captions, never a sound.
   */
  visualOffsetSec = 0;

  /** The heard clock as the screen draws it: `heardNow` less the player's visual offset. */
  visualNow(): number {
    return this.heardNow() - this.visualOffsetSec;
  }

  private readonly clock = (): number => this.visualNow();

  get playing(): SoundKind | null {
    return this.view.getState().playing;
  }

  /** Stops whatever plays, then plays this. Resolves once it is scheduled; rejects when the backend refuses it. */
  async play(r: SoundRequest): Promise<void> {
    this.stop();
    const gen = ++this.gen;
    const origin = (this.audio.now() as number) + SOUND_LEAD_SEC;
    this.track(r, origin, gen);
    try {
      await r.schedule(origin);
    } catch (e) {
      if (gen === this.gen) this.fail();
      throw e;
    }
  }

  /**
   * Shows captions for a sound something else already scheduled (the voice reference before the count-in), without
   * stopping anything first.
   */
  follow(r: Omit<SoundRequest, 'schedule'>, origin: number): void {
    this.clearTimers();
    const gen = ++this.gen;
    this.track(r, origin, gen);
  }

  /** Stops every sound at once (the backend's `stopSounds`) and clears the caption. */
  stop(): void {
    this.gen++;
    this.clearTimers();
    this.audio.stopSounds();
    const v = this.view.getState();
    if (v.playing !== null || v.caption !== null) this.view.setState({ ...idleSoundView(), failed: v.failed }, true);
  }

  /** Clears the caption without touching the backend (a take took over: its own cancel stops the sounds). */
  reset(): void {
    this.gen++;
    this.clearTimers();
    this.view.setState(idleSoundView(), true);
  }

  dispose(): void {
    this.reset();
    if (this.failHandle !== null) this.timers.clearTimeout(this.failHandle);
    this.failHandle = null;
  }

  private track(r: Omit<SoundRequest, 'schedule'>, origin: number, gen: number): void {
    const segs = [...r.segments].sort((a, b) => a.atSec - b.atSec);
    const now = this.audio.now() as number;
    const initial = segs.filter((s) => origin + s.atSec <= now + SOUND_LEAD_SEC + 1e-9).at(-1) ?? null;
    this.view.setState(
      {
        playing: r.kind,
        caption: initial?.caption ?? null,
        bar: initial?.bar ?? null,
        fromBar: r.fromBar ?? null,
        slower: r.slower ?? false,
        attemptId: r.attemptId ?? null,
        instrumentId: r.instrumentId ?? null,
        failed: false,
        startsAt: origin,
        endsAt: origin + r.durSec,
        notes: r.notes && r.notes.length > 0 ? { spans: r.notes.map((n) => ({ idx: n.idx, eventIds: n.eventIds, startsAt: origin + n.atSec, endsAt: origin + n.untilSec })).sort((a, b) => a.startsAt - b.startsAt), clock: this.clock } : null,
      },
      true,
    );
    // Timers fire when the clock time is heard, not when it is scheduled (the output latency, calibration's rule).
    const at = (sec: number): number => Math.max(0, (origin + sec - this.visualNow()) * 1000);
    for (const s of segs) {
      if (s === initial || (initial && s.atSec < initial.atSec)) continue;
      this.handles.push(
        this.timers.setTimeout(() => {
          if (gen !== this.gen) return;
          this.view.setState({ caption: s.caption, bar: s.bar ?? null });
        }, at(s.atSec)),
      );
    }
    this.handles.push(
      this.timers.setTimeout(() => {
        if (gen !== this.gen) return;
        this.handles = [];
        this.view.setState(idleSoundView(), true);
      }, at(r.durSec)),
    );
  }

  private fail(): void {
    this.clearTimers();
    this.view.setState({ ...idleSoundView(), failed: true }, true);
    if (this.failHandle !== null) this.timers.clearTimeout(this.failHandle);
    this.failHandle = this.timers.setTimeout(() => {
      this.failHandle = null;
      if (this.view.getState().failed) this.view.setState({ failed: false });
    }, SOUND_FAILED_MS);
  }

  private clearTimers(): void {
    for (const h of this.handles) this.timers.clearTimeout(h);
    this.handles = [];
  }
}
