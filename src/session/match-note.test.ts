// Match a note engine (R2-07): the worker's pitch mode end to end on FakeAudioBackend, the 300 ms listen gate after
// the target's release (with loopback bleed), and stop() releasing the sound, the capture, the worker and the mic.
import { describe, expect, it } from 'vitest';
import type { MessagePortLike, WorkerLike, WorkerMessage, WorkerReply } from '../core/platform.ts';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { DspWorkerCore } from '../platform/web/audio/dsp-worker-core.ts';
import { FakeAudioBackend, type FakeBackendOptions } from '../testkit/fake-backend.ts';
import { MATCH_NOTE, MatchNoteService, type MatchFrame, type MatchTimers } from './match-note.ts';

const cfg = configs();
const RATE = 48000;
const E3 = 52;
const hzOf = (midi: number, cents = 0): number => 440 * 2 ** ((midi - 69 + cents / 100) / 12);

/** A held tone with a few harmonics, silent for `silenceSec` first. */
function tone(hz: number, silenceSec: number, durSec: number, peak = 0.1): Float32Array {
  const out = new Float32Array(Math.round((silenceSec + durSec) * RATE));
  const s0 = Math.round(silenceSec * RATE);
  for (let i = s0; i < out.length; i++) {
    const t = (i - s0) / RATE;
    const ramp = Math.min(1, t / 0.02);
    out[i] = peak * ramp * (Math.sin(2 * Math.PI * hz * t) + 0.4 * Math.sin(4 * Math.PI * hz * t) + 0.2 * Math.sin(6 * Math.PI * hz * t));
  }
  return out;
}

/** The real worker logic in process, as `dsp.worker.ts` binds it. */
class InProcessWorker implements WorkerLike {
  onmessage: ((ev: { data: WorkerReply }) => void) | null = null;
  terminated = false;
  readonly messages: WorkerMessage[] = [];
  readonly core: DspWorkerCore;
  constructor() {
    this.core = new DspWorkerCore({
      post: (r) => {
        if (!this.terminated) this.onmessage?.({ data: r });
      },
      nowMs: () => 0,
      setTimer: () => () => undefined,
    });
  }
  postMessage(m: WorkerMessage, transfer?: unknown[]): void {
    if (this.terminated) return;
    this.messages.push(m);
    const port = transfer?.[0];
    if (port instanceof FakePort2) {
      port.owner = this;
      this.core.setCapturePort({ postMessage: () => undefined });
    }
    this.core.onMessage(m);
  }
  terminate(): void {
    this.terminated = true;
  }
}

class FakePort2 {
  owner: InProcessWorker | null = null;
}

/** Timers on the fake backend's clock. */
class ClockTimers implements MatchTimers {
  private list: { at: number; fn: () => void; id: number }[] = [];
  private next = 1;
  constructor(private readonly audio: FakeAudioBackend) {}
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.list.push({ at: (this.audio.now() as number) + ms / 1000, fn, id });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.list = this.list.filter((x) => x.id !== h);
  }
  fireDue(): void {
    const now = this.audio.now() as number;
    const due = this.list.filter((x) => x.at <= now + 1e-9);
    this.list = this.list.filter((x) => x.at > now + 1e-9);
    for (const x of due) x.fn();
  }
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface Rig {
  audio: FakeAudioBackend & { releasedInputs: number };
  timers: ClockTimers;
  workers: InProcessWorker[];
  service: MatchNoteService;
  frames: MatchFrame[];
  /** Advances the fake clock to `clock`, firing timers and letting promises run. */
  runTo(clock: number): Promise<void>;
}

function rig(opts: FakeBackendOptions, o: { port?: boolean } = {}): Rig {
  const audio = new FakeAudioBackend({ sampleRate: RATE, ...opts }) as FakeAudioBackend & { releasedInputs: number; releaseInput(): void };
  audio.releasedInputs = 0;
  audio.releaseInput = () => {
    audio.releasedInputs++;
  };
  const timers = new ClockTimers(audio);
  const workers: InProcessWorker[] = [];
  const channel = o.port
    ? (): { port1: MessagePortLike; port2: unknown } => {
        const port2 = new FakePort2();
        return {
          port1: { postMessage: (m: unknown) => port2.owner?.core.onCaptureMessage(m), close: () => undefined },
          port2,
        };
      }
    : undefined;
  const service = new MatchNoteService({
    audio,
    cfg,
    timers,
    workerFactory: () => {
      const w = new InProcessWorker();
      workers.push(w);
      return w;
    },
    ...(channel ? { createCaptureChannel: channel } : {}),
  });
  const r: Rig = {
    audio,
    timers,
    workers,
    service,
    frames: [],
    async runTo(clock: number) {
      await settle();
      while ((audio.now() as number) < clock - 1e-9) {
        audio.advance(Math.min(0.005, clock - (audio.now() as number)));
        timers.fireDue();
        await settle();
      }
    },
  };
  return r;
}

