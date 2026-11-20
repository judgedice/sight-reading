/**
 * Match a note: the engine (round 2, 01-ux §3; 06-plan R2-07). Not a take: no excerpt, no follower, no grading, and
 * nothing is stored. The screen's pure model (`app/screens/match/model.ts`) reads the frames.
 *
 * - `playTarget` stops any listening, then plays the note through the sampler (`playNotes` with the instrument's
 *   sample set): 1.5 s with an 80 ms attack. It resolves when the note's release has ended.
 * - `listen` opens capture only `MATCH_NOTE.listenAfterSec` (300 ms) after that release, so the app never hears its
 *   own note. The DSP worker runs in pitch mode (`WorkerMessage` 'pitch': the `PitchAnalyzer`, no follower) and posts
 *   frames at about 50 Hz; the worker also drops any frame stamped before that time.
 * - `stop` stops the sound, the capture and the worker, and releases the microphone track (`releaseInput`). The next
 *   `listen` opens the microphone again.
 *
 * `MatchFrame.t` is milliseconds on the audio clock (`nowMs()`), which the screen also uses for its ticks.
 */
import type { AudioBackend, MessagePortLike, PitchModeConfig, PitchModeFrame, SoundSetId, WorkerLike, WorkerMessage, WorkerReply } from '../core/platform.ts';
import type { ClockSeconds, Configs, Instrument } from '../core/types.ts';
import { midiToFreq } from '../dsp/pitch.ts';
import { hasSoundSet, soundSetFor } from '../instruments/sound-sets.ts';
import { LISTEN } from './listen-plan.ts';

/** A frame from the pitch engine, concert pitch. `t` is milliseconds on the audio clock. */
export interface MatchFrame {
  /** Milliseconds. */
  t: number;
  /** Nearest concert MIDI note, or null when no pitch is heard. */
  midi: number | null;
  /** Deviation from `midi`, cents, or null. */
  cents: number | null;
  levelDb: number;
  steady: boolean;
}

/** Fixed values of Match a note (01-ux §3, 06-plan section 4). */
export const MATCH_NOTE = {
  /** The target sounds this long, seconds. */
  durSec: 1.5,
  /** Its attack, seconds. */
  attackSec: 0.08,
  /**
   * The longest release a played note can have, seconds: the longest sample-set release in `public/sounds/index.json`
   * (0.35 s) plus the sampler's stop pad. The additive fallback voice releases in 60 ms.
   */
  releaseSec: 0.4,
  /** Capture opens this long after the release, seconds. */
  listenAfterSec: 0.3,
  /** The note is scheduled this far ahead of the call, seconds. */
  leadSec: 0.05,
  /** Peak level, as Listen (about -12 dBFS). */
  peak: LISTEN.peak,
  /** Posted frame spacing, seconds (about 50 Hz). */
  stepSec: 0.02,
  /** The reported pitch is the mean of this much, seconds. */
  smoothSec: 0.04,
  /** A pitch held this long is steady, ms. */
  steadyMs: 150,
  /** ... within this spread, cents: wider for vibrato instruments and voices. */
  steadySpreadCents: { none: 50, vibrato: 120 },
  /** Quieter frames are unvoiced, dBFS. */
  gateDb: -65,
} as const;

/** Timers the service waits with; default the global ones. */
export interface MatchTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface MatchNoteDeps {
  audio: AudioBackend;
  cfg: Configs;
  workerFactory: () => WorkerLike;
  /** Port mode (01 §7.2), as for a take: `port1` to `startCapture`, `port2` to the worker. Absent: relay mode. */
  createCaptureChannel?: () => { port1: MessagePortLike; port2: unknown };
  timers?: MatchTimers;
  /** Tuning pitch, Hz (default 440). */
  a4Hz?: () => number;
  /** Extra delay before listening, seconds: the route's round-trip latency when known (default 0). */
  latencySec?: () => number;
}