/** Plays E3 on `instrumentId`, then listens; returns the clock at which listening may start. */
async function playThenListen(r: Rig, instrumentId: string): Promise<{ at: number; listenFrom: number }> {
  const start = r.audio.now() as number;
  const played = r.service.playTarget(E3, instrumentId);
  await r.runTo(start + 0.01);
  const at = start + MATCH_NOTE.leadSec;
  const releaseEnd = at + MATCH_NOTE.durSec + MATCH_NOTE.releaseSec;
  await r.runTo(releaseEnd + 0.001);
  await played;
  // Resolves once capture is open; the caller advances the clock to get there.
  void r.service.listen((f) => r.frames.push(f));
  return { at, listenFrom: releaseEnd + MATCH_NOTE.listenAfterSec };
}

describe('MatchNoteService: playTarget', () => {
  it('plays the target through the sampler: 1.5 s, 80 ms attack, the instrument sound', async () => {
    const r = rig({});
    const p = r.service.playTarget(E3, 'cello');
    await r.runTo(12.5);
    await p;
    expect(r.audio.log.soundPrepares).toEqual(['cello']);
    expect(r.audio.log.notePlays).toHaveLength(1);
    const play = r.audio.log.notePlays[0]!;
    expect(play.opts.sound).toBe('cello');
    expect(play.opts.attackSec).toBe(0.08);
    expect(play.notes).toHaveLength(1);
    expect(play.notes[0]!.durSec).toBe(1.5);
    expect(play.notes[0]!.hz).toBeCloseTo(hzOf(E3), 6);
    expect(r.audio.log.captureStarts).toBe(0);
  });
});

describe('MatchNoteService: listen (worker pitch mode)', () => {
  it('fake capture at E3 +6 cents: frames report E3 within 3 cents and steady after 150 ms, at about 50 Hz', async () => {
    // The source starts when capture opens: 0.3 s of silence, then E3 +6 cents.
    const r = rig({ source: tone(hzOf(E3, 6), 0.3, 2) });
    const { listenFrom } = await playThenListen(r, 'voice-baritone');
    await r.runTo(listenFrom + 0.01);
    expect(r.audio.log.captureStarts).toBe(1);
    const capturedAt = r.audio.log.calls.find((c) => c.method === 'startCapture')!.at;
    expect(capturedAt).toBeGreaterThanOrEqual(listenFrom - 1e-9);
    await r.runTo(capturedAt + 2.2);

    const onsetMs = (capturedAt + 0.3) * 1000;
    const voiced = r.frames.filter((f) => f.midi !== null);
    expect(voiced.length).toBeGreaterThan(50);
    // Rate: about 50 Hz.
    const span = r.frames[r.frames.length - 1]!.t - r.frames[0]!.t;
    expect((r.frames.length - 1) / (span / 1000)).toBeGreaterThan(45);
    expect((r.frames.length - 1) / (span / 1000)).toBeLessThan(55);
    // Nothing before the onset is a pitch; nothing is steady before 100 ms of it.
    expect(r.frames.filter((f) => f.t < onsetMs - 40 && f.midi !== null)).toEqual([]);
    expect(r.frames.filter((f) => f.t < onsetMs + 100 && f.steady)).toEqual([]);
    // From 150 ms on (plus the analysis window), every frame is E3 +6 within 3 cents, and steady.
    const windowMs = (1024 / 16000) * 1000;
    const held = r.frames.filter((f) => f.t >= onsetMs + 150 + windowMs && f.t <= onsetMs + 1900);
    expect(held.length).toBeGreaterThan(70);
    for (const f of held) {
      expect(f.midi).toBe(E3);
      expect(Math.abs((f.cents as number) - 6)).toBeLessThanOrEqual(3);
      expect(f.steady).toBe(true);
      expect(f.levelDb).toBeGreaterThan(-40);
    }
    // Frames are milliseconds on the service's clock.
    expect(Math.abs(r.frames[r.frames.length - 1]!.t - r.service.nowMs())).toBeLessThan(200);
  });

  it('works in port mode too (the worker returns nothing to a fake port, frames still flow)', async () => {
    const r = rig({ source: tone(hzOf(E3, 6), 0.1, 1) }, { port: true });
    const { listenFrom } = await playThenListen(r, 'cello');
    await r.runTo(listenFrom + 1);
    const held = r.frames.filter((f) => f.steady);
    expect(held.length).toBeGreaterThan(20);
    for (const f of held) expect(Math.abs((f.cents as number) - 6)).toBeLessThanOrEqual(3);
    expect(r.workers[0]!.messages[0]!.type).toBe('pitch');
  });

  it('with loopback bleed at -10 dB: capture opens 300 ms after the release, no frame during the target or its release', async () => {
    // A long room delay (120 ms) and loud bleed; no player.
    const r = rig({ loopback: { rtlSec: 0.12, gainDb: -10, toneGainDb: -10 } });
    const start = r.audio.now() as number;
    const { at, listenFrom } = await playThenListen(r, 'voice-baritone');
    await r.runTo(listenFrom + 1.5);
    const capturedAt = r.audio.log.calls.find((c) => c.method === 'startCapture')!.at;
    const releaseEnd = at + MATCH_NOTE.durSec + MATCH_NOTE.releaseSec;
    expect(capturedAt).toBeGreaterThanOrEqual(releaseEnd + 0.3 - 1e-9);
    expect(r.frames.length).toBeGreaterThan(50);
    // No frame is stamped inside the note or its release, and none hears the note.
    expect(r.frames.filter((f) => f.t < releaseEnd * 1000)).toEqual([]);
    expect(r.frames.filter((f) => f.midi !== null)).toEqual([]);
    expect(start).toBeLessThan(at);
  });

  it('with the bleed, a listen called right after playTarget still waits for the gate', async () => {
    const r = rig({ loopback: { rtlSec: 0.05, gainDb: -10, toneGainDb: -10 } });
    const start = r.audio.now() as number;
    void r.service.playTarget(E3, 'trumpet-bb');
    await r.runTo(start + 0.01);
    void r.service.listen((f) => r.frames.push(f));
    await r.runTo(start + 1);
    expect(r.audio.log.captureStarts).toBe(0);
    await r.runTo(start + 4);
    expect(r.audio.log.captureStarts).toBe(1);
    expect(r.frames.filter((f) => f.midi !== null)).toEqual([]);
  });

  it('playTarget while listening closes the capture and the worker before the note sounds', async () => {
    const r = rig({ source: tone(hzOf(E3), 0, 6) });
    const { listenFrom } = await playThenListen(r, 'cello');
    await r.runTo(listenFrom + 0.5);
    expect(r.service.isListening).toBe(true);
    const n = r.frames.length;
    void r.service.playTarget(E3, 'cello');
    await r.runTo((r.audio.now() as number) + 0.01);
    expect(r.audio.log.captureStops).toBe(1);
    expect(r.workers[0]!.terminated).toBe(true);
    const stopAt = r.audio.log.calls.filter((c) => c.method === 'stopCapture')[0]!.at;
    const playAt = r.audio.log.calls.filter((c) => c.method === 'playNotes')[1]!.at;
    expect(stopAt).toBeLessThanOrEqual(playAt);
    await r.runTo((r.audio.now() as number) + 1);
    expect(r.frames.length).toBe(n);
  });

  it('listen before any target is an error', async () => {
    const r = rig({});
    await expect(r.service.listen(() => undefined)).rejects.toThrow(/before playTarget/);
  });
});

describe('MatchNoteService: stop', () => {
  it('releases the microphone track and the worker, and no frame arrives after', async () => {
    const r = rig({ source: tone(hzOf(E3), 0, 6) });
    const { listenFrom } = await playThenListen(r, 'voice-baritone');
    await r.runTo(listenFrom + 0.5);
    expect(r.frames.length).toBeGreaterThan(0);
    const n = r.frames.length;
    r.service.stop();
    expect(r.audio.log.captureStops).toBe(1);
    expect(r.workers[0]!.terminated).toBe(true);
    expect(r.workers[0]!.onmessage).toBeNull();
    expect(r.audio.releasedInputs).toBe(1);
    expect(r.service.isListening).toBe(false);
    await r.runTo((r.audio.now() as number) + 1);
    expect(r.frames.length).toBe(n);
  });

  it('during the target: stops the sound, resolves playTarget, and a pending listen never opens capture', async () => {
    const r = rig({});
    const start = r.audio.now() as number;
    const played = r.service.playTarget(E3, 'cello');
    await r.runTo(start + 0.01);
    const listening = r.service.listen(() => undefined);
    await r.runTo(start + 0.5);
    const stopsBefore = r.audio.log.stopSounds;
    r.service.stop();
    expect(r.audio.log.stopSounds).toBe(stopsBefore + 1);
    await played;
    await listening;
    await r.runTo(start + 4);
    expect(r.audio.log.captureStarts).toBe(0);
    expect(r.workers).toHaveLength(0);
    expect(r.audio.releasedInputs).toBe(1);
  });

  it('after stop, the next listen opens the microphone again', async () => {
    const r = rig({ source: tone(hzOf(E3), 0, 6) });
    const first = await playThenListen(r, 'cello');
    await r.runTo(first.listenFrom + 0.2);
    r.service.stop();
    const unlocks = r.audio.log.unlocks;
    const second = await playThenListen(r, 'cello');
    await r.runTo(second.listenFrom + 0.2);
    expect(r.audio.log.unlocks).toBe(unlocks + 1);
    expect(r.audio.log.captureStarts).toBe(2);
    expect(r.workers).toHaveLength(2);
  });

  it('after stop, the next playTarget opens the audio again before the note plays', async () => {
    const r = rig({});
    const first = await playThenListen(r, 'cello');
    await r.runTo(first.listenFrom + 0.2);
    r.service.stop();
    const from = r.audio.log.calls.length;
    const start = r.audio.now() as number;
    const played = r.service.playTarget(E3, 'cello');
    await r.runTo(start + MATCH_NOTE.leadSec + MATCH_NOTE.durSec + MATCH_NOTE.releaseSec + 0.01);
    await played;
    const after = r.audio.log.calls.slice(from).map((c) => c.method);
    expect(after.filter((m) => m === 'unlock')).toHaveLength(1);
    expect(after.indexOf('unlock')).toBeLessThan(after.indexOf('playNotes'));
  });
});