/** The global timers (session/ has no DOM lib, as in practice-session.ts). */
const globalTimers = (): MatchTimers => {
  const g = globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void };
  return { setTimeout: (fn, ms) => g.setTimeout(fn, ms), clearTimeout: (h) => g.clearTimeout(h) };
};

interface Listening {
  worker: WorkerLike;
  channel: { port1: MessagePortLike; port2: unknown } | null;
}

/** Turns a worker frame (seconds) into a `MatchFrame` (milliseconds). */
export function matchFrameOf(f: PitchModeFrame): MatchFrame {
  return { t: (f.t as number) * 1000, midi: f.midi, cents: f.cents, levelDb: f.levelDb, steady: f.steady };
}

/** The pitch-mode config for an instrument (its detection settings, 01 §7.3). */
export function pitchModeConfigFor(inst: Instrument, f: { analysisRate: number; a4Hz: number; fromT: number }): PitchModeConfig {
  const d = inst.detection;
  return {
    analysisRate: f.analysisRate,
    windowSamples: d.windowSamples,
    hopSamples: 128,
    minHz: d.minHz,
    maxHz: d.maxHz,
    a4Hz: f.a4Hz,
    clarityThreshold: d.clarityThreshold,
    fromT: f.fromT as ClockSeconds,
    stepSec: MATCH_NOTE.stepSec,
    smoothSec: MATCH_NOTE.smoothSec,
    steadyMs: MATCH_NOTE.steadyMs,
    steadySpreadCents: MATCH_NOTE.steadySpreadCents[d.vibratoClass],
    gateDb: MATCH_NOTE.gateDb,
  };
}

export class MatchNoteService {
  private readonly d: MatchNoteDeps;
  private readonly timers: MatchTimers;
  /** Bumped by every playTarget, listen and stop: work of an older call stops at its next step. */
  private gen = 0;
  private target: { midi: number; instrumentId: string } | null = null;
  /** Audio-clock time from which capture may open. */
  private listenFrom = -Infinity;
  private listening: Listening | null = null;
  private inputReleased = false;
  private readonly waits = new Set<{ handle: unknown; done: () => void }>();

  constructor(deps: MatchNoteDeps) {
    this.d = deps;
    this.timers = deps.timers ?? globalTimers();
  }

  /** The audio clock, milliseconds (the clock of `MatchFrame.t`). */
  nowMs(): number {
    return (this.d.audio.now() as number) * 1000;
  }

  /** True while capture is open. */
  get isListening(): boolean {
    return this.listening !== null;
  }

  /**
   * Plays the target (concert MIDI) in the instrument's sound: 1.5 s, 80 ms attack. Any listening stops first, so the
   * microphone never hears it. Resolves once the note's release has ended (or at once after `stop`).
   */
  async playTarget(concertMidi: number, instrumentId: string): Promise<void> {
    const gen = ++this.gen;
    this.closeCapture();
    const audio = this.d.audio;
    // After `stop` released the input and the graph, the sound needs the audio again (as `listen` does).
    if (this.inputReleased) {
      await audio.unlock();
      if (gen !== this.gen) return;
      this.inputReleased = false;
    }
    audio.stopSounds();
    const sound: SoundSetId | undefined = hasSoundSet(instrumentId) ? soundSetFor(instrumentId).set : undefined;
    if (sound !== undefined) await audio.prepareSound(sound);
    if (gen !== this.gen) return;
    const at = (audio.now() as number) + MATCH_NOTE.leadSec;
    const hz = midiToFreq(concertMidi, this.d.a4Hz?.() ?? 440);
    const releaseEnd = at + MATCH_NOTE.durSec + MATCH_NOTE.releaseSec;
    this.target = { midi: concertMidi, instrumentId };
    this.listenFrom = releaseEnd + MATCH_NOTE.listenAfterSec + Math.max(0, this.d.latencySec?.() ?? 0);
    await audio.playNotes([{ hz, startSec: 0, durSec: MATCH_NOTE.durSec }], {
      at: at as ClockSeconds,
      peak: MATCH_NOTE.peak,
      ...(sound !== undefined ? { sound } : {}),
      attackSec: MATCH_NOTE.attackSec,
    });
    if (gen !== this.gen) return;
    await this.waitUntil(releaseEnd);
  }

  /**
   * Opens capture for the last target, no earlier than 300 ms after its release, and calls `onFrame` about 50 times a
   * second until `playTarget` or `stop`. Resolves once capture is open (or at once when superseded).
   */
  async listen(onFrame: (f: MatchFrame) => void): Promise<void> {
    const target = this.target;
    if (!target) throw new Error('MatchNoteService: listen before playTarget');
    const gen = ++this.gen;
    this.closeCapture();
    await this.waitUntil(this.listenFrom);
    if (gen !== this.gen) return;
    const audio = this.d.audio;
    if (this.inputReleased) {
      await audio.unlock();
      if (gen !== this.gen) return;
      this.inputReleased = false;
    }
    const inst = this.d.cfg.instrumentById[target.instrumentId];
    if (!inst) throw new RangeError(`MatchNoteService: unknown instrument ${target.instrumentId}`);
    const contextRate = audio.audioInfo().contextSampleRate;
    const analysisRate = contextRate / Math.max(1, Math.round(contextRate / 16000));
    const cfg = pitchModeConfigFor(inst, { analysisRate, a4Hz: this.d.a4Hz?.() ?? 440, fromT: this.listenFrom });
    const worker = this.d.workerFactory();
    const channel = this.d.createCaptureChannel?.() ?? null;
    const l: Listening = { worker, channel };
    this.listening = l;
    worker.onmessage = (ev: { data: WorkerReply }) => {
      if (this.listening !== l) return;
      const m = ev.data;
      if (m.type === 'pitch-frames') for (const f of m.frames) onFrame(matchFrameOf(f));
    };
    const msg: WorkerMessage = { v: 1, type: 'pitch', cfg };
    if (channel) {
      worker.postMessage(msg, [channel.port2]);
      await audio.startCapture(channel.port1);
    } else {
      worker.postMessage(msg);
      await audio.startCapture((m) => {
        if (this.listening !== l || m.type !== 'block') return;
        l.worker.postMessage(m, [m.block.lowband.buffer, m.block.hiEnergy.buffer]);
      });
    }
    // Stopped or superseded while capture was starting.
    if (this.listening !== l) audio.stopCapture();
  }

  /** Stops the sound, the capture and the worker, and releases the microphone track. */
  stop(): void {
    this.gen++;
    this.closeCapture();
    this.d.audio.stopSounds();
    for (const w of [...this.waits]) {
      this.timers.clearTimeout(w.handle);
      w.done();
    }
    this.waits.clear();
    const release = this.d.audio.releaseInput;
    if (release) {
      release.call(this.d.audio);
      this.inputReleased = true;
    }
  }

  private closeCapture(): void {
    const l = this.listening;
    if (!l) return;
    this.listening = null;
    this.d.audio.stopCapture();
    l.worker.onmessage = null;
    l.worker.terminate();
    l.channel?.port1.close();
  }

  /** Waits until the audio clock reaches `t` (seconds); resolves early on `stop`. */
  private async waitUntil(t: number): Promise<void> {
    const gen = this.gen;
    for (;;) {
      const left = t - (this.d.audio.now() as number);
      if (left <= 0 || gen !== this.gen) return;
      await new Promise<void>((resolve) => {
        const w = { handle: null as unknown, done: resolve };
        w.handle = this.timers.setTimeout(() => {
          this.waits.delete(w);
          resolve();
        }, Math.ceil(left * 1000));
        this.waits.add(w);
      });
    }
  }
}
